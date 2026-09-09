import { describe, expect, it, vi } from "vitest";
import { base64UrlDecodeBytes, base64UrlEncodeBytes } from "./crypto.js";
import { InMemoryMfaStore, MfaService, totp, type MfaAttempt, type MfaSecretContext, type MfaSecretPort, type MfaServiceOptions } from "./mfa.js";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const STEP_MS = 30_000;

function encryptedPort(): MfaSecretPort {
  const key = crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const contextBytes = (context: MfaSecretContext) => new TextEncoder().encode(JSON.stringify([
    context.purpose, context.tenantId, context.userId, context.enrollmentId
  ]));
  return {
    async seal(secret, context) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: contextBytes(context) }, await key, new TextEncoder().encode(secret));
      return `${base64UrlEncodeBytes(iv)}.${base64UrlEncodeBytes(new Uint8Array(bytes))}`;
    },
    async unseal(sealed, context) {
      const [iv, ciphertext] = sealed.split(".");
      const bytes = await crypto.subtle.decrypt({
        name: "AES-GCM", iv: base64UrlDecodeBytes(iv!) as BufferSource, additionalData: contextBytes(context)
      }, await key, base64UrlDecodeBytes(ciphertext!) as BufferSource);
      return new TextDecoder().decode(bytes);
    }
  };
}

function fixture() {
  let time = STEP_MS;
  const now = () => time;
  const store = new InMemoryMfaStore(now);
  const secrets = encryptedPort();
  const allowAttempt = vi.fn<MfaServiceOptions["allowAttempt"]>(() => true);
  const options = { now, allowAttempt };
  const service = new MfaService(store, secrets, options);
  // Fixed RFC key keeps replay and time-window assertions deterministic.
  async function pending(tenantId = "tenant", userId = "user") {
    const context: MfaSecretContext = { purpose: "framekit.mfa.totp.v1", tenantId, userId, enrollmentId: crypto.randomUUID() };
    await store.compareAndSet({
      ...context,
      encryptedSecret: await secrets.seal(RFC_SECRET, context),
      pendingUntil: now() + 600_000,
      recoveryHashes: [],
      revision: 1
    }, undefined);
  }
  async function confirmed() {
    await pending();
    return service.confirmEnrollment("tenant", "user", await totp(RFC_SECRET, 1));
  }
  return { store, secrets, service, options, allowAttempt, pending, confirmed, setTime: (value: number) => { time = value; } };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const calls: Record<MfaAttempt, (service: MfaService, code: string) => Promise<unknown>> = {
  confirm: (service, code) => service.confirmEnrollment("tenant", "user", code),
  verify: (service, code) => service.verifyChallenge("tenant", "user", code),
  recovery: (service, code) => service.useRecoveryCode("tenant", "user", code),
  disable: (service, code) => service.disable("tenant", "user", code)
};

describe("RFC 4226 / RFC 6238 SHA-1 TOTP", () => {
  // RFC 4226 Appendix D; totp accepts the already-derived counter.
  it.each(["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"].map((code, step) => [step, code] as const))(
    "matches HOTP counter %i", async (step, code) => { expect(await totp(RFC_SECRET, step)).toBe(code); }
  );
  // RFC 6238 Appendix B's SHA-1 outputs, reduced modulo 10^6.
  it.each([[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]] as const)(
    "matches TOTP at Unix second %i", async (seconds, code) => { expect(await totp(RFC_SECRET, Math.floor(seconds / 30))).toBe(code); }
  );
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid counter %s", async (step) => {
    await expect(totp(RFC_SECRET, step)).rejects.toThrow(TypeError);
  });
  it.each(["", "A", "AAAAAAAAAAAAAAAAAAAAAAAAA", `${RFC_SECRET}=`, RFC_SECRET.toLowerCase(), `${RFC_SECRET}\n`, ` ${RFC_SECRET}`, RFC_SECRET.replace("G", "0"), "A".repeat(104), "A".repeat(25) + "B"])(
    "rejects malformed/noncanonical or weak Base32 %s", async (secret) => { await expect(totp(secret, 1)).rejects.toThrow(TypeError); }
  );
  it("accepts canonical 128-bit and 512-bit keys and counters above 32 bits", async () => {
    expect(await totp("A".repeat(26), 2 ** 32)).toMatch(/^\d{6}$/);
    expect(await totp("A".repeat(103), Number.MAX_SAFE_INTEGER)).toMatch(/^\d{6}$/);
  });
});

describe("MFA enrollment and context", () => {
  it("generates a 160-bit secret and 128-bit recovery codes, sealing only the secret and storing only code hashes", async () => {
    const f = fixture();
    const enrollment = await f.service.beginEnrollment("tenant", "user");
    expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrollment.expiresAt).toBe(new Date(630_000).toISOString());
    const result = await f.service.confirmEnrollment("tenant", "user", await totp(enrollment.secret, 1));
    expect(result.recoveryCodes).toHaveLength(8);
    expect(new Set(result.recoveryCodes).size).toBe(8);
    for (const code of result.recoveryCodes) expect(code).toMatch(/^[A-Z2-7]{25}[AEIMQUY4]$/);
    const stored = JSON.stringify(await f.store.get("tenant", "user"));
    expect(stored).not.toContain(enrollment.secret);
    for (const code of result.recoveryCodes) expect(stored).not.toContain(code);
    expect(await f.service.status("tenant", "user")).toEqual({ enabled: true, pending: false, recoveryCodes: 8 });
  });

  it("flushes the final three entropy bits of a recovery code", async () => {
    const f = fixture();
    await f.pending();
    // All 128 random bits are ones: 25 full Base32 groups plus the last 3 bits.
    const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((bytes) => {
      (bytes as Uint8Array).fill(255);
      return bytes;
    });
    try {
      const { recoveryCodes } = await f.service.confirmEnrollment("tenant", "user", "287082");
      expect(recoveryCodes[0]).toBe("7".repeat(25) + "4");
      // Even duplicate random outputs must not make a code reusable.
      expect(await f.service.useRecoveryCode("tenant", "user", recoveryCodes[0]!)).toBe(true);
      expect(await f.service.useRecoveryCode("tenant", "user", recoveryCodes[0]!)).toBe(false);
    } finally {
      random.mockRestore();
    }
  });

  it("never replaces an already confirmed factor", async () => {
    const f = fixture();
    await f.confirmed();
    const before = await f.store.get("tenant", "user");
    await expect(f.service.beginEnrollment("tenant", "user")).rejects.toMatchObject({ code: "MFA_ALREADY_ENROLLED" });
    expect(await f.store.get("tenant", "user")).toEqual(before);
  });

  it("cannot overwrite a factor confirmed while a replacement secret was being sealed", async () => {
    const f = fixture();
    await f.pending();
    const entered = deferred();
    const resume = deferred();
    const service = new MfaService(f.store, {
      ...f.secrets,
      async seal(value, context) { entered.resolve(); await resume.promise; return f.secrets.seal(value, context); }
    }, f.options);
    const enrollment = service.beginEnrollment("tenant", "user");
    const rejected = expect(enrollment).rejects.toMatchObject({ code: "MFA_CONFLICT" });
    await entered.promise;
    await f.service.confirmEnrollment("tenant", "user", "287082");
    resume.resolve();
    await rejected;
    expect((await f.store.get("tenant", "user"))!.lastAcceptedStep).toBe(1);
  });

  it("expires pending enrollment at its deadline", async () => {
    const f = fixture();
    await f.pending();
    f.setTime(630_000);
    expect(await f.service.status("tenant", "user")).toMatchObject({ pending: false });
    await expect(f.service.confirmEnrollment("tenant", "user", await totp(RFC_SECRET, 21))).rejects.toMatchObject({ code: "MFA_ENROLLMENT_INVALID" });
    expect(await f.service.verifyChallenge("tenant", "user", await totp(RFC_SECRET, 21))).toBe(false);
    expect(await f.service.useRecoveryCode("tenant", "user", "A".repeat(26))).toBe(false);
  });

  it("checks pending expiry atomically when confirmation was delayed before its CAS", async () => {
    const f = fixture();
    await f.pending();
    f.setTime(620_000);
    const original = f.store.compareAndSet.bind(f.store);
    vi.spyOn(f.store, "compareAndSet").mockImplementation(async (...args) => {
      f.setTime(630_000);
      return original(...args);
    });
    await expect(f.service.confirmEnrollment("tenant", "user", await totp(RFC_SECRET, 20))).rejects.toMatchObject({ code: "MFA_CONFLICT" });
    expect(await f.service.status("tenant", "user")).toMatchObject({ enabled: false });
  });

  it.each(["tenantId", "userId", "enrollmentId", "purpose"] as const)("authenticates secret context field %s", async (field) => {
    const f = fixture();
    await f.pending();
    const row = (await f.store.get("tenant", "user"))!;
    const context: MfaSecretContext = { purpose: "framekit.mfa.totp.v1", tenantId: "tenant", userId: "user", enrollmentId: row.enrollmentId };
    await expect(f.secrets.unseal(row.encryptedSecret!, { ...context, [field]: "different" } as MfaSecretContext)).rejects.toThrow();
  });

  it("rejects ciphertext transplanted between users or enrollment generations", async () => {
    const f = fixture();
    await f.pending();
    const original = (await f.store.get("tenant", "user"))!;
    await f.pending("tenant", "other");
    const target = (await f.store.get("tenant", "other"))!;
    await f.store.compareAndSet({ ...target, encryptedSecret: original.encryptedSecret, revision: 2 }, 1);
    await expect(f.service.confirmEnrollment("tenant", "other", "287082")).rejects.toThrow();
    await f.store.compareAndSet({ ...original, enrollmentId: crypto.randomUUID(), revision: 2 }, 1);
    await expect(f.service.confirmEnrollment("tenant", "user", "287082")).rejects.toThrow();
  });

  it("isolates identities with colliding delimiter concatenations and clones stored values", async () => {
    const f = fixture();
    await f.pending("a:b", "c");
    await f.pending("a", "b:c");
    await f.service.confirmEnrollment("a:b", "c", "287082");
    expect(await f.service.status("a", "b:c")).toEqual({ enabled: false, pending: true, recoveryCodes: 0 });
    const row = (await f.store.get("a:b", "c"))!;
    row.recoveryHashes.length = 0;
    expect((await f.store.get("a:b", "c"))!.recoveryHashes).toHaveLength(8);
  });

  it("rejects a store returning another tenant's row", async () => {
    const f = fixture();
    await f.pending();
    const row = (await f.store.get("tenant", "user"))!;
    vi.spyOn(f.store, "get").mockResolvedValue(row);
    const unseal = vi.spyOn(f.secrets, "unseal");
    await expect(f.service.confirmEnrollment("other", "user", "287082")).rejects.toMatchObject({ code: "MFA_STORE_INVALID" });
    expect(unseal).not.toHaveBeenCalled();
  });
});

describe("MFA consumption and races", () => {
  it("consumes the confirmation step and accepts only one concurrent use of the next step", async () => {
    const f = fixture();
    await f.confirmed();
    expect(await f.service.verifyChallenge("tenant", "user", "287082")).toBe(false);
    f.setTime(2 * STEP_MS);
    const results = await Promise.all(Array.from({ length: 5 }, () => f.service.verifyChallenge("tenant", "user", "359152")));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("has exactly one concurrent confirmation winner", async () => {
    const f = fixture();
    await f.pending();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => f.service.confirmEnrollment("tenant", "user", "287082")));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("enforces a monotonic step, including after clock rollback and more than eight successes", async () => {
    const f = fixture();
    await f.confirmed();
    f.setTime(2 * STEP_MS);
    expect(await f.service.verifyChallenge("tenant", "user", "969429")).toBe(true); // Future step 3.
    expect(await f.service.verifyChallenge("tenant", "user", "359152")).toBe(false); // Older step 2, never used.
    for (let step = 4; step <= 14; step++) {
      f.setTime(step * STEP_MS);
      expect(await f.service.verifyChallenge("tenant", "user", await totp(RFC_SECRET, step))).toBe(true);
    }
    f.setTime(2 * STEP_MS);
    expect(await f.service.verifyChallenge("tenant", "user", "969429")).toBe(false);
    expect((await f.store.get("tenant", "user"))!.lastAcceptedStep).toBe(14);
  });

  it.each([-1, 0, 1])("accepts allowed clock drift %i", async (offset) => {
    const f = fixture();
    await f.confirmed();
    f.setTime(10 * STEP_MS);
    expect(await f.service.verifyChallenge("tenant", "user", await totp(RFC_SECRET, 10 + offset))).toBe(true);
  });

  it("rejects outside-window codes and a valid code that expires before its write", async () => {
    const f = fixture();
    await f.confirmed();
    f.setTime(10 * STEP_MS);
    expect(await f.service.verifyChallenge("tenant", "user", await totp(RFC_SECRET, 8))).toBe(false);
    expect(await f.service.verifyChallenge("tenant", "user", await totp(RFC_SECRET, 12))).toBe(false);
    const original = f.store.compareAndSet.bind(f.store);
    vi.spyOn(f.store, "compareAndSet").mockImplementation(async (...args) => { f.setTime(12 * STEP_MS); return original(...args); });
    expect(await f.service.verifyChallenge("tenant", "user", await totp(RFC_SECRET, 10))).toBe(false);
    expect((await f.store.get("tenant", "user"))!.lastAcceptedStep).toBe(1);
  });

  it("allows only one concurrent redemption and binds recovery hashes to the factor identity", async () => {
    const f = fixture();
    const { recoveryCodes } = await f.confirmed();
    const results = await Promise.all(Array.from({ length: 5 }, () => f.service.useRecoveryCode("tenant", "user", recoveryCodes[0]!)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await f.service.useRecoveryCode("tenant", "user", recoveryCodes[0]!)).toBe(false);
    const row = (await f.store.get("tenant", "user"))!;
    await f.store.compareAndSet({ ...row, userId: "other", revision: 1 }, undefined);
    expect(await f.service.useRecoveryCode("tenant", "other", recoveryCodes[1]!)).toBe(false);
  });

  it("disables in one CAS, erases secrets, and preserves revision across re-enrollment", async () => {
    const f = fixture();
    const { recoveryCodes } = await f.confirmed();
    f.setTime(2 * STEP_MS);
    const cas = vi.spyOn(f.store, "compareAndSet");
    await f.service.disable("tenant", "user", "359152");
    expect(cas).toHaveBeenCalledTimes(1);
    const disabled = (await f.store.get("tenant", "user"))!;
    expect(disabled).toEqual({ tenantId: "tenant", userId: "user", enrollmentId: expect.any(String), sessionVersion: expect.any(String), recoveryHashes: [], revision: 3 });
    expect(await f.service.status("tenant", "user")).toEqual({ enabled: false, pending: false, recoveryCodes: 0 });
    expect(await f.service.useRecoveryCode("tenant", "user", recoveryCodes[0]!)).toBe(false);
    await f.service.beginEnrollment("tenant", "user");
    const next = (await f.store.get("tenant", "user"))!;
    expect(next.revision).toBe(4);
    expect(next.enrollmentId).not.toBe(disabled.enrollmentId);
  });

  it("cannot disable a new enrollment after verifying an old factor snapshot", async () => {
    const f = fixture();
    await f.confirmed();
    f.setTime(10 * STEP_MS);
    const entered = deferred();
    const resume = deferred();
    const slow = new MfaService(f.store, {
      ...f.secrets,
      async unseal(value, context) {
        const secret = await f.secrets.unseal(value, context);
        entered.resolve();
        await resume.promise;
        return secret;
      }
    }, f.options);
    const code = await totp(RFC_SECRET, 10);
    const staleDisable = slow.disable("tenant", "user", code);
    const rejected = expect(staleDisable).rejects.toMatchObject({ code: "MFA_CONFLICT" });
    await entered.promise;
    await f.service.disable("tenant", "user", code);
    const enrollment = await f.service.beginEnrollment("tenant", "user");
    await f.service.confirmEnrollment("tenant", "user", await totp(enrollment.secret, 10));
    const newFactor = await f.store.get("tenant", "user");
    resume.resolve();
    await rejected;
    expect(await f.store.get("tenant", "user")).toEqual(newFactor);
    expect(await f.service.status("tenant", "user")).toMatchObject({ enabled: true });
  });

  it("has one winner between verifying and disabling the same step", async () => {
    const f = fixture();
    await f.confirmed();
    f.setTime(2 * STEP_MS);
    const results = await Promise.allSettled([
      f.service.verifyChallenge("tenant", "user", "359152"),
      f.service.disable("tenant", "user", "359152")
    ]);
    const verifyWon = results[0]!.status === "fulfilled" && results[0]!.value === true;
    const disableWon = results[1]!.status === "fulfilled";
    expect(Number(verifyWon) + Number(disableWon)).toBe(1);
  });
});

describe("MFA recovery-code disable", () => {
  it("atomically erases the factor and preserves its session version without decrypting the secret", async () => {
    const f = fixture();
    const { recoveryCodes } = await f.confirmed();
    const before = (await f.store.get("tenant", "user"))!;
    const unseal = vi.spyOn(f.secrets, "unseal");
    const cas = vi.spyOn(f.store, "compareAndSet");
    f.allowAttempt.mockClear();
    await f.service.disable("tenant", "user", recoveryCodes[0]!, { recoveryCode: true });
    expect(cas).toHaveBeenCalledTimes(1);
    expect(unseal).not.toHaveBeenCalled();
    expect(f.allowAttempt).toHaveBeenCalledExactlyOnceWith("tenant", "user", "disable");
    expect(await f.store.get("tenant", "user")).toEqual({
      tenantId: "tenant", userId: "user", enrollmentId: before.enrollmentId,
      sessionVersion: before.sessionVersion, revision: before.revision + 1, recoveryHashes: []
    });
    expect(await f.service.useRecoveryCode("tenant", "user", recoveryCodes[1]!)).toBe(false);
    await expect(f.service.disable("tenant", "user", recoveryCodes[0]!, { recoveryCode: true })).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
  });

  it("requires a different unused code after recovery sign-in", async () => {
    const f = fixture();
    const { recoveryCodes } = await f.confirmed();
    expect(await f.service.useRecoveryCode("tenant", "user", recoveryCodes[0]!)).toBe(true);
    await expect(f.service.disable("tenant", "user", recoveryCodes[0]!, { recoveryCode: true })).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
    await f.service.disable("tenant", "user", recoveryCodes[1]!, { recoveryCode: true });
    expect(await f.service.status("tenant", "user")).toMatchObject({ enabled: false });
  });

  it("has one winner between recovery sign-in and recovery disable using the same code", async () => {
    const f = fixture();
    const { recoveryCodes } = await f.confirmed();
    const results = await Promise.allSettled([
      f.service.useRecoveryCode("tenant", "user", recoveryCodes[0]!),
      f.service.disable("tenant", "user", recoveryCodes[0]!, { recoveryCode: true })
    ]);
    const loginWon = results[0]!.status === "fulfilled" && results[0]!.value === true;
    const disableWon = results[1]!.status === "fulfilled";
    expect(Number(loginWon) + Number(disableWon)).toBe(1);
  });

  it("cannot disable a replacement factor after pausing with a valid old recovery code", async () => {
    const f = fixture();
    const { recoveryCodes } = await f.confirmed();
    const entered = deferred();
    const resume = deferred();
    const original = f.store.compareAndSet.bind(f.store);
    let pauseNext = true;
    vi.spyOn(f.store, "compareAndSet").mockImplementation(async (...args) => {
      if (pauseNext) { pauseNext = false; entered.resolve(); await resume.promise; }
      return original(...args);
    });
    const stale = f.service.disable("tenant", "user", recoveryCodes[0]!, { recoveryCode: true });
    const rejected = expect(stale).rejects.toMatchObject({ code: "MFA_CONFLICT" });
    await entered.promise;
    await f.service.disable("tenant", "user", recoveryCodes[1]!, { recoveryCode: true });
    const enrollment = await f.service.beginEnrollment("tenant", "user");
    await f.service.confirmEnrollment("tenant", "user", await totp(enrollment.secret, 1));
    const replacement = await f.store.get("tenant", "user");
    resume.resolve();
    await rejected;
    expect(await f.store.get("tenant", "user")).toEqual(replacement);
    await expect(f.service.disable("tenant", "user", recoveryCodes[2]!, { recoveryCode: true })).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
  });

  it("rejects hashes transplanted to another identity and limits disable before reading storage", async () => {
    const f = fixture();
    const { recoveryCodes } = await f.confirmed();
    const row = (await f.store.get("tenant", "user"))!;
    await f.store.compareAndSet({ ...row, tenantId: "other", revision: 1 }, undefined);
    await expect(f.service.disable("other", "user", recoveryCodes[0]!, { recoveryCode: true })).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
    f.allowAttempt.mockReturnValue(false);
    const get = vi.spyOn(f.store, "get");
    await expect(f.service.disable("tenant", "user", recoveryCodes[0]!, { recoveryCode: true })).rejects.toMatchObject({ code: "MFA_RATE_LIMITED" });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("MFA attempt limiting and input validation", () => {
  it("requires an explicit limiter", () => {
    expect(() => new MfaService(new InMemoryMfaStore(), encryptedPort(), {} as MfaServiceOptions)).toThrow("attempt limiter");
  });

  it.each(Object.keys(calls) as MfaAttempt[])("limits %s before any storage access, including malformed guesses", async (operation) => {
    const f = fixture();
    f.allowAttempt.mockReturnValue(false);
    const get = vi.spyOn(f.store, "get");
    await expect(calls[operation](f.service, "bad code")).rejects.toMatchObject({ code: "MFA_RATE_LIMITED" });
    expect(f.allowAttempt).toHaveBeenCalledExactlyOnceWith("tenant", "user", operation);
    expect(get).not.toHaveBeenCalled();
  });

  it.each(Object.keys(calls) as MfaAttempt[])("fails closed when the limiter throws during %s", async (operation) => {
    const f = fixture();
    f.allowAttempt.mockRejectedValue(new Error("limiter unavailable"));
    const get = vi.spyOn(f.store, "get");
    await expect(calls[operation](f.service, "123456")).rejects.toThrow("limiter unavailable");
    expect(get).not.toHaveBeenCalled();
  });

  it.each(["12345", "1234567", " 287082", "287082\n", "２８７０８２", "", 287082] as const)("rejects malformed TOTP %s without decrypting", async (code) => {
    const f = fixture();
    await f.pending();
    const unseal = vi.spyOn(f.secrets, "unseal");
    await expect(f.service.confirmEnrollment("tenant", "user", code as string)).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
    expect(unseal).not.toHaveBeenCalled();
    await f.service.confirmEnrollment("tenant", "user", "287082");
    unseal.mockClear();
    expect(await f.service.verifyChallenge("tenant", "user", code as string)).toBe(false);
    await expect(f.service.disable("tenant", "user", code as string)).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
    expect(unseal).not.toHaveBeenCalled();
  });

  it("counts successful confirm, verify, recovery, and disable attempts exactly once", async () => {
    const f = fixture();
    const { recoveryCodes } = await f.confirmed();
    f.setTime(2 * STEP_MS);
    expect(await f.service.verifyChallenge("tenant", "user", "359152")).toBe(true);
    expect(await f.service.useRecoveryCode("tenant", "user", recoveryCodes[0]!)).toBe(true);
    f.setTime(3 * STEP_MS);
    await f.service.disable("tenant", "user", "969429");
    expect(f.allowAttempt.mock.calls.map((call) => call[2])).toEqual(["confirm", "verify", "recovery", "disable"]);
  });

  it("rejects malformed recovery codes without mutating the factor", async () => {
    const f = fixture();
    const { recoveryCodes } = await f.confirmed();
    const before = await f.store.get("tenant", "user");
    for (const code of [recoveryCodes[0]!.toLowerCase(), `${recoveryCodes[0]}=`, "A".repeat(25), "A".repeat(25) + "B", "A".repeat(100_000)]) {
      expect(await f.service.useRecoveryCode("tenant", "user", code)).toBe(false);
    }
    expect(await f.store.get("tenant", "user")).toEqual(before);
    expect(f.allowAttempt).toHaveBeenCalledTimes(6);
  });
});

import { FramekitError } from "@framekit/core";
import { constantEqual, hashOpaqueToken } from "./crypto.js";

const STEP_MS = 30_000;
const ENROLLMENT_TTL_MS = 10 * 60_000;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export type MfaFactor = {
  tenantId: string;
  userId: string;
  enrollmentId: string;
  /** Last confirmed enrollment, retained through disable and pending replacement. */
  sessionVersion?: string;
  encryptedSecret?: string;
  pendingUntil?: number;
  confirmedAt?: number;
  lastAcceptedStep?: number;
  recoveryHashes: string[];
  revision: number;
};

export type MfaStore = {
  get(tenantId: string, userId: string): Promise<MfaFactor | undefined>;
  /**
   * Atomically replace exactly expectedRevision (undefined means absent), requiring
   * next.revision = (expectedRevision ?? 0) + 1. If expiresAt is present, the
   * write must occur before that Unix millisecond deadline. Preserve tombstones
   * and revisions: deleting a disabled row would permit an ABA race.
   */
  compareAndSet(next: MfaFactor, expectedRevision: number | undefined, expiresAt?: number): Promise<boolean>;
};

export type MfaSecretContext = {
  purpose: "framekit.mfa.totp.v1";
  tenantId: string;
  userId: string;
  enrollmentId: string;
};

/** Implementations must authenticate the entire context when sealing/unsealing. */
export type MfaSecretPort = {
  seal(value: string, context: MfaSecretContext): Promise<string> | string;
  unseal(value: string, context: MfaSecretContext): Promise<string> | string;
};

export type MfaAttempt = "confirm" | "verify" | "recovery" | "disable";
export type MfaCodeOptions = { recoveryCode?: boolean };
export type MfaServiceOptions = {
  /** Atomically consume an attempt across all processes and all four operations. */
  allowAttempt(tenantId: string, userId: string, operation: MfaAttempt): Promise<boolean> | boolean;
  now?: () => number;
};

/** Development/test storage only; production needs a durable, shared CAS store. */
export class InMemoryMfaStore implements MfaStore {
  private readonly rows = new Map<string, MfaFactor>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(tenantId: string, userId: string): Promise<MfaFactor | undefined> {
    const row = this.rows.get(JSON.stringify([tenantId, userId]));
    return row && cloneFactor(row);
  }

  async compareAndSet(next: MfaFactor, expectedRevision: number | undefined, expiresAt?: number): Promise<boolean> {
    const key = JSON.stringify([next.tenantId, next.userId]);
    const current = this.rows.get(key);
    if (current?.revision !== expectedRevision) return false;
    if (!Number.isSafeInteger(next.revision) || next.revision !== (expectedRevision ?? 0) + 1) return false;
    if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || this.now() >= expiresAt)) return false;
    this.rows.set(key, cloneFactor(next));
    return true;
  }
}

/** MFA primitives only: callers must authorize enrollment, status, and challenges. */
export class MfaService {
  private readonly now: () => number;

  constructor(
    private readonly store: MfaStore,
    private readonly secrets: MfaSecretPort,
    private readonly options: MfaServiceOptions
  ) {
    if (typeof options?.allowAttempt !== "function") {
      throw new TypeError("MFA requires an attempt limiter.");
    }
    this.now = options.now ?? Date.now;
  }

  async beginEnrollment(tenantId: string, userId: string): Promise<{ secret: string; expiresAt: string }> {
    const current = await this.read(tenantId, userId);
    if (current?.confirmedAt !== undefined) {
      throw new FramekitError("MFA_ALREADY_ENROLLED", "Disable the existing MFA factor before enrolling another.", 409);
    }
    const secret = encodeBase32(crypto.getRandomValues(new Uint8Array(20)));
    const row: MfaFactor = {
      tenantId,
      userId,
      enrollmentId: crypto.randomUUID(),
      sessionVersion: current?.sessionVersion,
      pendingUntil: this.timestamp() + ENROLLMENT_TTL_MS,
      recoveryHashes: [],
      revision: (current?.revision ?? 0) + 1
    };
    row.encryptedSecret = await this.secrets.seal(secret, secretContext(row));
    if (!await this.store.compareAndSet(row, current?.revision, row.pendingUntil)) throw conflict();
    return { secret, expiresAt: new Date(row.pendingUntil!).toISOString() };
  }

  async confirmEnrollment(tenantId: string, userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    await this.limit(tenantId, userId, "confirm");
    const row = await this.require(tenantId, userId);
    if (row.confirmedAt !== undefined || row.pendingUntil === undefined || row.pendingUntil <= this.timestamp()) {
      throw new FramekitError("MFA_ENROLLMENT_INVALID", "MFA enrollment is invalid or expired.", 401);
    }
    const step = await this.matchStep(row, code);
    if (step === undefined) throw invalidCode();
    const recoveryCodes = Array.from({ length: 8 }, () => encodeBase32(crypto.getRandomValues(new Uint8Array(16))));
    const recoveryHashes = await Promise.all(recoveryCodes.map((value) => recoveryHash(row, value)));
    const next: MfaFactor = {
      ...row,
      pendingUntil: undefined,
      confirmedAt: this.timestamp(),
      sessionVersion: row.enrollmentId,
      lastAcceptedStep: step,
      recoveryHashes,
      revision: row.revision + 1
    };
    const expiresAt = Math.min(row.pendingUntil, stepExpiresAt(step));
    if (!await this.store.compareAndSet(next, row.revision, expiresAt)) throw conflict();
    return { recoveryCodes };
  }

  async verifyChallenge(tenantId: string, userId: string, code: string, expectedEnrollmentId?: string): Promise<boolean> {
    await this.limit(tenantId, userId, "verify");
    const row = await this.require(tenantId, userId);
    if (row.confirmedAt === undefined) return false;
    if (expectedEnrollmentId !== undefined && row.enrollmentId !== expectedEnrollmentId) return false;
    const step = await this.matchStep(row, code);
    if (step === undefined) return false;
    return this.store.compareAndSet({ ...row, lastAcceptedStep: step, revision: row.revision + 1 }, row.revision, stepExpiresAt(step));
  }

  async disable(tenantId: string, userId: string, code: string, options: MfaCodeOptions = {}): Promise<void> {
    await this.limit(tenantId, userId, "disable");
    const row = await this.require(tenantId, userId);
    if (row.confirmedAt === undefined) throw invalidCode();
    let expiresAt: number | undefined;
    if (options.recoveryCode === true) {
      if (await this.matchRecoveryHash(row, code) === undefined) throw invalidCode();
    } else {
      const step = await this.matchStep(row, code);
      if (step === undefined) throw invalidCode();
      expiresAt = stepExpiresAt(step);
    }
    // Verify and disable the same revision; never reread and disable a new factor.
    const disabled: MfaFactor = {
      tenantId,
      userId,
      enrollmentId: row.enrollmentId,
      sessionVersion: row.sessionVersion ?? row.enrollmentId,
      recoveryHashes: [],
      revision: row.revision + 1
    };
    if (!await this.store.compareAndSet(disabled, row.revision, expiresAt)) throw conflict();
  }

  async useRecoveryCode(tenantId: string, userId: string, code: string, expectedEnrollmentId?: string): Promise<boolean> {
    await this.limit(tenantId, userId, "recovery");
    const row = await this.require(tenantId, userId);
    if (expectedEnrollmentId !== undefined && row.enrollmentId !== expectedEnrollmentId) return false;
    if (row.confirmedAt === undefined) return false;
    const hash = await this.matchRecoveryHash(row, code);
    if (hash === undefined) return false;
    const recoveryHashes = row.recoveryHashes.filter((candidate) => !constantEqual(candidate, hash));
    return this.store.compareAndSet({ ...row, recoveryHashes, revision: row.revision + 1 }, row.revision);
  }

  async status(tenantId: string, userId: string): Promise<{ enabled: boolean; pending: boolean; recoveryCodes: number }> {
    const row = await this.read(tenantId, userId);
    return {
      enabled: row?.confirmedAt !== undefined,
      pending: row?.pendingUntil !== undefined && row.pendingUntil > this.timestamp(),
      recoveryCodes: row?.confirmedAt !== undefined ? row.recoveryHashes.length : 0
    };
  }

  async getActiveEnrollmentId(tenantId: string, userId: string): Promise<string | undefined> {
    return (await this.getSessionBinding(tenantId, userId)).enrollmentId;
  }

  async getSessionBinding(tenantId: string, userId: string): Promise<{ enrollmentId?: string; version?: string }> {
    const row = await this.read(tenantId, userId);
    return {
      enrollmentId: row?.confirmedAt !== undefined ? row.enrollmentId : undefined,
      version: row?.sessionVersion
    };
  }

  private async limit(tenantId: string, userId: string, operation: MfaAttempt): Promise<void> {
    validateIdentity(tenantId, userId);
    if (await this.options.allowAttempt(tenantId, userId, operation) !== true) {
      throw new FramekitError("MFA_RATE_LIMITED", "Too many MFA attempts.", 429);
    }
  }

  private async read(tenantId: string, userId: string): Promise<MfaFactor | undefined> {
    validateIdentity(tenantId, userId);
    const row = await this.store.get(tenantId, userId);
    if (row && (row.tenantId !== tenantId || row.userId !== userId)) {
      throw new FramekitError("MFA_STORE_INVALID", "MFA storage returned an invalid identity.", 500);
    }
    return row;
  }

  private async require(tenantId: string, userId: string): Promise<MfaFactor> {
    const row = await this.read(tenantId, userId);
    if (!row) throw new FramekitError("MFA_NOT_ENROLLED", "MFA is not enrolled.", 404);
    return row;
  }

  private timestamp(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000 - ENROLLMENT_TTL_MS) {
      throw new TypeError("Invalid MFA clock.");
    }
    return value;
  }

  private async matchStep(row: MfaFactor, code: string): Promise<number | undefined> {
    if (typeof code !== "string" || !/^[0-9]{6}$/.test(code) || !row.encryptedSecret) return undefined;
    const secret = await this.secrets.unseal(row.encryptedSecret, secretContext(row));
    const current = Math.floor(this.timestamp() / STEP_MS);
    // Prefer the newest match, and never accept an older step after a newer one.
    for (const step of [current + 1, current, current - 1]) {
      if (step < 0 || step <= (row.lastAcceptedStep ?? -1)) continue;
      if (constantEqual(await totp(secret, step), code)) return step;
    }
    return undefined;
  }

  private async matchRecoveryHash(row: MfaFactor, code: string): Promise<string | undefined> {
    if (typeof code !== "string" || !/^[A-Z2-7]{25}[AEIMQUY4]$/.test(code)) return undefined;
    const hash = await recoveryHash(row, code);
    return row.recoveryHashes.some((candidate) => constantEqual(candidate, hash)) ? hash : undefined;
  }
}

function cloneFactor(row: MfaFactor): MfaFactor {
  return { ...row, recoveryHashes: [...row.recoveryHashes] };
}

function secretContext(row: MfaFactor): MfaSecretContext {
  return { purpose: "framekit.mfa.totp.v1", tenantId: row.tenantId, userId: row.userId, enrollmentId: row.enrollmentId };
}

function recoveryHash(row: MfaFactor, code: string): Promise<string> {
  return hashOpaqueToken(JSON.stringify(["framekit.mfa.recovery.v1", row.tenantId, row.userId, row.enrollmentId, code]));
}

function stepExpiresAt(step: number): number {
  return (step + 2) * STEP_MS;
}

function validateIdentity(tenantId: string, userId: string): void {
  if (typeof tenantId !== "string" || !tenantId || typeof userId !== "string" || !userId) {
    throw new TypeError("MFA requires a tenant and user identity.");
  }
}

function conflict(): FramekitError {
  return new FramekitError("MFA_CONFLICT", "MFA factor changed or the challenge expired.", 409);
}

function invalidCode(): FramekitError {
  return new FramekitError("MFA_CODE_INVALID", "MFA code is invalid.", 401);
}

function encodeBase32(bytes: Uint8Array): string {
  let buffer = 0;
  let bits = 0;
  let result = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32[(buffer >>> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) result += BASE32[(buffer << (5 - bits)) & 31];
  return result;
}

function decodeSecret(secret: string): Uint8Array<ArrayBuffer> {
  if (typeof secret !== "string" || secret.length > 103 || !/^[A-Z2-7]+$/.test(secret)) {
    throw new TypeError("TOTP secret must be canonical unpadded Base32 containing 16 to 64 bytes.");
  }
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    buffer = (buffer << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
    }
    buffer &= (1 << bits) - 1;
  }
  const decoded = new Uint8Array(bytes);
  if (decoded.length < 16 || decoded.length > 64 || encodeBase32(decoded) !== secret) {
    throw new TypeError("TOTP secret must be canonical unpadded Base32 containing 16 to 64 bytes.");
  }
  return decoded;
}

/** RFC 4226 dynamic truncation, used by RFC 6238 with a 30-second time step. */
export async function totp(secret: string, step: number): Promise<string> {
  if (!Number.isSafeInteger(step) || step < 0) throw new TypeError("TOTP step must be a nonnegative safe integer.");
  const key = await crypto.subtle.importKey("raw", decodeSecret(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step), false);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = digest[digest.length - 1]! & 15;
  const truncated = new DataView(digest.buffer).getUint32(offset, false) & 0x7fffffff;
  return String(truncated % 1_000_000).padStart(6, "0");
}

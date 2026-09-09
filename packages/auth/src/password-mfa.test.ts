import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FramekitError, type TenantContext } from "@framekit/core";
import type { AuthSession, AuthUser, PasswordAuthOptions } from "./contracts.js";
import { base64UrlDecode, base64UrlEncode, sign } from "./crypto.js";
import { InMemoryAuthLifecycleTokenStore, InMemoryUserStore } from "./in-memory-stores.js";
import { InMemoryMfaStore, MfaService, totp, type MfaSecretPort } from "./mfa.js";
import { PasswordAuthService } from "./password-auth-service.js";
import { hashPassword } from "./password-policy.js";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const AUTH_SECRET = "test-secret-with-enough-length";
const PASSWORD = "a strong user password";
const passwordHash = hashPassword(PASSWORD);
const context: TenantContext = { tenantId: "tenant", userId: "user", roles: [], permissions: [] };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(30_000));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function fixture(configured = true) {
  const user: AuthUser = { id: "user", tenantId: "tenant", email: "user@example.com", name: "User", passwordHash: await passwordHash, roles: [], permissions: [] };
  const users = new InMemoryUserStore([user]);
  const store = new InMemoryMfaStore();
  const sealed = new Map<string, { secret: string; context: string }>();
  const secrets: MfaSecretPort = {
    seal(secret, binding) {
      const token = crypto.randomUUID();
      sealed.set(token, { secret, context: JSON.stringify(binding) });
      return token;
    },
    unseal(token, binding) {
      const row = sealed.get(token);
      if (!row || row.context !== JSON.stringify(binding)) throw new Error("Invalid secret context");
      return row.secret;
    }
  };
  const allowAttempt = vi.fn(() => true);
  const mfa = new MfaService(store, secrets, { allowAttempt });
  const lifecycleTokens = new InMemoryAuthLifecycleTokenStore([]);
  const identity = { providerId: "provider", subject: "external-user", tenantId: "tenant", email: user.email, emailVerified: true };
  const options: PasswordAuthOptions = {
    secret: AUTH_SECRET, userStore: users, mfa: configured ? mfa : undefined, lifecycleTokens,
    identityLinkingPolicy: { mode: "email", autoLink: true },
    providers: [{ id: "provider", authenticate: async () => identity, completeAuthorization: async () => ({ identity, returnTo: "/home" }) }]
  };
  const auth = new PasswordAuthService(options);
  async function enable() {
    const binding = { purpose: "framekit.mfa.totp.v1" as const, tenantId: "tenant", userId: "user", enrollmentId: crypto.randomUUID() };
    await store.compareAndSet({ ...binding, encryptedSecret: await secrets.seal(RFC_SECRET, binding), pendingUntil: Date.now() + 600_000, recoveryHashes: [], revision: 1 }, undefined);
    const result = await auth.confirmMfaEnrollment(context, "287082");
    vi.setSystemTime(new Date(60_000));
    return result;
  }
  const login = () => auth.login(user.email, PASSWORD, user.tenantId);
  return { user, users, store, mfa, secrets, allowAttempt, lifecycleTokens, options, auth, enable, login };
}

async function challenge(promise: Promise<unknown>): Promise<{ challengeToken: string; expiresAt: string }> {
  try {
    await promise;
    throw new Error("Expected MFA_REQUIRED");
  } catch (error) {
    expect(error).toBeInstanceOf(FramekitError);
    expect(error).toMatchObject({ code: "MFA_REQUIRED", statusCode: 401, details: { challengeToken: expect.any(String), expiresAt: expect.any(String) } });
    return (error as FramekitError).details as { challengeToken: string; expiresAt: string };
  }
}

function payload(token: string): Record<string, unknown> {
  return JSON.parse(base64UrlDecode(token.split(".")[0]!)) as Record<string, unknown>;
}

async function signed(value: Record<string, unknown>): Promise<string> {
  const encoded = base64UrlEncode(JSON.stringify(value));
  return `${encoded}.${await sign(encoded, AUTH_SECRET)}`;
}

describe("password service MFA gate", () => {
  it.each([false, true])("preserves login and refresh without a factor (configured=%s)", async (configured) => {
    const f = await fixture(configured);
    const session = await f.login();
    expect(session.mfa).toBeUndefined();
    expect((await f.auth.verifyToken(session.token)).context).toEqual(context);
    expect((await f.auth.refreshSession(session.token)).mfa).toBeUndefined();
    expect(await f.auth.getMfaStatus(context)).toEqual({ enabled: false, pending: false, recoveryCodes: 0 });
  });

  it("requires a second factor and never accepts a challenge as a session or refresh token", async () => {
    const f = await fixture();
    await f.enable();
    const pending = await challenge(f.login());
    expect(Date.parse(pending.expiresAt) - Date.now()).toBe(300_000);
    expect(payload(pending.challengeToken)).toMatchObject({ purpose: "mfa_challenge", tenantId: "tenant", sub: "user" });
    await expect(f.auth.verifyToken(pending.challengeToken)).rejects.toMatchObject({ code: "INVALID_SESSION" });
    await expect(f.auth.verifyBearerToken(pending.challengeToken)).rejects.toMatchObject({ code: "INVALID_SESSION" });
    await expect(f.auth.refreshSession(pending.challengeToken)).rejects.toMatchObject({ code: "INVALID_SESSION" });
    await expect(f.auth.revokeSession(pending.challengeToken)).rejects.toMatchObject({ code: "INVALID_SESSION" });
    const session = await f.auth.completeMfaChallenge(pending.challengeToken, "359152");
    expect(session.mfa).toEqual({ enrollmentId: await f.mfa.getActiveEnrollmentId("tenant", "user"), verifiedAt: 60_000 });
    expect((await f.auth.verifyToken(session.token)).mfa).toEqual(session.mfa);
  });

  it("burns a challenge on an incorrect code and requires primary authentication again", async () => {
    const f = await fixture();
    await f.enable();
    const pending = await challenge(f.login());
    await expect(f.auth.completeMfaChallenge(pending.challengeToken, "000000")).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
    await expect(f.auth.completeMfaChallenge(pending.challengeToken, "359152")).rejects.toMatchObject({ code: "INVALID_LIFECYCLE_TOKEN" });
    const retry = await challenge(f.login());
    await expect(f.auth.completeMfaChallenge(retry.challengeToken, "359152")).resolves.toMatchObject({ user: { id: "user" } });
  });

  it("has one winner for concurrent redemption across service instances", async () => {
    const f = await fixture();
    await f.enable();
    const pending = await challenge(f.login());
    const other = new PasswordAuthService(f.options);
    const results = await Promise.allSettled([
      f.auth.completeMfaChallenge(pending.challengeToken, "359152"),
      other.completeMfaChallenge(pending.challengeToken, "359152")
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(other.completeMfaChallenge(pending.challengeToken, "969429")).rejects.toMatchObject({ code: "INVALID_LIFECYCLE_TOKEN" });
  });

  it("requires primary authentication even for valid MFA or recovery codes", async () => {
    const f = await fixture();
    const { recoveryCodes } = await f.enable();
    await expect(f.auth.completeMfaChallenge("invented", "359152")).rejects.toMatchObject({ code: "INVALID_MFA_CHALLENGE" });
    await expect(f.auth.completeMfaChallenge("invented", recoveryCodes[0]!, { recoveryCode: true })).rejects.toMatchObject({ code: "INVALID_MFA_CHALLENGE" });
    await expect(f.auth.login(f.user.email, "wrong password", "tenant")).rejects.toMatchObject({ code: "INVALID_LOGIN" });
  });

  it("accepts a recovery code only once, including across separate primary-auth challenges", async () => {
    const f = await fixture();
    const { recoveryCodes } = await f.enable();
    const first = await challenge(f.login());
    const second = await challenge(f.login());
    const results = await Promise.allSettled([first, second].map((pending) => f.auth.completeMfaChallenge(pending.challengeToken, recoveryCodes[0]!, { recoveryCode: true })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("recovers a lost authenticator using separate sign-in and disable codes, then enrolls a replacement", async () => {
    const f = await fixture();
    const { recoveryCodes } = await f.enable();
    const pending = await challenge(f.login());
    const recovered = await f.auth.completeMfaChallenge(pending.challengeToken, recoveryCodes[0]!, { recoveryCode: true });
    await f.auth.assertRecentPrimaryAuth(recovered.token);
    await expect(f.auth.disableMfa(recovered.context, recoveryCodes[0]!, { recoveryCode: true })).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
    await f.auth.disableMfa(recovered.context, recoveryCodes[1]!, { recoveryCode: true });
    await expect(f.auth.verifyToken(recovered.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });
    const primary = await f.login();
    await f.auth.assertRecentPrimaryAuth(primary.token);
    const enrollment = await f.auth.beginMfaEnrollment(primary.context);
    const replacement = await f.auth.confirmMfaEnrollment(primary.context, await totp(enrollment.secret, 2));
    await expect(f.auth.disableMfa(primary.context, recoveryCodes[2]!, { recoveryCode: true })).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
    await expect(f.auth.verifyToken(primary.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });
    const next = await challenge(f.login());
    await expect(f.auth.completeMfaChallenge(next.challengeToken, replacement.recoveryCodes[0]!, { recoveryCode: true })).resolves.toMatchObject({ user: { id: "user" } });
  });

  it("expires challenges at the deadline and when verification crosses the deadline", async () => {
    const f = await fixture();
    await f.enable();
    const expired = await challenge(f.login());
    vi.setSystemTime(new Date(expired.expiresAt));
    await expect(f.auth.completeMfaChallenge(expired.challengeToken, await totp(RFC_SECRET, 12))).rejects.toMatchObject({ code: "INVALID_MFA_CHALLENGE" });
    const pending = await challenge(f.login());
    const verify = f.mfa.verifyChallenge.bind(f.mfa);
    vi.spyOn(f.mfa, "verifyChallenge").mockImplementation(async (...args) => {
      const result = await verify(...args);
      vi.setSystemTime(new Date(pending.expiresAt));
      return result;
    });
    await expect(f.auth.completeMfaChallenge(pending.challengeToken, await totp(RFC_SECRET, 12))).rejects.toMatchObject({ code: "INVALID_MFA_CHALLENGE" });
  });

  it.each(["signature", "tenantId", "sub", "purpose", "enrollmentId", "cb", "exp"])("rejects challenge tampering with %s", async (field) => {
    const f = await fixture();
    await f.enable();
    const pending = await challenge(f.login());
    const modified = payload(pending.challengeToken);
    modified[field] = field === "exp" ? 999999999 : "changed";
    const token = field === "signature" ? `${pending.challengeToken}x` : `${base64UrlEncode(JSON.stringify(modified))}.${pending.challengeToken.split(".")[1]}`;
    await expect(f.auth.completeMfaChallenge(token, "359152")).rejects.toMatchObject({ code: "INVALID_MFA_CHALLENGE" });
  });

  it.each(["disabled", "deleted", "password", "factor"])("invalidates an issued challenge when the %s state changes", async (change) => {
    const f = await fixture();
    await f.enable();
    const pending = await challenge(f.login());
    if (change === "disabled") await f.users.upsert({ ...f.user, disabledAt: new Date().toISOString() });
    if (change === "deleted") await f.users.delete("tenant", "user");
    if (change === "password") await f.auth.resetPassword("tenant", "user", "new password");
    if (change === "factor") {
      await f.auth.disableMfa(context, "359152");
      const enrollment = await f.auth.beginMfaEnrollment(context);
      await f.auth.confirmMfaEnrollment(context, await totp(enrollment.secret, 2));
    }
    await expect(f.auth.completeMfaChallenge(pending.challengeToken, "359152")).rejects.toBeInstanceOf(FramekitError);
  });

  it("does not issue a session if credentials change during MFA verification", async () => {
    const f = await fixture();
    await f.enable();
    const pending = await challenge(f.login());
    const verify = f.mfa.verifyChallenge.bind(f.mfa);
    vi.spyOn(f.mfa, "verifyChallenge").mockImplementation(async (...args) => {
      const result = await verify(...args);
      await f.auth.resetPassword("tenant", "user", "new password");
      return result;
    });
    await expect(f.auth.completeMfaChallenge(pending.challengeToken, "359152")).rejects.toMatchObject({ code: "INVALID_SESSION" });
  });

  it("does not issue a session if the factor is disabled during MFA verification", async () => {
    const f = await fixture();
    await f.enable();
    const pending = await challenge(f.login());
    const verify = f.mfa.verifyChallenge.bind(f.mfa);
    vi.spyOn(f.mfa, "verifyChallenge").mockImplementation(async (...args) => {
      const result = await verify(...args);
      vi.setSystemTime(new Date(90_000));
      await f.auth.disableMfa(context, "969429");
      return result;
    });
    await expect(f.auth.completeMfaChallenge(pending.challengeToken, "359152")).rejects.toMatchObject({ code: "INVALID_SESSION" });
  });

  it("applies the same gate to provider tokens, OIDC callbacks, and direct session creation", async () => {
    const f = await fixture();
    await f.enable();
    await challenge(f.auth.loginWithProvider("provider", "valid-provider-token", "tenant"));
    await challenge(f.auth.completeProviderAuthorization("provider", { code: "code", state: "bound-state" }));
    await challenge(f.auth.createSession(f.user));
  });

  it("keeps MFA enabled through password recovery", async () => {
    const f = await fixture();
    await f.enable();
    const recovery = await f.auth.createRecoveryToken("tenant", "user");
    await f.auth.completePasswordRecovery({ tenantId: "tenant", token: recovery.token, kind: "recovery", newPassword: "recovered password" });
    await challenge(f.auth.login(f.user.email, "recovered password", "tenant"));
  });

  it("runs invitation-created automatic sessions through the central gate", async () => {
    const f = await fixture();
    const invitation = await f.auth.createInvitation({ tenantId: "tenant", email: "invitee@example.com", name: "Invitee", roles: [], permissions: [] });
    const upsert = f.users.upsert.bind(f.users);
    vi.spyOn(f.users, "upsert").mockImplementation(async (user) => {
      const result = await upsert(user);
      // Simulate a provisioner attaching a factor before the automatic session.
      const enrollment = await f.mfa.beginEnrollment(user.tenantId, user.id);
      await f.mfa.confirmEnrollment(user.tenantId, user.id, await totp(enrollment.secret, 1));
      return result;
    });
    await challenge(f.auth.acceptInvitation({ tenantId: "tenant", token: invitation.token, password: PASSWORD }));
  });
});

describe("MFA session binding and recent authentication", () => {
  async function authenticated() {
    const f = await fixture();
    await f.enable();
    const pending = await challenge(f.login());
    const session = await f.auth.completeMfaChallenge(pending.challengeToken, "359152");
    return { ...f, session };
  }

  it("invalidates sessions minted before enrollment confirmation", async () => {
    const f = await fixture();
    const before = await f.login();
    await f.enable();
    await expect(f.auth.verifyToken(before.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });
    await expect(f.auth.refreshSession(before.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });
  });

  it("never revives pre-MFA sessions after disable or while a replacement is pending", async () => {
    const f = await fixture();
    const before = await f.login();
    await f.enable();
    await f.auth.disableMfa(context, "359152");
    await expect(f.auth.verifyToken(before.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });
    const afterDisable = await f.login();
    const replacement = await f.auth.beginMfaEnrollment(context);
    await expect(f.auth.verifyToken(afterDisable.token)).resolves.toMatchObject({ user: { id: "user" } });
    await expect(f.auth.verifyToken(before.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });
    await f.auth.confirmMfaEnrollment(context, await totp(replacement.secret, 2));
    await expect(f.auth.verifyToken(afterDisable.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });
  });

  it("preserves original primary and MFA proof timestamps on refresh", async () => {
    const f = await authenticated();
    vi.setSystemTime(new Date(120_000));
    const refreshed = await f.auth.refreshSession(f.session.token);
    expect(refreshed.authenticatedAt).toBe(f.session.authenticatedAt);
    expect(refreshed.mfa).toEqual(f.session.mfa);
    await expect(f.auth.verifyToken(f.session.token)).rejects.toMatchObject({ code: "SESSION_REVOKED" });
    expect((await f.auth.verifyToken(refreshed.token)).mfa).toEqual(f.session.mfa);
    await expect(f.auth.assertRecentPrimaryAuth(refreshed.token)).resolves.toMatchObject({ user: { id: "user" } });
    await expect(f.auth.enforceRecentMfa(refreshed.token)).resolves.toMatchObject({ user: { id: "user" } });
    vi.setSystemTime(new Date(360_000));
    await expect(f.auth.assertRecentPrimaryAuth(refreshed.token)).rejects.toMatchObject({ code: "AUTH_REAUTHENTICATION_REQUIRED" });
    await expect(f.auth.enforceRecentMfa(refreshed.token)).rejects.toMatchObject({ code: "MFA_STEP_UP_REQUIRED" });
  });

  it("rejects session proof tampering and tokens checked without the configured MFA service", async () => {
    const f = await authenticated();
    const data = payload(f.session.token);
    delete data.mfa;
    await expect(f.auth.verifyToken(await signed(data))).rejects.toMatchObject({ code: "INVALID_SESSION" });
    data.mfa = { enrollmentId: "wrong", verifiedAt: 60_000 };
    await expect(f.auth.verifyToken(await signed(data))).rejects.toMatchObject({ code: "INVALID_SESSION" });
    const unconfigured = new PasswordAuthService({ ...f.options, mfa: undefined });
    await expect(unconfigured.verifyToken(f.session.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });
    await expect(f.auth.completeMfaChallenge(f.session.token, "359152")).rejects.toMatchObject({ code: "INVALID_MFA_CHALLENGE" });
  });

  it("revokes MFA-bound sessions after disable and refuses refresh", async () => {
    const f = await authenticated();
    vi.setSystemTime(new Date(90_000));
    await f.auth.disableMfa(context, "969429");
    await expect(f.auth.verifyToken(f.session.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });
    await expect(f.auth.refreshSession(f.session.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });
    expect((await f.login()).mfa).toBeUndefined();
  });

  it("does not upgrade old credentials when a password changes during refresh", async () => {
    const f = await authenticated();
    const revoke = f.auth.revokeSession.bind(f.auth);
    vi.spyOn(f.auth, "revokeSession").mockImplementation(async (token) => {
      await revoke(token);
      await f.auth.resetPassword("tenant", "user", "new password");
    });
    await expect(f.auth.refreshSession(f.session.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });
  });

  it("allows the optional MFA policy without a factor but requires genuinely recent primary auth", async () => {
    const f = await fixture();
    const session = await f.login();
    vi.setSystemTime(new Date(400_000));
    await expect(f.auth.enforceRecentMfa(session.token)).resolves.toMatchObject({ user: { id: "user" } });
    await expect(f.auth.assertRecentPrimaryAuth(session.token)).rejects.toMatchObject({ code: "AUTH_REAUTHENTICATION_REQUIRED" });
    const legacy = payload(session.token);
    delete legacy.authenticatedAt;
    await expect(f.auth.assertRecentPrimaryAuth(await signed(legacy))).rejects.toMatchObject({ code: "AUTH_REAUTHENTICATION_REQUIRED" });
  });

  it("scopes wrappers to the authenticated identity and rejects deleted/disabled accounts", async () => {
    const f = await fixture();
    await expect(f.auth.beginMfaEnrollment({ ...context, tenantId: "other" })).rejects.toMatchObject({ code: "INVALID_SESSION" });
    const enrollment = await f.auth.beginMfaEnrollment(context);
    expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(await f.auth.getMfaStatus(context)).toMatchObject({ pending: true });
    await f.users.upsert({ ...f.user, disabledAt: new Date().toISOString() });
    await expect(f.auth.confirmMfaEnrollment(context, await totp(enrollment.secret, 1))).rejects.toMatchObject({ code: "USER_DISABLED" });
    await f.users.delete("tenant", "user");
    await expect(f.auth.getMfaStatus(context)).rejects.toMatchObject({ code: "INVALID_SESSION" });
  });

  it("fails closed if the attempt limiter is unavailable", async () => {
    const f = await fixture();
    await f.enable();
    const pending = await challenge(f.login());
    f.allowAttempt.mockReturnValue(false);
    await expect(f.auth.completeMfaChallenge(pending.challengeToken, "359152")).rejects.toMatchObject({ code: "MFA_RATE_LIMITED" });
    f.allowAttempt.mockReturnValue(true);
    await expect(f.auth.completeMfaChallenge(pending.challengeToken, "359152")).rejects.toMatchObject({ code: "INVALID_LIFECYCLE_TOKEN" });
  });
});

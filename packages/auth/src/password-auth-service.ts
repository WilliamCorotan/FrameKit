import { FramekitError, type TenantContext } from "@framekit/core";
import type { MfaSessionProof } from "./contracts.js";
import type { MfaCodeOptions, MfaService } from "./mfa.js";
import type { ApiTokenSession, ApiTokenStore, AuthAuditEvent, AuthAuditSink, AuthIdentityLink, AuthIdentityLinkingPolicy, AuthIdentityLinkStore, AuthIdentityProvider, AuthProviderIdentity, AuthLifecycleToken, AuthLifecycleTokenKind, AuthLifecycleTokenStore, AuthRole, AuthSession, AuthUser, CreatedApiToken, CreateApiTokenInput, PasswordAuthOptions, PublicApiToken, PublicAuthUser, RoleStore, SessionRevocationStore, UpsertUserInput } from "./contracts.js";
import { base64UrlDecode, base64UrlEncode, constantEqual, hashApiToken, hashOpaqueToken, randomTokenSecret, sign } from "./crypto.js";
import { InMemoryApiTokenStore, InMemoryAuthIdentityLinkStore, InMemoryAuthLifecycleTokenStore, InMemoryRoleStore, InMemorySessionRevocationStore, NoopAuthAuditSink } from "./in-memory-stores.js";
import { hashPassword, verifyPassword, assertSecureAuthSecret } from "./password-policy.js";
import { authErrorCode, authErrorTenant, normalizeEmail, normalizeExpiresAt, normalizeRequiredFutureDate, publicApiToken, publicUser, safeReturnTo } from "./shared.js";

type SessionPayload = {
  purpose?: "session";
  sub: string;
  tenantId: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  exp: number;
  jti?: string;
  cb?: string;
  mfa?: MfaSessionProof;
  mfaVersion?: string;
  authenticatedAt?: number;
};

type MfaChallengePayload = {
  purpose: "mfa_challenge";
  sub: string;
  tenantId: string;
  exp: number;
  jti: string;
  cb: string;
  enrollmentId: string;
  authenticatedAt: number;
};

export class PasswordAuthService {
  private readonly sessionTtlSeconds: number;
  private readonly roleStore: RoleStore;
  private readonly apiTokenStore: ApiTokenStore;
  private readonly sessionRevocations: SessionRevocationStore;
  private readonly audit: AuthAuditSink;
  private readonly providers: Map<string, AuthIdentityProvider>;
  private readonly identityLinks: AuthIdentityLinkStore;
  private readonly lifecycleTokens: AuthLifecycleTokenStore;
  private readonly identityLinkingPolicy: AuthIdentityLinkingPolicy;
  private readonly maxFailedLoginAttempts: number;
  private readonly lockoutSeconds: number;
  private readonly invitationTtlSeconds: number;
  private readonly recoveryTtlSeconds: number;

  constructor(private readonly options: PasswordAuthOptions) {
    assertSecureAuthSecret(options.secret);
    this.sessionTtlSeconds = options.sessionTtlSeconds ?? 60 * 60 * 8;
    this.roleStore = options.roleStore ?? new InMemoryRoleStore([]);
    this.apiTokenStore = options.apiTokenStore ?? new InMemoryApiTokenStore([]);
    this.sessionRevocations = options.sessionRevocations ?? new InMemorySessionRevocationStore();
    this.audit = options.audit ?? new NoopAuthAuditSink();
    this.providers = new Map((options.providers ?? []).map((provider) => [provider.id, provider]));
    this.identityLinks = options.identityLinks ?? new InMemoryAuthIdentityLinkStore([]);
    this.lifecycleTokens = options.lifecycleTokens ?? new InMemoryAuthLifecycleTokenStore([]);
    this.identityLinkingPolicy = options.identityLinkingPolicy ?? { mode: "linked" };
    this.maxFailedLoginAttempts = options.maxFailedLoginAttempts ?? 5;
    this.lockoutSeconds = options.lockoutSeconds ?? 15 * 60;
    this.invitationTtlSeconds = options.invitationTtlSeconds ?? 72 * 60 * 60;
    this.recoveryTtlSeconds = options.recoveryTtlSeconds ?? 30 * 60;
  }

  async login(email: string, password: string, tenantId = "default"): Promise<AuthSession> {
    let user = await this.options.userStore.findByEmail(normalizeEmail(email), tenantId);
    if (!user) {
      await this.recordAuthAudit({ tenantId, action: "login.failed", success: false, details: { email: normalizeEmail(email), reason: "not_found" } });
      throw new FramekitError("INVALID_LOGIN", "Invalid email or password.", 401);
    }
    user = await this.normalizeExpiredLockout(user);
    this.assertUserCanLogin(user);
    if (!(await verifyPassword(password, user.passwordHash))) {
      await this.recordFailedLogin(user);
      await this.recordAuthAudit({ tenantId, targetUserId: user.id, action: "login.failed", success: false, details: { email: user.email, reason: "invalid_password" } });
      throw new FramekitError("INVALID_LOGIN", "Invalid email or password.", 401);
    }
    user = await this.updateLoginState(user, "succeeded");
    const session = await this.createSession(user);
    await this.recordAuthAudit({ tenantId, actorUserId: user.id, targetUserId: user.id, action: "login.succeeded", success: true, details: { sessionId: session.sessionId } });
    return session;
  }

  async loginWithProvider(providerId: string, token: string, tenantId = "default"): Promise<AuthSession> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new FramekitError("AUTH_PROVIDER_NOT_FOUND", `No auth provider with id "${providerId}"`, 404);
    }
    const identity = await provider.authenticate({ token, tenantId });
    if (identity.tenantId && identity.tenantId !== tenantId) {
      await this.recordAuthAudit({ tenantId, action: "provider_login.failed", success: false, details: { providerId, subject: identity.subject, reason: "tenant_mismatch" } });
      throw new FramekitError("PROVIDER_TENANT_MISMATCH", "Provider identity tenant did not match the requested tenant.", 401);
    }
    return this.loginWithProviderIdentity(providerId, identity, tenantId);
  }

  async beginProviderAuthorization(providerId: string, input: { tenantId?: string; returnTo?: string } = {}): Promise<{ authorizationUrl: string }> {
    const provider = this.providers.get(providerId);
    if (!provider?.beginAuthorization) {
      throw new FramekitError("OIDC_CODE_FLOW_NOT_CONFIGURED", `Provider "${providerId}" does not support authorization-code flow.`, 501);
    }
    const tenantId = input.tenantId ?? "default";
    const result = await provider.beginAuthorization({ tenantId, returnTo: safeReturnTo(input.returnTo) });
    await this.recordAuthAudit({ tenantId, action: "provider_authorization.started", success: true, details: { providerId } });
    return { authorizationUrl: result.authorizationUrl };
  }

  async completeProviderAuthorization(providerId: string, input: { code: string; state: string }): Promise<{ session: AuthSession; returnTo: string }> {
    const provider = this.providers.get(providerId);
    if (!provider?.completeAuthorization) {
      throw new FramekitError("OIDC_CODE_FLOW_NOT_CONFIGURED", `Provider "${providerId}" does not support authorization-code flow.`, 501);
    }
    try {
      const result = await provider.completeAuthorization(input);
      const returnTo = safeReturnTo(result.returnTo);
      try {
        return { session: await this.loginWithProviderIdentity(providerId, result.identity, result.identity.tenantId ?? "default"), returnTo };
      } catch (error) {
        if (error instanceof FramekitError && error.code === "MFA_REQUIRED" && error.details && typeof error.details === "object") {
          throw new FramekitError(error.code, error.message, error.statusCode, { ...(error.details as Record<string, unknown>), returnTo });
        }
        throw error;
      }
    } catch (error) {
      await this.recordAuthAudit({ tenantId: authErrorTenant(error) ?? "default", action: "provider_authorization.failed", success: false, details: { providerId, reason: authErrorCode(error) } });
      throw error;
    }
  }

  private async loginWithProviderIdentity(providerId: string, identity: AuthProviderIdentity, tenantId: string): Promise<AuthSession> {
    const resolvedTenantId = identity.tenantId ?? tenantId;
    if (identity.providerId !== providerId) {
      await this.recordAuthAudit({
        tenantId: resolvedTenantId,
        action: "provider_login.failed",
        success: false,
        details: { providerId, returnedProviderId: identity.providerId, subject: identity.subject, reason: "provider_mismatch" }
      });
      throw new FramekitError("PROVIDER_ID_MISMATCH", "Provider identity did not match the selected provider.", 401);
    }
    const user = await this.resolveProviderUser(identity, resolvedTenantId);
    if (!user) {
      await this.recordAuthAudit({
        tenantId: resolvedTenantId,
        action: "provider_login.failed",
        success: false,
        details: {
          providerId,
          subject: identity.subject,
          email: normalizeEmail(identity.email),
          policy: this.identityLinkingPolicy.mode,
          reason: "user_not_found"
        }
      });
      throw new FramekitError("PROVIDER_USER_NOT_FOUND", "Provider identity is not linked to a user.", 401);
    }
    this.assertUserCanLogin(user);
    const session = await this.createSession(user);
    await this.recordAuthAudit({
      tenantId: resolvedTenantId,
      actorUserId: user.id,
      targetUserId: user.id,
      action: "provider_login.succeeded",
      success: true,
      details: { providerId, subject: identity.subject, sessionId: session.sessionId }
    });
    return session;
  }

  async linkProviderIdentity(input: { tenantId: string; providerId: string; subject: string; userId: string; email?: string }): Promise<AuthIdentityLink> {
    const user = await this.options.userStore.findById(input.tenantId, input.userId);
    if (!user) {
      throw new FramekitError("USER_NOT_FOUND", `No user with id "${input.userId}"`, 404);
    }
    const now = new Date().toISOString();
    const existing = await this.identityLinks.find(input.tenantId, input.providerId, input.subject);
    if (existing && existing.userId !== input.userId) {
      await this.recordAuthAudit({
        tenantId: input.tenantId,
        targetUserId: input.userId,
        action: "provider_identity.link_failed",
        success: false,
        details: { providerId: input.providerId, subject: input.subject, reason: "subject_collision" }
      });
      throw new FramekitError("PROVIDER_IDENTITY_COLLISION", "Provider subject is already linked to another user in this tenant.", 409);
    }
    const link = await this.identityLinks.upsert({
      tenantId: input.tenantId,
      providerId: input.providerId,
      subject: input.subject,
      userId: input.userId,
      email: input.email ? normalizeEmail(input.email) : undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    await this.recordAuthAudit({
      tenantId: input.tenantId,
      targetUserId: input.userId,
      action: "provider_identity.linked",
      success: true,
      details: { providerId: input.providerId, subject: input.subject }
    });
    return link;
  }

  async createInvitation(input: { tenantId: string; email: string; name: string; roles: string[]; permissions: string[]; expiresAt?: string }): Promise<{ token: string; expiresAt: string }> {
    const email = normalizeEmail(input.email);
    if (await this.options.userStore.findByEmail(email, input.tenantId)) {
      await this.recordAuthAudit({ tenantId: input.tenantId, action: "invitation.create_failed", success: false, details: { email, reason: "user_exists" } });
      throw new FramekitError("USER_EXISTS", "A user with this email already exists in the tenant.", 409);
    }
    const issued = await this.issueLifecycleToken({ ...input, email, kind: "invitation", ttlSeconds: this.invitationTtlSeconds });
    await this.recordAuthAudit({ tenantId: input.tenantId, action: "invitation.created", success: true, details: { invitationId: issued.record.id, email, expiresAt: issued.record.expiresAt } });
    return { token: issued.token, expiresAt: issued.record.expiresAt };
  }

  async acceptInvitation(input: { tenantId: string; token: string; password: string }): Promise<AuthSession> {
    const record = await this.consumeLifecycleToken(input.tenantId, "invitation", input.token);
    if (!record.email || !record.name) throw new FramekitError("INVALID_LIFECYCLE_TOKEN", "Invitation is incomplete.", 401);
    if (await this.options.userStore.findByEmail(record.email, input.tenantId)) {
      throw new FramekitError("USER_EXISTS", "A user with this email already exists in the tenant.", 409);
    }
    const user = await this.options.userStore.upsert({
      id: crypto.randomUUID(), tenantId: input.tenantId, email: record.email, name: record.name,
      passwordHash: await hashPassword(input.password), roles: record.roles ?? [], permissions: record.permissions ?? [], failedLoginAttempts: 0
    });
    await this.recordAuthAudit({ tenantId: input.tenantId, actorUserId: user.id, targetUserId: user.id, action: "invitation.accepted", success: true, details: { invitationId: record.id } });
    return this.createSession(user);
  }

  async requestPasswordReset(tenantId: string, email: string): Promise<{ token?: string; expiresAt?: string }> {
    const user = await this.options.userStore.findByEmail(normalizeEmail(email), tenantId);
    if (!user || user.disabledAt) {
      await this.recordAuthAudit({ tenantId, targetUserId: user?.id, action: "password_reset.requested", success: false, details: { reason: user?.disabledAt ? "disabled" : "not_found" } });
      return {};
    }
    const issued = await this.issueLifecycleToken({ tenantId, userId: user.id, kind: "password_reset", ttlSeconds: this.recoveryTtlSeconds });
    try {
      await this.options.lifecycleDelivery?.({ kind: "password_reset", tenantId, userId: user.id, email: user.email, token: issued.token, expiresAt: issued.record.expiresAt });
    } catch {
      await this.recordAuthAudit({ tenantId, targetUserId: user.id, action: "password_reset.delivery_failed", success: false, details: { tokenId: issued.record.id } });
    }
    await this.recordAuthAudit({ tenantId, targetUserId: user.id, action: "password_reset.requested", success: true, details: { tokenId: issued.record.id, expiresAt: issued.record.expiresAt } });
    return { token: issued.token, expiresAt: issued.record.expiresAt };
  }

  async createRecoveryToken(tenantId: string, userId: string): Promise<{ token: string; expiresAt: string }> {
    const user = await this.options.userStore.findById(tenantId, userId);
    if (!user) {
      await this.recordAuthAudit({ tenantId, targetUserId: userId, action: "recovery.create_failed", success: false, details: { reason: "not_found" } });
      throw new FramekitError("USER_NOT_FOUND", `No user with id "${userId}"`, 404);
    }
    try {
      this.assertUserCanLogin(user);
    } catch (error) {
      await this.recordAuthAudit({ tenantId, targetUserId: userId, action: "recovery.create_failed", success: false, details: { reason: authErrorCode(error) } });
      throw error;
    }
    const issued = await this.issueLifecycleToken({ tenantId, userId, kind: "recovery", ttlSeconds: this.recoveryTtlSeconds });
    await this.recordAuthAudit({ tenantId, targetUserId: userId, action: "recovery.created", success: true, details: { tokenId: issued.record.id, expiresAt: issued.record.expiresAt } });
    return { token: issued.token, expiresAt: issued.record.expiresAt };
  }

  async completePasswordRecovery(input: { tenantId: string; token: string; newPassword: string; kind?: "password_reset" | "recovery" }): Promise<void> {
    const kind = input.kind ?? "password_reset";
    const record = await this.consumeLifecycleToken(input.tenantId, kind, input.token);
    if (!record.userId) throw new FramekitError("INVALID_LIFECYCLE_TOKEN", "Recovery token has no user.", 401);
    const user = await this.options.userStore.findById(input.tenantId, record.userId);
    if (!user) throw new FramekitError("USER_NOT_FOUND", "Recovery user no longer exists.", 404);
    try {
      this.assertUserCanLogin(user);
    } catch (error) {
      await this.recordAuthAudit({ tenantId: input.tenantId, targetUserId: record.userId, action: `${kind}.failed`, success: false, details: { tokenId: record.id, reason: authErrorCode(error) } });
      throw error;
    }
    await this.replacePassword(user, input.newPassword);
    await this.recordAuthAudit({ tenantId: input.tenantId, targetUserId: user.id, action: `${kind}.completed`, success: true, details: { tokenId: record.id } });
  }

  async verifyBearerToken(token: string): Promise<AuthSession | ApiTokenSession> {
    if (token.startsWith("fkat_")) {
      return this.verifyApiToken(token);
    }
    return this.verifyToken(token);
  }

  async verifyToken(token: string): Promise<AuthSession> {
    const payload = await this.readSessionPayload(token);
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new FramekitError("SESSION_EXPIRED", "Session token has expired.", 401);
    }
    if (payload.jti && await this.sessionRevocations.isRevoked(payload.jti)) {
      throw new FramekitError("SESSION_REVOKED", "Session token has been revoked.", 401);
    }
    const user = await this.options.userStore.findById(payload.tenantId, payload.sub);
    if (!user) {
      throw new FramekitError("INVALID_SESSION", "Session user no longer exists.", 401);
    }
    if (!payload.cb || !constantEqual(payload.cb, await this.sessionCredentialBinding(user))) {
      throw new FramekitError("INVALID_SESSION", "Session credentials are no longer valid.", 401);
    }
    this.assertUserCanLogin(user);
    await this.assertMfaProof(user, payload.mfa, payload.mfaVersion);
    return this.sessionFromUser(user, token, new Date(payload.exp * 1000).toISOString(), payload.jti, payload.mfa, payload.authenticatedAt);
  }

  async verifyApiToken(token: string): Promise<ApiTokenSession> {
    const tokenHash = await hashApiToken(token);
    const record = await this.apiTokenStore.findByTokenHash(tokenHash);
    if (!record || record.revokedAt) {
      throw new FramekitError("INVALID_API_TOKEN", "API token is invalid or revoked.", 401);
    }
    if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
      throw new FramekitError("API_TOKEN_EXPIRED", "API token has expired.", 401);
    }
    const user = record.userId ? await this.options.userStore.findById(record.tenantId, record.userId) : undefined;
    if (record.userId && !user) {
      throw new FramekitError("INVALID_API_TOKEN", "API token owner no longer exists.", 401);
    }
    if (user) {
      this.assertUserCanLogin(user);
    }
    const permissions = await this.permissionsFor(record.tenantId, record.roles, record.permissions);
    return {
      token,
      apiToken: publicApiToken(record),
      user: user ? publicUser(user) : undefined,
      context: {
        tenantId: record.tenantId,
        userId: record.userId ?? `api-token:${record.id}`,
        roles: record.roles,
        permissions
      }
    };
  }

  async completeMfaChallenge(challengeToken: string, code: string, options: MfaCodeOptions = {}): Promise<AuthSession> {
    const mfa = this.requireMfa();
    const payload = await this.readMfaChallenge(challengeToken);
    // Consume before checking the factor: every challenge grants exactly one attempt.
    const record = await this.consumeLifecycleToken(payload.tenantId, "mfa_challenge", challengeToken);
    if (record.id !== payload.jti || record.userId !== payload.sub) throw this.invalidMfaChallenge();
    const user = await this.options.userStore.findById(payload.tenantId, payload.sub);
    if (!user || !constantEqual(payload.cb, await this.sessionCredentialBinding(user))) throw this.invalidMfaChallenge();
    this.assertUserCanLogin(user);
    const verified = options.recoveryCode === true
      ? await mfa.useRecoveryCode(user.tenantId, user.id, code, payload.enrollmentId)
      : await mfa.verifyChallenge(user.tenantId, user.id, code, payload.enrollmentId);
    if (!verified) throw new FramekitError("MFA_CODE_INVALID", "MFA code is invalid.", 401);
    if (payload.exp * 1000 <= Date.now()) throw this.invalidMfaChallenge();
    const session = await this.issueSession(user, { enrollmentId: payload.enrollmentId, verifiedAt: Date.now() }, payload.authenticatedAt, payload.enrollmentId);
    await this.recordAuthAudit({ tenantId: user.tenantId, actorUserId: user.id, targetUserId: user.id, action: "mfa.login_succeeded", success: true, details: { sessionId: session.sessionId, recoveryCode: options.recoveryCode === true } });
    return session;
  }

  /** Context must come from a verified session, never from request-supplied identity fields. */
  async getMfaStatus(context: TenantContext): Promise<{ enabled: boolean; pending: boolean; recoveryCodes: number }> {
    const user = await this.mfaContextUser(context);
    return this.options.mfa?.status(user.tenantId, user.id) ?? { enabled: false, pending: false, recoveryCodes: 0 };
  }

  /** HTTP callers must also enforce assertRecentPrimaryAuth on the original session token. */
  async beginMfaEnrollment(context: TenantContext): Promise<{ secret: string; expiresAt: string }> {
    const user = await this.mfaContextUser(context);
    return this.requireMfa().beginEnrollment(user.tenantId, user.id);
  }

  async confirmMfaEnrollment(context: TenantContext, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.mfaContextUser(context);
    return this.requireMfa().confirmEnrollment(user.tenantId, user.id, code);
  }

  /** HTTP callers must also enforce assertRecentPrimaryAuth on the original session token. */
  async disableMfa(context: TenantContext, code: string, options: MfaCodeOptions = {}): Promise<void> {
    const user = await this.mfaContextUser(context);
    await this.requireMfa().disable(user.tenantId, user.id, code, options);
  }

  async assertRecentPrimaryAuth(token: string, maxAgeSeconds = 300): Promise<AuthSession> {
    this.validateProofMaxAge(maxAgeSeconds);
    const session = await this.verifyToken(token);
    if (session.authenticatedAt === undefined || Date.now() - session.authenticatedAt >= maxAgeSeconds * 1000) {
      throw new FramekitError("AUTH_REAUTHENTICATION_REQUIRED", "Sign in again before changing authentication settings.", 401);
    }
    return session;
  }

  async enforceRecentMfa(token: string, maxAgeSeconds = 300): Promise<AuthSession> {
    this.validateProofMaxAge(maxAgeSeconds);
    const session = await this.verifyToken(token);
    if (session.mfa && Date.now() - session.mfa.verifiedAt >= maxAgeSeconds * 1000) {
      throw new FramekitError("MFA_STEP_UP_REQUIRED", "Sign in with MFA again before this operation.", 401);
    }
    return session;
  }

  private validateProofMaxAge(maxAgeSeconds: number): void {
    if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) throw new TypeError("Authentication proof age must be a positive integer.");
  }

  private requireMfa(): MfaService {
    if (!this.options.mfa) throw new FramekitError("MFA_NOT_CONFIGURED", "MFA is not configured.", 501);
    return this.options.mfa;
  }

  private async mfaContextUser(context: TenantContext): Promise<AuthUser> {
    const user = await this.options.userStore.findById(context.tenantId, context.userId);
    if (!user) throw new FramekitError("INVALID_SESSION", "Session user no longer exists.", 401);
    this.assertUserCanLogin(user);
    return user;
  }

  private async currentCredentialUser(user: AuthUser): Promise<AuthUser> {
    const current = await this.options.userStore.findById(user.tenantId, user.id);
    if (!current || !constantEqual(current.passwordHash, user.passwordHash)) {
      throw new FramekitError("INVALID_SESSION", "Session credentials are no longer valid.", 401);
    }
    this.assertUserCanLogin(current);
    return current;
  }

  private async assertMfaProof(user: AuthUser, proof: MfaSessionProof | undefined, version: string | undefined): Promise<void> {
    const binding = await this.options.mfa?.getSessionBinding(user.tenantId, user.id);
    if (binding?.enrollmentId !== proof?.enrollmentId || binding?.version !== version) {
      throw new FramekitError("INVALID_SESSION", "Session MFA verification is no longer valid.", 401);
    }
  }

  private async requireMfaChallenge(user: AuthUser, enrollmentId: string, authenticatedAt: number): Promise<never> {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const payload: MfaChallengePayload = {
      purpose: "mfa_challenge", sub: user.id, tenantId: user.tenantId,
      exp, jti: crypto.randomUUID(), cb: await this.sessionCredentialBinding(user), enrollmentId, authenticatedAt
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const challengeToken = `${encodedPayload}.${await sign(encodedPayload, this.options.secret)}`;
    const expiresAt = new Date(exp * 1000).toISOString();
    await this.lifecycleTokens.create({
      id: payload.jti, tenantId: user.tenantId, userId: user.id, kind: "mfa_challenge",
      tokenHash: await hashOpaqueToken(challengeToken), createdAt: new Date().toISOString(), expiresAt
    });
    throw new FramekitError("MFA_REQUIRED", "Complete MFA to sign in.", 401, { challengeToken, expiresAt });
  }

  private invalidMfaChallenge(): FramekitError {
    return new FramekitError("INVALID_MFA_CHALLENGE", "MFA challenge is invalid or expired.", 401);
  }

  private async readMfaChallenge(token: string): Promise<MfaChallengePayload> {
    const payload = await this.readSignedPayload(token, "INVALID_MFA_CHALLENGE");
    if (payload.purpose !== "mfa_challenge" || !this.validSubject(payload)
      || typeof payload.jti !== "string" || !payload.jti
      || typeof payload.enrollmentId !== "string" || !payload.enrollmentId
      || !this.validTimestamp(payload.authenticatedAt)
      || (payload.exp as number) * 1000 <= Date.now()) throw this.invalidMfaChallenge();
    return payload as MfaChallengePayload;
  }

  private async readSessionPayload(token: string): Promise<SessionPayload> {
    const payload = await this.readSignedPayload(token, "INVALID_SESSION");
    if ((payload.purpose !== undefined && payload.purpose !== "session") || !this.validSubject(payload)
      || (payload.jti !== undefined && typeof payload.jti !== "string")
      || (payload.mfaVersion !== undefined && (typeof payload.mfaVersion !== "string" || !payload.mfaVersion))
      || (payload.authenticatedAt !== undefined && !this.validTimestamp(payload.authenticatedAt))) {
      throw new FramekitError("INVALID_SESSION", "Session token payload is invalid.", 401);
    }
    if (payload.mfa !== undefined) {
      const proof = payload.mfa as Partial<MfaSessionProof> | null;
      if (!proof || typeof proof !== "object" || typeof proof.enrollmentId !== "string" || !proof.enrollmentId || !this.validTimestamp(proof.verifiedAt)) {
        throw new FramekitError("INVALID_SESSION", "Session MFA proof is invalid.", 401);
      }
    }
    return payload as SessionPayload;
  }

  private validSubject(payload: Record<string, unknown>): boolean {
    return typeof payload.sub === "string" && Boolean(payload.sub)
      && typeof payload.tenantId === "string" && Boolean(payload.tenantId)
      && typeof payload.cb === "string" && Boolean(payload.cb)
      && typeof payload.exp === "number" && Number.isSafeInteger(payload.exp) && payload.exp > 0 && payload.exp <= 8_640_000_000_000;
  }

  private validTimestamp(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= Date.now();
  }

  private async readSignedPayload(token: string, errorCode: string): Promise<Record<string, unknown>> {
    const invalid = () => new FramekitError(errorCode, "Authentication token is invalid.", 401);
    if (typeof token !== "string" || token.length > 65_536) throw invalid();
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw invalid();
    const [encodedPayload, signature] = parts as [string, string];
    if (!constantEqual(signature, await sign(encodedPayload, this.options.secret))) throw invalid();
    try {
      const payload: unknown = JSON.parse(base64UrlDecode(encodedPayload));
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw invalid();
      return payload as Record<string, unknown>;
    } catch {
      throw invalid();
    }
  }

  async createSession(user: AuthUser): Promise<AuthSession> {
    const current = await this.currentCredentialUser(user);
    const authenticatedAt = Date.now();
    const binding = await this.options.mfa?.getSessionBinding(current.tenantId, current.id);
    if (binding?.enrollmentId) await this.requireMfaChallenge(current, binding.enrollmentId, authenticatedAt);
    return this.issueSession(current, undefined, authenticatedAt, binding?.version);
  }

  private async issueSession(user: AuthUser, mfa: MfaSessionProof | undefined, authenticatedAt: number | undefined, mfaVersion: string | undefined): Promise<AuthSession> {
    user = await this.currentCredentialUser(user);
    await this.assertMfaProof(user, mfa, mfaVersion);
    const expiresAt = Math.floor(Date.now() / 1000) + this.sessionTtlSeconds;
    const sessionId = crypto.randomUUID();
    const payload: SessionPayload = {
      purpose: "session",
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      roles: user.roles,
      permissions: user.permissions,
      exp: expiresAt,
      jti: sessionId,
      cb: await this.sessionCredentialBinding(user),
      mfa,
      mfaVersion,
      authenticatedAt
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const token = `${encodedPayload}.${await sign(encodedPayload, this.options.secret)}`;
    return this.sessionFromUser(user, token, new Date(expiresAt * 1000).toISOString(), sessionId, mfa, authenticatedAt);
  }

  async refreshSession(token: string): Promise<AuthSession> {
    const current = await this.verifyToken(token);
    const payload = await this.readSessionPayload(token);
    await this.revokeSession(token);
    const user = await this.options.userStore.findById(current.context.tenantId, current.context.userId);
    if (!user) {
      throw new FramekitError("INVALID_SESSION", "Session user no longer exists.", 401);
    }
    if (!constantEqual(payload.cb!, await this.sessionCredentialBinding(user))) {
      throw new FramekitError("INVALID_SESSION", "Session credentials are no longer valid.", 401);
    }
    const session = await this.issueSession(user, current.mfa, current.authenticatedAt, payload.mfaVersion);
    await this.recordAuthAudit({
      tenantId: current.context.tenantId,
      actorUserId: current.context.userId,
      targetUserId: current.context.userId,
      action: "session.refreshed",
      success: true,
      details: { previousSessionId: current.sessionId, sessionId: session.sessionId }
    });
    return session;
  }

  async revokeSession(token: string): Promise<void> {
    const payload = await this.readSessionPayload(token);
    if (payload.jti) {
      await this.sessionRevocations.revoke(payload.jti, new Date(payload.exp * 1000).toISOString());
      await this.recordAuthAudit({
        tenantId: payload.tenantId,
        actorUserId: payload.sub,
        targetUserId: payload.sub,
        action: "session.revoked",
        success: true,
        details: { sessionId: payload.jti }
      });
    }
  }

  async listUsers(tenantId: string): Promise<PublicAuthUser[]> {
    return (await this.options.userStore.list(tenantId)).map(publicUser);
  }

  async upsertUser(input: UpsertUserInput): Promise<PublicAuthUser> {
    const id = input.id ?? crypto.randomUUID();
    const existing = await this.options.userStore.findById(input.tenantId, id);
    if (!existing && !input.password) {
      throw new FramekitError("VALIDATION_FAILED", "Password is required for new users.", 422);
    }
    const user = await this.options.userStore.upsert({
      id,
      tenantId: input.tenantId,
      email: normalizeEmail(input.email),
      name: input.name,
      passwordHash: input.password ? await hashPassword(input.password) : existing!.passwordHash,
      roles: input.roles,
      permissions: input.permissions,
      disabledAt: input.disabledAt ?? existing?.disabledAt,
      lockedUntil: input.lockedUntil ?? existing?.lockedUntil,
      failedLoginAttempts: existing?.failedLoginAttempts ?? 0
    });
    await this.recordAuthAudit({
      tenantId: input.tenantId,
      targetUserId: user.id,
      action: existing ? "user.updated" : "user.created",
      success: true,
      details: { email: user.email, roles: user.roles, permissions: user.permissions, disabled: Boolean(user.disabledAt) }
    });
    return publicUser(user);
  }

  async deleteUser(tenantId: string, userId: string): Promise<void> {
    await this.options.userStore.delete(tenantId, userId);
    await this.recordAuthAudit({ tenantId, targetUserId: userId, action: "user.deleted", success: true });
  }

  async changePassword(tenantId: string, userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.options.userStore.findById(tenantId, userId);
    if (!user) {
      throw new FramekitError("USER_NOT_FOUND", `No user with id "${userId}"`, 404);
    }
    this.assertUserCanLogin(user);
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      await this.recordFailedLogin(user);
      throw new FramekitError("INVALID_LOGIN", "Invalid email or password.", 401);
    }
    await this.replacePassword(user, newPassword);
    await this.recordAuthAudit({ tenantId, actorUserId: userId, targetUserId: userId, action: "password.changed", success: true });
  }

  async resetPassword(tenantId: string, userId: string, newPassword: string): Promise<void> {
    const user = await this.options.userStore.findById(tenantId, userId);
    if (!user) {
      throw new FramekitError("USER_NOT_FOUND", `No user with id "${userId}"`, 404);
    }
    await this.replacePassword(user, newPassword, true);
    await this.recordAuthAudit({ tenantId, targetUserId: userId, action: "password.reset", success: true });
  }

  async listRoles(tenantId: string): Promise<AuthRole[]> {
    return this.roleStore.list(tenantId);
  }

  async upsertRole(role: AuthRole): Promise<AuthRole> {
    const saved = await this.roleStore.upsert(role);
    await this.recordAuthAudit({ tenantId: role.tenantId, action: "role.upserted", success: true, details: { roleId: role.id, permissions: role.permissions } });
    return saved;
  }

  async deleteRole(tenantId: string, roleId: string): Promise<void> {
    await this.roleStore.delete(tenantId, roleId);
    await this.recordAuthAudit({ tenantId, action: "role.deleted", success: true, details: { roleId } });
  }

  async listApiTokens(tenantId: string): Promise<PublicApiToken[]> {
    return (await this.apiTokenStore.list(tenantId)).map(publicApiToken);
  }

  async createApiToken(input: CreateApiTokenInput): Promise<CreatedApiToken> {
    const expiresAt = normalizeExpiresAt(input.expiresAt);
    const id = input.id ?? crypto.randomUUID();
    const secret = randomTokenSecret();
    const token = `fkat_${id.replaceAll(/[^a-zA-Z0-9_-]+/g, "_")}_${secret}`;
    const now = new Date().toISOString();
    const record = await this.apiTokenStore.create({
      tenantId: input.tenantId,
      id,
      name: input.name,
      tokenHash: await hashApiToken(token),
      userId: input.userId,
      roles: input.roles,
      permissions: input.permissions,
      createdAt: now,
      expiresAt
    });
    await this.recordAuthAudit({ tenantId: input.tenantId, targetUserId: input.userId, action: "api_token.created", success: true, details: { tokenId: record.id, roles: record.roles } });
    return { ...publicApiToken(record), token };
  }

  async revokeApiToken(tenantId: string, tokenId: string): Promise<PublicApiToken> {
    const revoked = await this.apiTokenStore.revoke(tenantId, tokenId, new Date().toISOString());
    await this.recordAuthAudit({ tenantId, targetUserId: revoked.userId, action: "api_token.revoked", success: true, details: { tokenId } });
    return publicApiToken(revoked);
  }

  async authAuditEvents(tenantId: string): Promise<AuthAuditEvent[]> {
    return this.audit.list ? await this.audit.list(tenantId) : [];
  }

  private async sessionFromUser(user: AuthUser, token: string, expiresAt: string, sessionId?: string, mfa?: MfaSessionProof, authenticatedAt?: number): Promise<AuthSession> {
    const permissions = await this.permissionsFor(user.tenantId, user.roles, user.permissions);
    return {
      token,
      sessionId: sessionId ?? "legacy",
      user: publicUser(user),
      context: {
        tenantId: user.tenantId,
        userId: user.id,
        roles: user.roles,
        permissions
      },
      expiresAt,
      mfa,
      authenticatedAt
    };
  }

  private async permissionsFor(tenantId: string, roles: string[], directPermissions: string[]): Promise<string[]> {
    if (directPermissions.includes("*")) {
      return ["*"];
    }
    const rolePermissions = (await this.roleStore.list(tenantId))
      .filter((role) => roles.includes(role.id))
      .flatMap((role) => role.permissions);
    return [...new Set([...directPermissions, ...rolePermissions])].sort();
  }

  private async resolveProviderUser(identity: AuthProviderIdentity, tenantId: string): Promise<AuthUser | undefined> {
    const linked = await this.identityLinks.find(tenantId, identity.providerId, identity.subject);
    if (linked) {
      return this.options.userStore.findById(tenantId, linked.userId);
    }
    if (this.identityLinkingPolicy.mode === "linked") {
      return undefined;
    }
    if (!this.identityLinkingPolicy.autoLink || identity.emailVerified !== true) return undefined;
    const user = await this.options.userStore.findByEmail(normalizeEmail(identity.email), tenantId);
    if (user) {
      await this.linkProviderIdentity({
        tenantId,
        providerId: identity.providerId,
        subject: identity.subject,
        userId: user.id,
        email: identity.email
      });
    }
    return user;
  }

  private async sessionCredentialBinding(user: AuthUser): Promise<string> {
    return sign(JSON.stringify(["framekit:session:credential-binding:v1", user.tenantId, user.id, user.passwordHash]), this.options.secret);
  }

  private assertUserCanLogin(user: AuthUser): void {
    if (user.disabledAt) {
      throw new FramekitError("USER_DISABLED", "User account is disabled.", 403);
    }
    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      throw new FramekitError("USER_LOCKED", "User account is temporarily locked.", 423, { lockedUntil: user.lockedUntil });
    }
  }

  private async normalizeExpiredLockout(user: AuthUser): Promise<AuthUser> {
    if (user.lockedUntil && new Date(user.lockedUntil).getTime() <= Date.now()) {
      return this.updateLoginState(user, "clear_expired");
    }
    return user;
  }

  private async recordFailedLogin(user: AuthUser): Promise<void> {
    await this.updateLoginState(user, "failed");
  }

  private async updateLoginState(user: AuthUser, operation: "failed" | "succeeded" | "clear_expired"): Promise<AuthUser> {
    const updated = await this.options.userStore.updateLoginState({
      tenantId: user.tenantId,
      userId: user.id,
      expectedPasswordHash: user.passwordHash,
      operation,
      maxFailedLoginAttempts: this.maxFailedLoginAttempts,
      lockoutSeconds: this.lockoutSeconds,
      now: new Date().toISOString()
    });
    if (!updated) {
      throw new FramekitError("INVALID_LOGIN", "Invalid email or password.", 401);
    }
    return updated;
  }

  private async replacePassword(user: AuthUser, password: string, allowDisabled = false): Promise<AuthUser> {
    const updated = await this.options.userStore.updatePassword({
      tenantId: user.tenantId, userId: user.id, expectedPasswordHash: user.passwordHash,
      passwordHash: await hashPassword(password), allowDisabled
    });
    if (!updated) throw new FramekitError("INVALID_LOGIN", "Invalid email or password.", 401);
    return updated;
  }

  private async issueLifecycleToken(input: {
    tenantId: string;
    kind: AuthLifecycleTokenKind;
    ttlSeconds: number;
    expiresAt?: string;
    email?: string;
    userId?: string;
    name?: string;
    roles?: string[];
    permissions?: string[];
  }): Promise<{ token: string; record: AuthLifecycleToken }> {
    const token = randomTokenSecret();
    const createdAt = new Date().toISOString();
    const expiresAt = input.expiresAt ? normalizeRequiredFutureDate(input.expiresAt) : new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
    const record = await this.lifecycleTokens.create({
      id: crypto.randomUUID(), tenantId: input.tenantId, kind: input.kind, tokenHash: await hashOpaqueToken(token),
      email: input.email, userId: input.userId, name: input.name, roles: input.roles ? [...input.roles] : undefined,
      permissions: input.permissions ? [...input.permissions] : undefined, createdAt, expiresAt
    });
    return { token, record };
  }

  private async consumeLifecycleToken(tenantId: string, kind: AuthLifecycleTokenKind, token: string): Promise<AuthLifecycleToken> {
    const record = await this.lifecycleTokens.consume(tenantId, kind, await hashOpaqueToken(token), new Date().toISOString());
    if (!record) {
      await this.recordAuthAudit({ tenantId, action: `${kind}.failed`, success: false, details: { reason: "invalid_expired_or_replayed" } });
      throw new FramekitError("INVALID_LIFECYCLE_TOKEN", "Lifecycle token is invalid, expired, or already used.", 401);
    }
    return record;
  }

  private async recordAuthAudit(input: Omit<AuthAuditEvent, "id" | "createdAt">): Promise<void> {
    await this.audit.record({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...input
    });
  }
}

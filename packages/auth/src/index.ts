import type { TenantContext } from "@framekit/core";
import { FramekitError } from "@framekit/core";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  passwordHash: string;
  roles: string[];
  permissions: string[];
  disabledAt?: string;
  lockedUntil?: string;
  failedLoginAttempts?: number;
};

export type PublicAuthUser = Omit<AuthUser, "passwordHash" | "failedLoginAttempts">;

export type AuthRole = {
  tenantId: string;
  id: string;
  name: string;
  permissions: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type ApiTokenRecord = {
  tenantId: string;
  id: string;
  name: string;
  tokenHash: string;
  userId?: string;
  roles: string[];
  permissions: string[];
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
};

export type PublicApiToken = Omit<ApiTokenRecord, "tokenHash">;

export type CreatedApiToken = PublicApiToken & {
  token: string;
};

export type AuthSession = {
  token: string;
  sessionId: string;
  user: PublicAuthUser;
  context: TenantContext;
  expiresAt: string;
};

export type AuthAuditEvent = {
  id: string;
  tenantId: string;
  actorUserId?: string;
  targetUserId?: string;
  action: string;
  success: boolean;
  createdAt: string;
  details?: Record<string, unknown>;
};

export type AuthAuditSink = {
  record(event: AuthAuditEvent): Promise<void> | void;
  list?(tenantId: string): Promise<AuthAuditEvent[]> | AuthAuditEvent[];
};

export type AuthProviderIdentity = {
  providerId: string;
  subject: string;
  tenantId?: string;
  email: string;
  name?: string;
};

export type AuthIdentityProvider = {
  id: string;
  authenticate(input: { token: string; tenantId?: string }): Promise<AuthProviderIdentity>;
  beginAuthorization?(input: { tenantId: string; returnTo: string }): Promise<{ authorizationUrl: string }>;
  completeAuthorization?(input: { code: string; state: string }): Promise<{ identity: AuthProviderIdentity; returnTo: string }>;
};

export type AuthIdentityLink = {
  tenantId: string;
  providerId: string;
  subject: string;
  userId: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthIdentityLinkStore = {
  find(tenantId: string, providerId: string, subject: string): Promise<AuthIdentityLink | undefined>;
  upsert(link: AuthIdentityLink): Promise<AuthIdentityLink>;
};

export type AuthLifecycleTokenKind = "invitation" | "password_reset" | "recovery";

export type AuthLifecycleToken = {
  id: string;
  tenantId: string;
  kind: AuthLifecycleTokenKind;
  tokenHash: string;
  email?: string;
  userId?: string;
  name?: string;
  roles?: string[];
  permissions?: string[];
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

export type AuthLifecycleTokenStore = {
  create(token: AuthLifecycleToken): Promise<AuthLifecycleToken>;
  consume(tenantId: string, kind: AuthLifecycleTokenKind, tokenHash: string, usedAt: string): Promise<AuthLifecycleToken | undefined>;
};

export type AuthLifecycleDelivery = (message: {
  kind: "password_reset";
  tenantId: string;
  userId: string;
  email: string;
  token: string;
  expiresAt: string;
}) => Promise<void> | void;

export type OidcAuthorizationState = {
  id: string;
  providerId: string;
  tenantId: string;
  stateHash: string;
  nonceHash: string;
  encryptedCodeVerifier: string;
  returnTo: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

export type OidcAuthorizationStateStore = {
  create(state: OidcAuthorizationState): Promise<OidcAuthorizationState>;
  consume(providerId: string, stateHash: string, usedAt: string): Promise<OidcAuthorizationState | undefined>;
};

export type AuthIdentityLinkingPolicy =
  | {
      mode: "email";
      autoLink?: boolean;
    }
  | {
      mode: "linked";
    };

export type UserStore = {
  list(tenantId: string): Promise<AuthUser[]>;
  findByEmail(email: string, tenantId?: string): Promise<AuthUser | undefined>;
  findById(tenantId: string, userId: string): Promise<AuthUser | undefined>;
  upsert(user: AuthUser): Promise<AuthUser>;
  delete(tenantId: string, userId: string): Promise<void>;
};

export type RoleStore = {
  list(tenantId: string): Promise<AuthRole[]>;
  upsert(role: AuthRole): Promise<AuthRole>;
  delete(tenantId: string, roleId: string): Promise<void>;
};

export type ApiTokenStore = {
  list(tenantId: string): Promise<ApiTokenRecord[]>;
  findByTokenHash(tokenHash: string): Promise<ApiTokenRecord | undefined>;
  create(token: ApiTokenRecord): Promise<ApiTokenRecord>;
  revoke(tenantId: string, tokenId: string, revokedAt: string): Promise<ApiTokenRecord>;
};

export type SessionRevocationStore = {
  revoke(sessionId: string, expiresAt: string): Promise<void>;
  isRevoked(sessionId: string): Promise<boolean>;
};

export type PasswordAuthOptions = {
  secret: string;
  userStore: UserStore;
  roleStore?: RoleStore;
  apiTokenStore?: ApiTokenStore;
  sessionRevocations?: SessionRevocationStore;
  audit?: AuthAuditSink;
  providers?: AuthIdentityProvider[];
  identityLinks?: AuthIdentityLinkStore;
  lifecycleTokens?: AuthLifecycleTokenStore;
  lifecycleDelivery?: AuthLifecycleDelivery;
  identityLinkingPolicy?: AuthIdentityLinkingPolicy;
  sessionTtlSeconds?: number;
  maxFailedLoginAttempts?: number;
  lockoutSeconds?: number;
  invitationTtlSeconds?: number;
  recoveryTtlSeconds?: number;
};

type SessionPayload = {
  sub: string;
  tenantId: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  exp: number;
  jti?: string;
};

const encoder = new TextEncoder();

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
    if ((user.failedLoginAttempts ?? 0) > 0 || user.lockedUntil) {
      user = await this.persistUserAuthState(user, { failedLoginAttempts: 0, lockedUntil: undefined });
    }
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
      return { session: await this.loginWithProviderIdentity(providerId, result.identity, result.identity.tenantId ?? "default"), returnTo: result.returnTo };
    } catch (error) {
      await this.recordAuthAudit({ tenantId: authErrorTenant(error) ?? "default", action: "provider_authorization.failed", success: false, details: { providerId, reason: authErrorCode(error) } });
      throw error;
    }
  }

  private async loginWithProviderIdentity(providerId: string, identity: AuthProviderIdentity, tenantId: string): Promise<AuthSession> {
    const resolvedTenantId = identity.tenantId ?? tenantId;
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
    await this.options.userStore.upsert({ ...user, passwordHash: await hashPassword(input.newPassword), failedLoginAttempts: 0, lockedUntil: undefined });
    await this.recordAuthAudit({ tenantId: input.tenantId, targetUserId: user.id, action: `${kind}.completed`, success: true, details: { tokenId: record.id } });
  }

  async verifyBearerToken(token: string): Promise<AuthSession | ApiTokenSession> {
    if (token.startsWith("fkat_")) {
      return this.verifyApiToken(token);
    }
    return this.verifyToken(token);
  }

  async verifyToken(token: string): Promise<AuthSession> {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
      throw new FramekitError("INVALID_SESSION", "Session token is malformed.", 401);
    }
    const expected = await sign(encodedPayload, this.options.secret);
    if (!constantEqual(signature, expected)) {
      throw new FramekitError("INVALID_SESSION", "Session token signature is invalid.", 401);
    }
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;
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
    this.assertUserCanLogin(user);
    return this.sessionFromUser(user, token, new Date(payload.exp * 1000).toISOString(), payload.jti);
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

  async createSession(user: AuthUser): Promise<AuthSession> {
    const expiresAt = Math.floor(Date.now() / 1000) + this.sessionTtlSeconds;
    const sessionId = crypto.randomUUID();
    const payload: SessionPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      roles: user.roles,
      permissions: user.permissions,
      exp: expiresAt,
      jti: sessionId
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const token = `${encodedPayload}.${await sign(encodedPayload, this.options.secret)}`;
    return this.sessionFromUser(user, token, new Date(expiresAt * 1000).toISOString(), sessionId);
  }

  async refreshSession(token: string): Promise<AuthSession> {
    const current = await this.verifyToken(token);
    await this.revokeSession(token);
    const user = await this.options.userStore.findById(current.context.tenantId, current.context.userId);
    if (!user) {
      throw new FramekitError("INVALID_SESSION", "Session user no longer exists.", 401);
    }
    const session = await this.createSession(user);
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
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
      throw new FramekitError("INVALID_SESSION", "Session token is malformed.", 401);
    }
    const expected = await sign(encodedPayload, this.options.secret);
    if (!constantEqual(signature, expected)) {
      throw new FramekitError("INVALID_SESSION", "Session token signature is invalid.", 401);
    }
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;
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
    await this.options.userStore.upsert({
      ...user,
      passwordHash: await hashPassword(newPassword),
      failedLoginAttempts: 0,
      lockedUntil: undefined
    });
    await this.recordAuthAudit({ tenantId, actorUserId: userId, targetUserId: userId, action: "password.changed", success: true });
  }

  async resetPassword(tenantId: string, userId: string, newPassword: string): Promise<void> {
    const user = await this.options.userStore.findById(tenantId, userId);
    if (!user) {
      throw new FramekitError("USER_NOT_FOUND", `No user with id "${userId}"`, 404);
    }
    await this.options.userStore.upsert({
      ...user,
      passwordHash: await hashPassword(newPassword),
      failedLoginAttempts: 0,
      lockedUntil: undefined
    });
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

  private async sessionFromUser(user: AuthUser, token: string, expiresAt: string, sessionId?: string): Promise<AuthSession> {
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
      expiresAt
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
    if (!this.identityLinkingPolicy.autoLink) return undefined;
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
      return this.persistUserAuthState(user, { failedLoginAttempts: 0, lockedUntil: undefined });
    }
    return user;
  }

  private async recordFailedLogin(user: AuthUser): Promise<void> {
    const failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockedUntil = failedLoginAttempts >= this.maxFailedLoginAttempts
      ? new Date(Date.now() + this.lockoutSeconds * 1000).toISOString()
      : user.lockedUntil;
    await this.persistUserAuthState(user, { failedLoginAttempts, lockedUntil });
  }

  private async persistUserAuthState(user: AuthUser, patch: Partial<Pick<AuthUser, "failedLoginAttempts" | "lockedUntil">>): Promise<AuthUser> {
    const next = { ...user, ...patch };
    await this.options.userStore.upsert(next);
    return next;
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

export function assertSecureAuthSecret(secret: string, environment = runtimeEnvironment()): void {
  if (secret.length < 16) {
    throw new Error("Auth secret must be at least 16 characters.");
  }
  if (environment !== "production") {
    return;
  }
  const lower = secret.trim().toLowerCase();
  if (
    secret.trim().length < 32
    || lower.includes("change-me")
    || lower.includes("changeme")
    || lower.includes("replace-with")
    || new Set(secret).size < 8
  ) {
    throw new Error("Auth secret must be explicitly provisioned with a strong, non-default value in production.");
  }
}

export class InMemoryUserStore implements UserStore {
  private readonly users: AuthUser[];

  constructor(users: AuthUser[]) {
    this.users = users.map((user) => ({ ...user, email: normalizeEmail(user.email) }));
  }

  async list(tenantId: string): Promise<AuthUser[]> {
    return this.users.filter((user) => user.tenantId === tenantId).map((user) => cloneUser(user)!);
  }

  async findByEmail(email: string, tenantId?: string): Promise<AuthUser | undefined> {
    return cloneUser(this.users.find((user) => user.email === normalizeEmail(email) && (!tenantId || user.tenantId === tenantId)));
  }

  async findById(tenantId: string, userId: string): Promise<AuthUser | undefined> {
    return cloneUser(this.users.find((user) => user.tenantId === tenantId && user.id === userId));
  }

  async upsert(user: AuthUser): Promise<AuthUser> {
    const normalized = { ...user, email: normalizeEmail(user.email), roles: [...user.roles], permissions: [...user.permissions] };
    const index = this.users.findIndex((candidate) => candidate.tenantId === user.tenantId && candidate.id === user.id);
    if (index >= 0) {
      this.users[index] = normalized;
    } else {
      this.users.push(normalized);
    }
    return cloneUser(normalized)!;
  }

  async delete(tenantId: string, userId: string): Promise<void> {
    const index = this.users.findIndex((user) => user.tenantId === tenantId && user.id === userId);
    if (index >= 0) {
      this.users.splice(index, 1);
    }
  }
}

export class InMemoryRoleStore implements RoleStore {
  private readonly roles: AuthRole[];

  constructor(roles: AuthRole[]) {
    this.roles = roles.map(cloneRole);
  }

  async list(tenantId: string): Promise<AuthRole[]> {
    return this.roles.filter((role) => role.tenantId === tenantId).map(cloneRole);
  }

  async upsert(role: AuthRole): Promise<AuthRole> {
    const now = new Date().toISOString();
    const existing = this.roles.find((candidate) => candidate.tenantId === role.tenantId && candidate.id === role.id);
    const saved = {
      ...role,
      permissions: [...role.permissions],
      createdAt: role.createdAt ?? existing?.createdAt ?? now,
      updatedAt: now
    };
    const index = this.roles.findIndex((candidate) => candidate.tenantId === role.tenantId && candidate.id === role.id);
    if (index >= 0) {
      this.roles[index] = saved;
    } else {
      this.roles.push(saved);
    }
    return cloneRole(saved);
  }

  async delete(tenantId: string, roleId: string): Promise<void> {
    const index = this.roles.findIndex((role) => role.tenantId === tenantId && role.id === roleId);
    if (index >= 0) {
      this.roles.splice(index, 1);
    }
  }
}

export class InMemoryApiTokenStore implements ApiTokenStore {
  private readonly tokens: ApiTokenRecord[];

  constructor(tokens: ApiTokenRecord[]) {
    this.tokens = tokens.map(cloneApiToken);
  }

  async list(tenantId: string): Promise<ApiTokenRecord[]> {
    return this.tokens.filter((token) => token.tenantId === tenantId).map(cloneApiToken);
  }

  async findByTokenHash(tokenHash: string): Promise<ApiTokenRecord | undefined> {
    return cloneOptionalApiToken(this.tokens.find((token) => token.tokenHash === tokenHash));
  }

  async create(token: ApiTokenRecord): Promise<ApiTokenRecord> {
    if (this.tokens.some((candidate) => candidate.tenantId === token.tenantId && candidate.id === token.id)) {
      throw new FramekitError("API_TOKEN_EXISTS", `API token "${token.id}" already exists`, 409);
    }
    const saved = cloneApiToken(token);
    this.tokens.push(saved);
    return cloneApiToken(saved);
  }

  async revoke(tenantId: string, tokenId: string, revokedAt: string): Promise<ApiTokenRecord> {
    const token = this.tokens.find((candidate) => candidate.tenantId === tenantId && candidate.id === tokenId);
    if (!token) {
      throw new FramekitError("API_TOKEN_NOT_FOUND", `No API token with id "${tokenId}"`, 404);
    }
    token.revokedAt = revokedAt;
    return cloneApiToken(token);
  }
}

export class InMemorySessionRevocationStore implements SessionRevocationStore {
  private readonly revoked = new Map<string, string>();

  async revoke(sessionId: string, expiresAt: string): Promise<void> {
    this.revoked.set(sessionId, expiresAt);
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    const expiresAt = this.revoked.get(sessionId);
    if (!expiresAt) {
      return false;
    }
    if (new Date(expiresAt).getTime() <= Date.now()) {
      this.revoked.delete(sessionId);
      return false;
    }
    return true;
  }
}

export class InMemoryAuthIdentityLinkStore implements AuthIdentityLinkStore {
  private readonly links: AuthIdentityLink[];

  constructor(links: AuthIdentityLink[]) {
    this.links = links.map(cloneIdentityLink);
  }

  async find(tenantId: string, providerId: string, subject: string): Promise<AuthIdentityLink | undefined> {
    const link = this.links.find((candidate) => candidate.tenantId === tenantId && candidate.providerId === providerId && candidate.subject === subject);
    return link ? cloneIdentityLink(link) : undefined;
  }

  async upsert(link: AuthIdentityLink): Promise<AuthIdentityLink> {
    const saved = cloneIdentityLink(link);
    const index = this.links.findIndex((candidate) => candidate.tenantId === link.tenantId && candidate.providerId === link.providerId && candidate.subject === link.subject);
    if (index >= 0) {
      if (this.links[index]!.userId !== link.userId) {
        throw new FramekitError("PROVIDER_IDENTITY_COLLISION", "Provider subject is already linked to another user in this tenant.", 409);
      }
      this.links[index] = saved;
    } else {
      this.links.push(saved);
    }
    return cloneIdentityLink(saved);
  }
}

export class InMemoryAuthLifecycleTokenStore implements AuthLifecycleTokenStore {
  private readonly tokens: AuthLifecycleToken[];

  constructor(tokens: AuthLifecycleToken[]) {
    this.tokens = tokens.map(cloneLifecycleToken);
  }

  async create(token: AuthLifecycleToken): Promise<AuthLifecycleToken> {
    this.tokens.push(cloneLifecycleToken(token));
    return cloneLifecycleToken(token);
  }

  async consume(tenantId: string, kind: AuthLifecycleTokenKind, tokenHash: string, usedAt: string): Promise<AuthLifecycleToken | undefined> {
    const token = this.tokens.find((candidate) => candidate.tenantId === tenantId && candidate.kind === kind && candidate.tokenHash === tokenHash);
    if (!token || token.usedAt || new Date(token.expiresAt).getTime() <= new Date(usedAt).getTime()) return undefined;
    token.usedAt = usedAt;
    return cloneLifecycleToken(token);
  }
}

export class InMemoryOidcAuthorizationStateStore implements OidcAuthorizationStateStore {
  private readonly states: OidcAuthorizationState[] = [];

  async create(state: OidcAuthorizationState): Promise<OidcAuthorizationState> {
    this.states.push({ ...state });
    return { ...state };
  }

  async consume(providerId: string, stateHash: string, usedAt: string): Promise<OidcAuthorizationState | undefined> {
    const state = this.states.find((candidate) => candidate.providerId === providerId && candidate.stateHash === stateHash);
    if (!state || state.usedAt || new Date(state.expiresAt).getTime() <= new Date(usedAt).getTime()) return undefined;
    state.usedAt = usedAt;
    return { ...state };
  }
}

export class InMemoryAuthAuditStore implements AuthAuditSink {
  private readonly events: AuthAuditEvent[] = [];

  async record(event: AuthAuditEvent): Promise<void> {
    this.events.push({ ...event, details: event.details ? { ...event.details } : undefined });
  }

  async list(tenantId: string): Promise<AuthAuditEvent[]> {
    return this.events
      .filter((event) => event.tenantId === tenantId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((event) => ({ ...event, details: event.details ? { ...event.details } : undefined }));
  }
}

class NoopAuthAuditSink implements AuthAuditSink {
  record(): void {
    return undefined;
  }
}

export async function hashPassword(password: string, salt = randomSalt()): Promise<string> {
  const iterations = 160_000;
  const key = await derivePasswordKey(password, salt, iterations);
  return `pbkdf2-sha256:${iterations}:${salt}:${key}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const [algorithm, iterationsRaw, salt, expected] = passwordHash.split(":");
  if (algorithm !== "pbkdf2-sha256" || !iterationsRaw || !salt || !expected) {
    throw new FramekitError("INVALID_PASSWORD_HASH", "Unsupported password hash format.", 500);
  }
  const actual = await derivePasswordKey(password, salt, Number(iterationsRaw));
  return constantEqual(actual, expected);
}

export function bearerToken(header: string | null): string | undefined {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length).trim();
}

export type ApiTokenSession = {
  token: string;
  apiToken: PublicApiToken;
  user?: PublicAuthUser;
  context: TenantContext;
};

export type UpsertUserInput = {
  tenantId: string;
  id?: string;
  email: string;
  name: string;
  password?: string;
  roles: string[];
  permissions: string[];
  disabledAt?: string;
  lockedUntil?: string;
};

export type CreateApiTokenInput = {
  tenantId: string;
  id?: string;
  name: string;
  userId?: string;
  roles: string[];
  permissions: string[];
  expiresAt?: string;
};

export type OidcClaims = {
  sub?: unknown;
  email?: unknown;
  name?: unknown;
  preferred_username?: unknown;
  tenantId?: unknown;
  tid?: unknown;
  iss?: unknown;
  aud?: unknown;
  active?: unknown;
};

export type OidcProviderOptions = {
  id: string;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  introspectionEndpoint?: string;
  userInfoEndpoint?: string;
  fetch?: typeof fetch;
  verifyJwt?: (token: string, options: { issuer?: string; audience?: string }) => Promise<OidcClaims> | OidcClaims;
  mapIdentity?: (claims: OidcClaims, input: { providerId: string; tenantId?: string }) => AuthProviderIdentity;
};

export function createOidcProvider(options: OidcProviderOptions): AuthIdentityProvider {
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    id: options.id,
    async authenticate({ token, tenantId }) {
      const claims = await oidcClaimsFromToken(token, options, fetcher);
      if (options.issuer && claims.iss !== options.issuer) {
        throw new FramekitError("OIDC_ISSUER_MISMATCH", "OIDC token issuer did not match the configured issuer.", 401);
      }
      if (options.clientId) {
        const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        if (!audiences.includes(options.clientId)) {
          throw new FramekitError("OIDC_AUDIENCE_MISMATCH", "OIDC token audience did not match the configured client id.", 401);
        }
      }
      if (options.mapIdentity) {
        return options.mapIdentity(claims, { providerId: options.id, tenantId });
      }
      const subject = stringClaim(claims.sub, "sub");
      const email = typeof claims.email === "string" ? claims.email : typeof claims.preferred_username === "string" ? claims.preferred_username : undefined;
      if (!email) {
        throw new FramekitError("OIDC_EMAIL_MISSING", "OIDC identity did not include an email claim.", 401);
      }
      const providerTenantId = typeof claims.tenantId === "string" ? claims.tenantId : typeof claims.tid === "string" ? claims.tid : tenantId;
      return {
        providerId: options.id,
        subject,
        tenantId: providerTenantId,
        email,
        name: typeof claims.name === "string" ? claims.name : email
      };
    }
  };
}

export type OidcAuthorizationCodeProviderOptions = {
  id: string;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  flowSecret: string;
  stateStore: OidcAuthorizationStateStore;
  fetch?: typeof fetch;
  scopes?: string[];
  stateTtlSeconds?: number;
  mapIdentity?: OidcProviderOptions["mapIdentity"];
};

type OidcDiscoveryDocument = {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  jwks_uri?: unknown;
  id_token_signing_alg_values_supported?: unknown;
  code_challenge_methods_supported?: unknown;
};

const supportedOidcAlgorithms = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"];

export function createOidcAuthorizationCodeProvider(options: OidcAuthorizationCodeProviderOptions): AuthIdentityProvider {
  if (options.flowSecret.length < 32) throw new Error("OIDC flowSecret must be at least 32 characters.");
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    id: options.id,
    async authenticate() {
      throw new FramekitError("OIDC_CODE_FLOW_REQUIRED", "This provider accepts only authorization-code flow with PKCE.", 400);
    },
    async beginAuthorization({ tenantId, returnTo }) {
      const discovery = await discoverOidc(options.issuer, fetcher);
      const state = randomTokenSecret();
      const nonce = randomTokenSecret();
      const codeVerifier = randomTokenSecret();
      const now = new Date();
      await options.stateStore.create({
        id: crypto.randomUUID(), providerId: options.id, tenantId,
        stateHash: await hashOpaqueToken(state), nonceHash: await hashOpaqueToken(nonce),
        encryptedCodeVerifier: await encryptFlowValue(codeVerifier, options.flowSecret),
        returnTo, redirectUri: options.redirectUri, createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + (options.stateTtlSeconds ?? 10 * 60) * 1000).toISOString()
      });
      const url = new URL(discovery.authorizationEndpoint);
      url.search = new URLSearchParams({
        client_id: options.clientId, redirect_uri: options.redirectUri, response_type: "code",
        scope: [...new Set(["openid", ...(options.scopes ?? ["email", "profile"])])].join(" "),
        state, nonce, code_challenge: await hashOpaqueToken(codeVerifier), code_challenge_method: "S256"
      }).toString();
      return { authorizationUrl: url.toString() };
    },
    async completeAuthorization({ code, state }) {
      const stored = await options.stateStore.consume(options.id, await hashOpaqueToken(state), new Date().toISOString());
      if (!stored) throw new FramekitError("OIDC_STATE_INVALID", "OIDC state is invalid, expired, or already used.", 401);
      try {
      const discovery = await discoverOidc(options.issuer, fetcher);
      const codeVerifier = await decryptFlowValue(stored.encryptedCodeVerifier, options.flowSecret);
      const body = new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: stored.redirectUri,
        client_id: options.clientId, code_verifier: codeVerifier
      });
      if (options.clientSecret) body.set("client_secret", options.clientSecret);
      const tokenResponse = await fetcher(discovery.tokenEndpoint, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body
      });
      if (!tokenResponse.ok) throw new FramekitError("OIDC_TOKEN_EXCHANGE_FAILED", "OIDC authorization code exchange failed.", 401);
      const tokens = await tokenResponse.json() as { id_token?: unknown };
      if (typeof tokens.id_token !== "string") throw new FramekitError("OIDC_ID_TOKEN_MISSING", "OIDC token response did not include an ID token.", 401);
      const jwksResponse = await fetcher(discovery.jwksUri);
      if (!jwksResponse.ok) throw new FramekitError("OIDC_JWKS_FAILED", "OIDC signing keys could not be loaded.", 401);
      const jwks = await jwksResponse.json() as JSONWebKeySet;
      const verified = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
        issuer: options.issuer, audience: options.clientId, algorithms: discovery.algorithms
      });
      await validateOidcIdToken(verified.payload, stored.nonceHash, options.clientId);
      const claims = verified.payload as OidcClaims;
      const identity = options.mapIdentity
        ? options.mapIdentity(claims, { providerId: options.id, tenantId: stored.tenantId })
        : defaultOidcIdentity(options.id, claims, stored.tenantId);
      if (identity.tenantId && identity.tenantId !== stored.tenantId) {
        throw new FramekitError("OIDC_TENANT_MISMATCH", "OIDC identity tenant did not match the authorization request tenant.", 401);
      }
      return { identity: { ...identity, tenantId: stored.tenantId }, returnTo: stored.returnTo };
      } catch (error) {
        if (error instanceof FramekitError) {
          throw new FramekitError(error.code, error.message, error.statusCode, { tenantId: stored.tenantId });
        }
        throw new FramekitError("OIDC_ID_TOKEN_INVALID", "OIDC ID token signature or claims validation failed.", 401, { tenantId: stored.tenantId });
      }
    }
  };
}

async function discoverOidc(issuer: string, fetcher: typeof fetch): Promise<{ authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string; algorithms: string[] }> {
  const issuerUrl = new URL(issuer);
  if (issuerUrl.protocol !== "https:") throw new FramekitError("OIDC_ISSUER_INSECURE", "OIDC issuer must use HTTPS.", 500);
  const discoveryUrl = new URL(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  const response = await fetcher(discoveryUrl);
  if (!response.ok) throw new FramekitError("OIDC_DISCOVERY_FAILED", "OIDC discovery failed.", 502);
  const document = await response.json() as OidcDiscoveryDocument;
  if (document.issuer !== issuer) throw new FramekitError("OIDC_ISSUER_MISMATCH", "OIDC discovery issuer did not match configuration.", 401);
  const authorizationEndpoint = httpsEndpoint(document.authorization_endpoint, "authorization_endpoint");
  const tokenEndpoint = httpsEndpoint(document.token_endpoint, "token_endpoint");
  const jwksUri = httpsEndpoint(document.jwks_uri, "jwks_uri");
  const methods = Array.isArray(document.code_challenge_methods_supported) ? document.code_challenge_methods_supported : [];
  if (!methods.includes("S256")) throw new FramekitError("OIDC_PKCE_UNSUPPORTED", "OIDC provider does not advertise PKCE S256 support.", 501);
  const advertised = Array.isArray(document.id_token_signing_alg_values_supported) ? document.id_token_signing_alg_values_supported : [];
  const algorithms = advertised.filter((algorithm): algorithm is string => typeof algorithm === "string" && supportedOidcAlgorithms.includes(algorithm));
  if (algorithms.length === 0) throw new FramekitError("OIDC_SIGNING_ALGORITHM_UNSUPPORTED", "OIDC provider does not advertise a supported asymmetric ID token algorithm.", 501);
  return { authorizationEndpoint, tokenEndpoint, jwksUri, algorithms };
}

function httpsEndpoint(value: unknown, name: string): string {
  if (typeof value !== "string" || new URL(value).protocol !== "https:") {
    throw new FramekitError("OIDC_DISCOVERY_INVALID", `OIDC ${name} must be an HTTPS URL.`, 502);
  }
  return value;
}

async function validateOidcIdToken(payload: JWTPayload, nonceHash: string, clientId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || typeof payload.iat !== "number" || payload.exp <= now || payload.iat > now + 60) {
    throw new FramekitError("OIDC_TOKEN_TIME_INVALID", "OIDC ID token must contain valid iat and exp claims.", 401);
  }
  if (typeof payload.nonce !== "string" || !constantEqual(await hashOpaqueToken(payload.nonce), nonceHash)) {
    throw new FramekitError("OIDC_NONCE_MISMATCH", "OIDC ID token nonce did not match the authorization request.", 401);
  }
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) {
    throw new FramekitError("OIDC_AUTHORIZED_PARTY_MISMATCH", "OIDC ID token authorized party did not match the client id.", 401);
  }
}

function defaultOidcIdentity(providerId: string, claims: OidcClaims, tenantId: string): AuthProviderIdentity {
  const email = typeof claims.email === "string" ? claims.email : undefined;
  if (!email) throw new FramekitError("OIDC_EMAIL_MISSING", "OIDC identity did not include an email claim.", 401);
  return { providerId, subject: stringClaim(claims.sub, "sub"), tenantId, email, name: typeof claims.name === "string" ? claims.name : email };
}

function publicUser(user: AuthUser): PublicAuthUser {
  const { passwordHash: _passwordHash, failedLoginAttempts: _failedLoginAttempts, ...rest } = user;
  return {
    ...rest,
    roles: [...rest.roles],
    permissions: [...rest.permissions]
  };
}

function publicApiToken(token: ApiTokenRecord): PublicApiToken {
  const { tokenHash: _tokenHash, ...rest } = token;
  return {
    ...rest,
    roles: [...rest.roles],
    permissions: [...rest.permissions]
  };
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

async function derivePasswordKey(password: string, salt: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations
    },
    keyMaterial,
    256
  );
  return base64UrlEncodeBytes(new Uint8Array(bits));
}

async function hashApiToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

async function hashOpaqueToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

async function encryptFlowValue(value: string, secret: string): Promise<string> {
  const keyBytes = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return `${base64UrlEncodeBytes(iv)}.${base64UrlEncodeBytes(new Uint8Array(ciphertext))}`;
}

async function decryptFlowValue(value: string, secret: string): Promise<string> {
  const [encodedIv, encodedCiphertext] = value.split(".");
  if (!encodedIv || !encodedCiphertext) throw new FramekitError("OIDC_STATE_INVALID", "OIDC state payload is malformed.", 401);
  const keyBytes = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlDecodeBytes(encodedIv) as BufferSource }, key, base64UrlDecodeBytes(encodedCiphertext) as BufferSource);
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new FramekitError("OIDC_STATE_INVALID", "OIDC state payload could not be decrypted.", 401);
  }
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

function randomTokenSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

function normalizeExpiresAt(expiresAt: string | undefined): string | undefined {
  if (!expiresAt) {
    return undefined;
  }
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) {
    throw new FramekitError("VALIDATION_FAILED", "expiresAt must be a valid date-time.", 422);
  }
  if (date.getTime() <= Date.now()) {
    throw new FramekitError("VALIDATION_FAILED", "expiresAt must be in the future.", 422);
  }
  return date.toISOString();
}

function normalizeRequiredFutureDate(value: string): string {
  const normalized = normalizeExpiresAt(value);
  if (!normalized) throw new FramekitError("VALIDATION_FAILED", "expiresAt is required.", 422);
  return normalized;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function cloneUser(user: AuthUser | undefined): AuthUser | undefined {
  return user ? { ...user, roles: [...user.roles], permissions: [...user.permissions] } : undefined;
}

function cloneRole(role: AuthRole): AuthRole {
  return { ...role, permissions: [...role.permissions] };
}

function cloneApiToken(token: ApiTokenRecord): ApiTokenRecord {
  return { ...token, roles: [...token.roles], permissions: [...token.permissions] };
}

function cloneOptionalApiToken(token: ApiTokenRecord | undefined): ApiTokenRecord | undefined {
  return token ? cloneApiToken(token) : undefined;
}

function cloneIdentityLink(link: AuthIdentityLink): AuthIdentityLink {
  return { ...link };
}

function cloneLifecycleToken(token: AuthLifecycleToken): AuthLifecycleToken {
  return { ...token, roles: token.roles ? [...token.roles] : undefined, permissions: token.permissions ? [...token.permissions] : undefined };
}

async function oidcClaimsFromToken(token: string, options: OidcProviderOptions, fetcher: typeof fetch): Promise<OidcClaims> {
  if (options.verifyJwt) {
    return options.verifyJwt(token, { issuer: options.issuer, audience: options.clientId });
  }
  if (options.introspectionEndpoint) {
    const body = new URLSearchParams({ token });
    if (options.clientId) {
      body.set("client_id", options.clientId);
    }
    if (options.clientSecret) {
      body.set("client_secret", options.clientSecret);
    }
    const response = await fetcher(options.introspectionEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    if (!response.ok) {
      throw new FramekitError("OIDC_INTROSPECTION_FAILED", "OIDC token introspection failed.", 401);
    }
    const claims = await response.json() as OidcClaims;
    if (claims.active === false) {
      throw new FramekitError("OIDC_TOKEN_INACTIVE", "OIDC token is inactive.", 401);
    }
    return claims;
  }
  if (options.userInfoEndpoint) {
    const response = await fetcher(options.userInfoEndpoint, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new FramekitError("OIDC_USERINFO_FAILED", "OIDC userinfo request failed.", 401);
    }
    return await response.json() as OidcClaims;
  }
  throw new FramekitError("OIDC_VERIFIER_REQUIRED", "OIDC provider requires verifyJwt, introspectionEndpoint, or userInfoEndpoint.", 500);
}

function stringClaim(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new FramekitError("OIDC_CLAIM_MISSING", `OIDC identity did not include a ${name} claim.`, 401);
  }
  return value;
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(encoder.encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64UrlDecodeBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function constantEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function runtimeEnvironment(): string | undefined {
  return (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
}

function safeReturnTo(value: string | undefined): string {
  const returnTo = value ?? "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.includes("\\")) {
    throw new FramekitError("INVALID_RETURN_TO", "returnTo must be a same-origin absolute path.", 422);
  }
  return returnTo;
}

function authErrorCode(error: unknown): string {
  return error instanceof FramekitError ? error.code : "unexpected_error";
}

function authErrorTenant(error: unknown): string | undefined {
  if (!(error instanceof FramekitError) || !error.details || typeof error.details !== "object") return undefined;
  const tenantId = (error.details as { tenantId?: unknown }).tenantId;
  return typeof tenantId === "string" ? tenantId : undefined;
}

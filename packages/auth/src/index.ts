import type { TenantContext } from "@framekit/core";
import { FramekitError } from "@framekit/core";

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
  sessionTtlSeconds?: number;
  maxFailedLoginAttempts?: number;
  lockoutSeconds?: number;
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
  private readonly maxFailedLoginAttempts: number;
  private readonly lockoutSeconds: number;

  constructor(private readonly options: PasswordAuthOptions) {
    if (options.secret.length < 16) {
      throw new Error("Auth secret must be at least 16 characters.");
    }
    this.sessionTtlSeconds = options.sessionTtlSeconds ?? 60 * 60 * 8;
    this.roleStore = options.roleStore ?? new InMemoryRoleStore([]);
    this.apiTokenStore = options.apiTokenStore ?? new InMemoryApiTokenStore([]);
    this.sessionRevocations = options.sessionRevocations ?? new InMemorySessionRevocationStore();
    this.audit = options.audit ?? new NoopAuthAuditSink();
    this.providers = new Map((options.providers ?? []).map((provider) => [provider.id, provider]));
    this.maxFailedLoginAttempts = options.maxFailedLoginAttempts ?? 5;
    this.lockoutSeconds = options.lockoutSeconds ?? 15 * 60;
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
    const resolvedTenantId = identity.tenantId ?? tenantId;
    const user = await this.options.userStore.findByEmail(normalizeEmail(identity.email), resolvedTenantId);
    if (!user) {
      await this.recordAuthAudit({
        tenantId: resolvedTenantId,
        action: "provider_login.failed",
        success: false,
        details: { providerId, subject: identity.subject, email: normalizeEmail(identity.email), reason: "user_not_found" }
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

  private async recordAuthAudit(input: Omit<AuthAuditEvent, "id" | "createdAt">): Promise<void> {
    await this.audit.record({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...input
    });
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

import { FramekitError } from "@framekit/core";
import type { ApiTokenRecord, ApiTokenStore, AuthAuditEvent, AuthAuditSink, AuthIdentityLink, AuthIdentityLinkStore, AuthLifecycleToken, AuthLifecycleTokenKind, AuthLifecycleTokenStore, AuthRole, OidcAuthorizationState, OidcAuthorizationStateStore, RoleStore, SessionRevocationStore, UserStore, AuthUser } from "./contracts.js";
import { cloneApiToken, cloneIdentityLink, cloneLifecycleToken, cloneOptionalApiToken, cloneRole, cloneUser, normalizeEmail } from "./shared.js";

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

  async updateLoginState(input: {
    tenantId: string;
    userId: string;
    expectedPasswordHash: string;
    operation: "failed" | "succeeded" | "clear_expired";
    maxFailedLoginAttempts: number;
    lockoutSeconds: number;
    now: string;
  }): Promise<AuthUser | undefined> {
    const user = this.users.find((candidate) => candidate.tenantId === input.tenantId && candidate.id === input.userId);
    if (!user || user.disabledAt || user.passwordHash !== input.expectedPasswordHash) return undefined;
    const now = new Date(input.now).getTime();
    const lockIsActive = user.lockedUntil && new Date(user.lockedUntil).getTime() > now;
    if (input.operation === "succeeded" && lockIsActive) return undefined;
    if (input.operation === "failed") {
      user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
      if (user.failedLoginAttempts >= input.maxFailedLoginAttempts) {
        const computedLock = new Date(now + input.lockoutSeconds * 1000).toISOString();
        if (!user.lockedUntil || new Date(user.lockedUntil).getTime() < new Date(computedLock).getTime()) {
          user.lockedUntil = computedLock;
        }
      }
    } else if (input.operation === "succeeded" || (user.lockedUntil && new Date(user.lockedUntil).getTime() <= now)) {
      user.failedLoginAttempts = 0;
      user.lockedUntil = undefined;
    }
    return cloneUser(user);
  }

  async updatePassword(input: { tenantId: string; userId: string; expectedPasswordHash: string; passwordHash: string; allowDisabled?: boolean }): Promise<AuthUser | undefined> {
    const user = this.users.find((candidate) => candidate.tenantId === input.tenantId && candidate.id === input.userId);
    if (!user || user.passwordHash !== input.expectedPasswordHash || (!input.allowDisabled && (user.disabledAt || (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now())))) return undefined;
    user.passwordHash = input.passwordHash;
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;
    return cloneUser(user);
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

export class NoopAuthAuditSink implements AuthAuditSink {
  record(): void {
    return undefined;
  }
}

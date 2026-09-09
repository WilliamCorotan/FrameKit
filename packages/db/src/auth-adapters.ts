import { and, asc, desc, eq, gt, gte, isNull, lt, lte, ne, or, sql as drizzleSql, type SQL } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import type {
  ApiTokenRecord, ApiTokenStore, AuthAuditEvent, AuthAuditSink, AuthIdentityLink, AuthIdentityLinkStore,
  AuthLifecycleToken, AuthLifecycleTokenKind, AuthLifecycleTokenStore, AuthRole, AuthUser,
  OidcAuthorizationState, OidcAuthorizationStateStore, RoleStore, SessionRevocationStore, UserStore
} from "@framekit/auth";
import type { CustomFieldDefinition, DocTypeDefinition, DocumentRecord, TenantContext, ViewDefinition } from "@framekit/core";
import { assertPermission, canTransferOwnership, FramekitError, rowPolicyScope } from "@framekit/core";
import {
  decodeDocumentCursor,
  encodeDocumentCursor,
  validateListOptions,
  type AuditEvent,
  type AuditStore,
  type CustomizationStore,
  type DocumentRepository,
  type DocumentPage,
  type FilterOperator,
  type ListOptions,
  type MigrationChange,
  type MigrationConversion,
  type MigrationConversionArtifact,
  type MigrationPlan,
  type MigrationRecord,
  type MigrationRollback,
  type MigrationStore,
  type OnlineMigrationOptions,
  type OnlineMigrationRun,
  type MutationCommand,
  type MutationBatchResult,
  type MutationUnitOfWork,
  type NamingSeriesStore,
  type OutboxEvent,
  type OutboxClaimOptions,
  type OutboxStore,
  type RepositoryDiagnostics,
  type RealtimePublisher,
  type RuntimeRealtimeEvent,
  type StoredSettingValue,
  assertDestructiveMigration,
  assertMigrationDrift,
  assertMigrationIdentity,
  assertSupportedMigration,
  createRollbackMigrationPlan,
  validateMigrationPlan
} from "@framekit/runtime";
import { framekitApiTokens, framekitAuthAuditEvents, framekitAuthIdentityLinks, framekitRoles, framekitSessionRevocations, framekitUsers } from "./schema.js";
import type { PostgresRepositoryOptions } from "./types.js";
import { createApiTokenTableSql, createAuthIdentityLifecycleTablesSql, createRoleTableSql, createSessionRevocationTableSql, createUserTableSql } from "./ddl.js";
import { closeAdapterSql, postgresForOptions } from "./connection.js";

export class PostgresUserStore implements UserStore {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.sql = postgresForOptions(options);
    this.db = drizzle(options.connection?.drizzleSql ?? this.sql);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.db.execute(drizzleSql`select 1`); }
  async close(): Promise<void> { await closeAdapterSql(this.sql); }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await this.db.execute(drizzleSql.raw(createUserTableSql()));
  }

  async list(tenantId: string): Promise<AuthUser[]> {
    const rows = await this.db.select().from(framekitUsers).where(eq(framekitUsers.tenantId, tenantId));
    return rows.map(rowToUser).sort((a, b) => a.email.localeCompare(b.email));
  }

  async upsert(user: AuthUser): Promise<AuthUser> {
    const now = new Date();
    const values = {
      tenantId: user.tenantId,
      id: user.id,
      email: user.email.toLowerCase(),
      name: user.name,
      passwordHash: user.passwordHash,
      roles: user.roles,
      permissions: user.permissions,
      disabledAt: user.disabledAt ? new Date(user.disabledAt) : null,
      lockedUntil: user.lockedUntil ? new Date(user.lockedUntil) : null,
      failedLoginAttempts: user.failedLoginAttempts ?? 0,
      createdAt: now,
      updatedAt: now
    };
    await this.db
      .insert(framekitUsers)
      .values(values)
      .onConflictDoUpdate({
        target: [framekitUsers.tenantId, framekitUsers.id],
        set: {
          email: values.email,
          name: values.name,
          passwordHash: values.passwordHash,
          roles: values.roles,
          permissions: values.permissions,
          disabledAt: values.disabledAt,
          lockedUntil: values.lockedUntil,
          failedLoginAttempts: values.failedLoginAttempts,
          updatedAt: now
        }
      });
    return user;
  }

  async insertIfAbsent(user: AuthUser): Promise<boolean> {
    const now = new Date();
    const rows = await this.db.insert(framekitUsers).values({
      tenantId: user.tenantId, id: user.id, email: user.email.toLowerCase(), name: user.name, passwordHash: user.passwordHash,
      roles: user.roles, permissions: user.permissions, disabledAt: user.disabledAt ? new Date(user.disabledAt) : null,
      lockedUntil: user.lockedUntil ? new Date(user.lockedUntil) : null, failedLoginAttempts: user.failedLoginAttempts ?? 0, createdAt: now, updatedAt: now
    }).onConflictDoNothing().returning({ id: framekitUsers.id });
    return rows.length === 1;
  }

  async findByEmail(email: string, tenantId?: string): Promise<AuthUser | undefined> {
    const where = tenantId
      ? and(eq(framekitUsers.tenantId, tenantId), eq(framekitUsers.email, email.toLowerCase()))
      : eq(framekitUsers.email, email.toLowerCase());
    const rows = await this.db.select().from(framekitUsers).where(where).limit(1);
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }

  async findById(tenantId: string, userId: string): Promise<AuthUser | undefined> {
    const rows = await this.db
      .select()
      .from(framekitUsers)
      .where(and(eq(framekitUsers.tenantId, tenantId), eq(framekitUsers.id, userId)))
      .limit(1);
    return rows[0] ? rowToUser(rows[0]) : undefined;
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
    const now = new Date(input.now);
    const identity = and(
      eq(framekitUsers.tenantId, input.tenantId),
      eq(framekitUsers.id, input.userId),
      eq(framekitUsers.passwordHash, input.expectedPasswordHash),
      isNull(framekitUsers.disabledAt)
    );
    const activeOrExpiredLock = or(isNull(framekitUsers.lockedUntil), lte(framekitUsers.lockedUntil, now));
    const set = input.operation === "failed"
      ? {
          failedLoginAttempts: drizzleSql`${framekitUsers.failedLoginAttempts} + 1`,
          lockedUntil: drizzleSql`case when ${framekitUsers.failedLoginAttempts} + 1 >= ${input.maxFailedLoginAttempts} then greatest(coalesce(${framekitUsers.lockedUntil}, '-infinity'::timestamptz), ${now.toISOString()}::timestamptz + (${input.lockoutSeconds} * interval '1 second')) else ${framekitUsers.lockedUntil} end`,
          updatedAt: now
        }
      : input.operation === "succeeded"
        ? { failedLoginAttempts: 0, lockedUntil: null, updatedAt: now }
        : {
            failedLoginAttempts: drizzleSql`case when ${framekitUsers.lockedUntil} <= ${now.toISOString()}::timestamptz then 0 else ${framekitUsers.failedLoginAttempts} end`,
            lockedUntil: drizzleSql`case when ${framekitUsers.lockedUntil} <= ${now.toISOString()}::timestamptz then null else ${framekitUsers.lockedUntil} end`,
            updatedAt: now
          };
    const rows = await this.db.update(framekitUsers)
      .set(set)
      .where(input.operation === "succeeded" ? and(identity, activeOrExpiredLock) : identity)
      .returning();
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }

  async updatePassword(input: { tenantId: string; userId: string; expectedPasswordHash: string; passwordHash: string; allowDisabled?: boolean }): Promise<AuthUser | undefined> {
    const where = [
      eq(framekitUsers.tenantId, input.tenantId),
      eq(framekitUsers.id, input.userId),
      eq(framekitUsers.passwordHash, input.expectedPasswordHash)
    ];
    if (!input.allowDisabled) {
      where.push(isNull(framekitUsers.disabledAt), or(isNull(framekitUsers.lockedUntil), lte(framekitUsers.lockedUntil, new Date()))!);
    }
    const rows = await this.db.update(framekitUsers)
      .set({ passwordHash: input.passwordHash, failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() })
      .where(and(...where))
      .returning();
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }

  async delete(tenantId: string, userId: string): Promise<void> {
    await this.db.delete(framekitUsers).where(and(eq(framekitUsers.tenantId, tenantId), eq(framekitUsers.id, userId)));
  }
}

export class PostgresRoleStore implements RoleStore {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.sql = postgresForOptions(options);
    this.db = drizzle(options.connection?.drizzleSql ?? this.sql);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.db.execute(drizzleSql`select 1`); }
  async close(): Promise<void> { await closeAdapterSql(this.sql); }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await this.db.execute(drizzleSql.raw(createRoleTableSql()));
  }

  async list(tenantId: string): Promise<AuthRole[]> {
    const rows = await this.db.select().from(framekitRoles).where(eq(framekitRoles.tenantId, tenantId));
    return rows.map(rowToRole).sort((a, b) => a.name.localeCompare(b.name));
  }

  async upsert(role: AuthRole): Promise<AuthRole> {
    const now = new Date();
    const values = {
      tenantId: role.tenantId,
      id: role.id,
      name: role.name,
      permissions: role.permissions,
      createdAt: role.createdAt ? new Date(role.createdAt) : now,
      updatedAt: now
    };
    await this.db
      .insert(framekitRoles)
      .values(values)
      .onConflictDoUpdate({
        target: [framekitRoles.tenantId, framekitRoles.id],
        set: {
          name: values.name,
          permissions: values.permissions,
          updatedAt: now
        }
      });
    return { ...role, createdAt: values.createdAt.toISOString(), updatedAt: values.updatedAt.toISOString() };
  }

  async insertIfAbsent(role: AuthRole): Promise<boolean> {
    const now = new Date();
    const rows = await this.db.insert(framekitRoles).values({
      tenantId: role.tenantId, id: role.id, name: role.name, permissions: role.permissions,
      createdAt: role.createdAt ? new Date(role.createdAt) : now, updatedAt: now
    }).onConflictDoNothing().returning({ id: framekitRoles.id });
    return rows.length === 1;
  }

  async delete(tenantId: string, roleId: string): Promise<void> {
    await this.db.delete(framekitRoles).where(and(eq(framekitRoles.tenantId, tenantId), eq(framekitRoles.id, roleId)));
  }
}

export class PostgresApiTokenStore implements ApiTokenStore {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.sql = postgresForOptions(options);
    this.db = drizzle(options.connection?.drizzleSql ?? this.sql);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.db.execute(drizzleSql`select 1`); }
  async close(): Promise<void> { await closeAdapterSql(this.sql); }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await this.db.execute(drizzleSql.raw(createApiTokenTableSql()));
  }

  async list(tenantId: string): Promise<ApiTokenRecord[]> {
    const rows = await this.db.select().from(framekitApiTokens).where(eq(framekitApiTokens.tenantId, tenantId));
    return rows.map(rowToApiToken).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findByTokenHash(tokenHash: string): Promise<ApiTokenRecord | undefined> {
    const rows = await this.db.select().from(framekitApiTokens).where(eq(framekitApiTokens.tokenHash, tokenHash)).limit(1);
    return rows[0] ? rowToApiToken(rows[0]) : undefined;
  }

  async create(token: ApiTokenRecord): Promise<ApiTokenRecord> {
    await this.db.insert(framekitApiTokens).values({
      tenantId: token.tenantId,
      id: token.id,
      name: token.name,
      tokenHash: token.tokenHash,
      userId: token.userId,
      roles: token.roles,
      permissions: token.permissions,
      createdAt: new Date(token.createdAt),
      expiresAt: token.expiresAt ? new Date(token.expiresAt) : null,
      revokedAt: token.revokedAt ? new Date(token.revokedAt) : null
    });
    return token;
  }

  async revoke(tenantId: string, tokenId: string, revokedAt: string): Promise<ApiTokenRecord> {
    const rows = await this.db
      .update(framekitApiTokens)
      .set({ revokedAt: new Date(revokedAt) })
      .where(and(eq(framekitApiTokens.tenantId, tenantId), eq(framekitApiTokens.id, tokenId)))
      .returning();
    if (!rows[0]) {
      throw new FramekitError("API_TOKEN_NOT_FOUND", `No API token with id "${tokenId}"`, 404);
    }
    return rowToApiToken(rows[0]);
  }
}

export class PostgresSessionRevocationStore implements SessionRevocationStore {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.sql = postgresForOptions(options);
    this.db = drizzle(options.connection?.drizzleSql ?? this.sql);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.db.execute(drizzleSql`select 1`); }
  async close(): Promise<void> { await closeAdapterSql(this.sql); }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await this.db.execute(drizzleSql.raw(createSessionRevocationTableSql()));
  }

  async revoke(sessionId: string, expiresAt: string): Promise<void> {
    const revokedAt = new Date();
    const expiresAtDate = new Date(expiresAt);
    const existing = await this.db
      .select()
      .from(framekitSessionRevocations)
      .where(eq(framekitSessionRevocations.sessionId, sessionId))
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(framekitSessionRevocations)
        .set({ expiresAt: expiresAtDate, revokedAt })
        .where(eq(framekitSessionRevocations.sessionId, sessionId));
      return;
    }
    await this.db.insert(framekitSessionRevocations).values({ sessionId, expiresAt: expiresAtDate, revokedAt });
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(framekitSessionRevocations)
      .where(eq(framekitSessionRevocations.sessionId, sessionId))
      .limit(1);
    const row = rows[0];
    return Boolean(row && row.expiresAt.getTime() > Date.now());
  }
}

export class PostgresAuthIdentityLinkStore implements AuthIdentityLinkStore {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;
  constructor(options: PostgresRepositoryOptions) { this.sql = postgresForOptions(options); this.db = drizzle(options.connection?.drizzleSql ?? this.sql); }
  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async close(): Promise<void> { await closeAdapterSql(this.sql); }
  async dispose(): Promise<void> { await this.close(); }
  async migrate(): Promise<void> { await this.db.execute(drizzleSql.raw(createAuthIdentityLifecycleTablesSql())); }
  async find(tenantId: string, providerId: string, subject: string): Promise<AuthIdentityLink | undefined> {
    const rows = await this.db.select().from(framekitAuthIdentityLinks).where(and(
      eq(framekitAuthIdentityLinks.tenantId, tenantId), eq(framekitAuthIdentityLinks.providerId, providerId), eq(framekitAuthIdentityLinks.subject, subject)
    )).limit(1);
    const row = rows[0];
    return row ? { ...row, email: row.email ?? undefined, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() } : undefined;
  }
  async upsert(link: AuthIdentityLink): Promise<AuthIdentityLink> {
    const existing = await this.find(link.tenantId, link.providerId, link.subject);
    if (existing && existing.userId !== link.userId) throw new FramekitError("PROVIDER_IDENTITY_COLLISION", "Provider subject is already linked to another user in this tenant.", 409);
    await this.db.insert(framekitAuthIdentityLinks).values({ ...link, email: link.email ?? null, createdAt: new Date(link.createdAt), updatedAt: new Date(link.updatedAt) })
      .onConflictDoNothing({ target: [framekitAuthIdentityLinks.tenantId, framekitAuthIdentityLinks.providerId, framekitAuthIdentityLinks.subject] });
    const saved = await this.find(link.tenantId, link.providerId, link.subject);
    if (!saved || saved.userId !== link.userId) throw new FramekitError("PROVIDER_IDENTITY_COLLISION", "Provider subject is already linked to another user in this tenant.", 409);
    return saved;
  }
}

export class PostgresAuthLifecycleTokenStore implements AuthLifecycleTokenStore {
  private readonly sql: Sql;
  constructor(options: PostgresRepositoryOptions) { this.sql = postgresForOptions(options); }
  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async close(): Promise<void> { await closeAdapterSql(this.sql); }
  async dispose(): Promise<void> { await this.close(); }
  async migrate(): Promise<void> { await this.sql.unsafe(createAuthIdentityLifecycleTablesSql()); }
  async create(token: AuthLifecycleToken): Promise<AuthLifecycleToken> {
    await this.sql`insert into framekit_auth_lifecycle_tokens
      (id, tenant_id, kind, token_hash, email, user_id, name, roles, permissions, created_at, expires_at, used_at)
      values (${token.id}, ${token.tenantId}, ${token.kind}, ${token.tokenHash}, ${token.email ?? null}, ${token.userId ?? null}, ${token.name ?? null},
        ${this.sql.json(token.roles ?? [])}, ${this.sql.json(token.permissions ?? [])}, ${new Date(token.createdAt)}, ${new Date(token.expiresAt)}, null)`;
    return { ...token };
  }
  async consume(tenantId: string, kind: AuthLifecycleTokenKind, tokenHash: string, usedAt: string): Promise<AuthLifecycleToken | undefined> {
    const rows = await this.sql<Record<string, unknown>[]>`update framekit_auth_lifecycle_tokens set used_at = ${new Date(usedAt)}
      where tenant_id = ${tenantId} and kind = ${kind} and token_hash = ${tokenHash} and used_at is null and expires_at > ${new Date(usedAt)} returning *`;
    return rows[0] ? lifecycleTokenFromSql(rows[0]) : undefined;
  }

  /** Operational retention task; deletes only expired lifecycle tokens. */
  async pruneExpired(limit = 1000): Promise<number> {
    assertRetentionLimit(limit);
    const rows = await this.sql`
      with expired as (
        select ctid from framekit_auth_lifecycle_tokens
        where expires_at <= clock_timestamp()
        order by expires_at
        limit ${limit}
        for update skip locked
      )
      delete from framekit_auth_lifecycle_tokens as tokens
      using expired
      where tokens.ctid = expired.ctid
      returning tokens.id`;
    return rows.length;
  }
}

export class PostgresOidcAuthorizationStateStore implements OidcAuthorizationStateStore {
  private readonly sql: Sql;
  constructor(options: PostgresRepositoryOptions) { this.sql = postgresForOptions(options); }
  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async close(): Promise<void> { await closeAdapterSql(this.sql); }
  async dispose(): Promise<void> { await this.close(); }
  async migrate(): Promise<void> { await this.sql.unsafe(createAuthIdentityLifecycleTablesSql()); }
  async create(state: OidcAuthorizationState): Promise<OidcAuthorizationState> {
    await this.sql`insert into framekit_oidc_authorization_states
      (id, provider_id, tenant_id, state_hash, nonce_hash, encrypted_code_verifier, return_to, redirect_uri, created_at, expires_at, used_at)
      values (${state.id}, ${state.providerId}, ${state.tenantId}, ${state.stateHash}, ${state.nonceHash}, ${state.encryptedCodeVerifier},
        ${state.returnTo}, ${state.redirectUri}, ${new Date(state.createdAt)}, ${new Date(state.expiresAt)}, null)`;
    return { ...state };
  }
  async consume(providerId: string, stateHash: string, usedAt: string): Promise<OidcAuthorizationState | undefined> {
    const rows = await this.sql<Record<string, unknown>[]>`update framekit_oidc_authorization_states set used_at = ${new Date(usedAt)}
      where provider_id = ${providerId} and state_hash = ${stateHash} and used_at is null and expires_at > ${new Date(usedAt)} returning *`;
    return rows[0] ? oidcStateFromSql(rows[0]) : undefined;
  }

  /** Operational retention task; deletes only expired authorization states. */
  async pruneExpired(limit = 1000): Promise<number> {
    assertRetentionLimit(limit);
    const rows = await this.sql`
      with expired as (
        select ctid from framekit_oidc_authorization_states
        where expires_at <= clock_timestamp()
        order by expires_at
        limit ${limit}
        for update skip locked
      )
      delete from framekit_oidc_authorization_states as states
      using expired
      where states.ctid = expired.ctid
      returning states.id`;
    return rows.length;
  }
}

function assertRetentionLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new TypeError("Retention limit must be a safe integer from 1 through 10000.");
  }
}

export class PostgresAuthAuditStore implements AuthAuditSink {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;
  constructor(options: PostgresRepositoryOptions) { this.sql = postgresForOptions(options); this.db = drizzle(options.connection?.drizzleSql ?? this.sql); }
  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async close(): Promise<void> { await closeAdapterSql(this.sql); }
  async dispose(): Promise<void> { await this.close(); }
  async migrate(): Promise<void> { await this.db.execute(drizzleSql.raw(createAuthIdentityLifecycleTablesSql())); }
  async record(event: AuthAuditEvent): Promise<void> {
    await this.db.insert(framekitAuthAuditEvents).values({ ...event, actorUserId: event.actorUserId ?? null, targetUserId: event.targetUserId ?? null,
      success: event.success ? 1 : 0, createdAt: new Date(event.createdAt), details: event.details ?? null });
  }
  async list(tenantId: string): Promise<AuthAuditEvent[]> {
    const rows = await this.db.select().from(framekitAuthAuditEvents).where(eq(framekitAuthAuditEvents.tenantId, tenantId));
    return rows.map((row) => ({ id: row.id, tenantId: row.tenantId, actorUserId: row.actorUserId ?? undefined,
      targetUserId: row.targetUserId ?? undefined, action: row.action, success: row.success === 1,
      createdAt: row.createdAt.toISOString(), details: row.details ?? undefined })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

function rowToUser(row: typeof framekitUsers.$inferSelect): AuthUser {
  return {
    tenantId: row.tenantId,
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.passwordHash,
    roles: row.roles,
    permissions: row.permissions,
    disabledAt: row.disabledAt?.toISOString(),
    lockedUntil: row.lockedUntil?.toISOString(),
    failedLoginAttempts: row.failedLoginAttempts
  };
}

function rowToRole(row: typeof framekitRoles.$inferSelect): AuthRole {
  return {
    tenantId: row.tenantId,
    id: row.id,
    name: row.name,
    permissions: row.permissions,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function rowToApiToken(row: typeof framekitApiTokens.$inferSelect): ApiTokenRecord {
  return {
    tenantId: row.tenantId,
    id: row.id,
    name: row.name,
    tokenHash: row.tokenHash,
    userId: row.userId ?? undefined,
    roles: row.roles,
    permissions: row.permissions,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString(),
    revokedAt: row.revokedAt?.toISOString()
  };
}

function lifecycleTokenFromSql(row: Record<string, unknown>): AuthLifecycleToken {
  return {
    id: String(row.id), tenantId: String(row.tenant_id), kind: String(row.kind) as AuthLifecycleTokenKind,
    tokenHash: String(row.token_hash), email: optionalString(row.email), userId: optionalString(row.user_id), name: optionalString(row.name),
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [], permissions: Array.isArray(row.permissions) ? row.permissions.map(String) : [],
    createdAt: sqlDate(row.created_at), expiresAt: sqlDate(row.expires_at), usedAt: row.used_at ? sqlDate(row.used_at) : undefined
  };
}

function oidcStateFromSql(row: Record<string, unknown>): OidcAuthorizationState {
  return {
    id: String(row.id), providerId: String(row.provider_id), tenantId: String(row.tenant_id), stateHash: String(row.state_hash),
    nonceHash: String(row.nonce_hash), encryptedCodeVerifier: String(row.encrypted_code_verifier), returnTo: String(row.return_to),
    redirectUri: String(row.redirect_uri), createdAt: sqlDate(row.created_at), expiresAt: sqlDate(row.expires_at),
    usedAt: row.used_at ? sqlDate(row.used_at) : undefined
  };
}

function optionalString(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function sqlDate(value: unknown): string { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }

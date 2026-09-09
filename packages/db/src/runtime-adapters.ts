import { and, asc, desc, eq, gt, gte, lt, lte, ne, or, sql as drizzleSql, type SQL } from "drizzle-orm";
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
import { framekitAuditEvents, framekitCustomFields, framekitMigrations, framekitOutboxEvents, framekitSettingValues, framekitViews } from "./schema.js";
import type { PostgresMigrationStoreOptions, PostgresRealtimePublisherOptions, PostgresRepositoryOptions } from "./types.js";
import { createAuditTableSql, createCustomFieldTableSql, createMigrationTableSql, createMutationTablesSql, createNamingSeriesTableSql, createOutboxTableSql, createPostgresMigrationStatements, createRealtimeTableSql, createSettingValueTableSql, createViewTableSql, executableStatements, validateExecutableMigration } from "./ddl.js";
import { indexIdentifier, sqlLiteral } from "./migration-sql-helpers.js";
import { assertPostgresUrl, closeAdapterSql, postgresForOptions, runBootstrapMigrations } from "./connection.js";

export class PostgresAuditStore implements AuditStore {
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
    await runBootstrapMigrations(this.sql, createAuditTableSql());
  }

  describe(): RepositoryDiagnostics {
    return {
      kind: "postgres",
      durable: true,
      features: ["audit", "migration"]
    };
  }

  async record(event: AuditEvent): Promise<void> {
    await this.db.insert(framekitAuditEvents).values({
      tenantId: event.tenantId,
      id: event.id,
      userId: event.userId,
      action: event.action,
      doctype: event.doctype,
      documentId: event.documentId,
      createdAt: new Date(event.createdAt)
    });
  }

  async list(tenant: TenantContext, options: { limit?: number } = {}): Promise<AuditEvent[]> {
    const rows = await this.db
      .select()
      .from(framekitAuditEvents)
      .where(eq(framekitAuditEvents.tenantId, tenant.tenantId))
      .limit(options.limit ?? 100);
    return rows.map(rowToAuditEvent).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export class PostgresOutboxStore implements OutboxStore {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.sql = postgresForOptions(options);
    this.db = drizzle(options.connection?.drizzleSql ?? this.sql);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await runBootstrapMigrations(this.sql, createOutboxTableSql());
  }

  describe(): RepositoryDiagnostics {
    return {
      kind: "postgres",
      durable: true,
      features: ["outbox", "migration"]
    };
  }

  async close(): Promise<void> {
    await closeAdapterSql(this.sql);
  }

  async record(event: OutboxEvent): Promise<void> {
    await this.db.insert(framekitOutboxEvents).values({
      tenantId: event.tenantId,
      id: event.id,
      type: event.type,
      topic: event.topic,
      payload: event.payload,
      status: event.status,
      attempts: event.attempts,
      createdAt: new Date(event.createdAt),
      processedAt: event.processedAt ? new Date(event.processedAt) : null,
      error: event.error,
      leaseOwner: event.leaseOwner,
      leaseExpiresAt: event.leaseExpiresAt ? new Date(event.leaseExpiresAt) : null,
      nextAttemptAt: event.nextAttemptAt ? new Date(event.nextAttemptAt) : null
    });
  }

  async list(tenant: TenantContext, options: { limit?: number; status?: OutboxEvent["status"] } = {}): Promise<OutboxEvent[]> {
    const where = options.status
      ? and(eq(framekitOutboxEvents.tenantId, tenant.tenantId), eq(framekitOutboxEvents.status, options.status))
      : eq(framekitOutboxEvents.tenantId, tenant.tenantId);
    const rows = await this.db.select().from(framekitOutboxEvents).where(where).limit(options.limit ?? 100);
    return rows.map(rowToOutboxEvent).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async markDispatched(tenant: TenantContext, id: string): Promise<OutboxEvent> {
    return this.updateStatus(tenant, id, "dispatched");
  }

  async markFailed(tenant: TenantContext, id: string, error: string): Promise<OutboxEvent> {
    return this.updateStatus(tenant, id, "failed", error);
  }

  async claim(tenant: TenantContext, options: OutboxClaimOptions): Promise<OutboxEvent[]> {
    const now = new Date(options.now ?? new Date().toISOString());
    const nowIso = now.toISOString();
    const maxAttempts = options.maxAttempts ?? 5;
    const leaseExpiresAt = new Date(now.getTime() + (options.leaseMs ?? 30_000)).toISOString();
    return this.sql.begin(async (sql) => {
      await sql`
        update framekit_outbox_events
        set status = 'dead_letter', processed_at = ${nowIso}::timestamptz,
            error = coalesce(error, case when status = 'leased' then 'Lease expired after maximum delivery attempts' else 'Maximum delivery attempts exhausted' end),
            lease_owner = null, lease_expires_at = null
        where tenant_id = ${tenant.tenantId} and attempts >= ${maxAttempts} and (
          status = 'failed' or (status = 'leased' and lease_expires_at <= ${nowIso}::timestamptz)
        )
      `;
      const rows = await sql<OutboxSqlRow[]>`
        with candidates as (
          select tenant_id, id
          from framekit_outbox_events
          where tenant_id = ${tenant.tenantId} and attempts < ${maxAttempts} and (
            status = 'pending' or
            (status = 'failed' and (next_attempt_at is null or next_attempt_at <= ${nowIso}::timestamptz)) or
            (status = 'leased' and lease_expires_at <= ${nowIso}::timestamptz)
          )
          order by created_at asc, id asc
          for update skip locked
          limit ${options.limit ?? 100}
        )
        update framekit_outbox_events event
        set status = 'leased', attempts = event.attempts + 1, lease_owner = ${options.ownerId},
            lease_expires_at = ${leaseExpiresAt}::timestamptz, next_attempt_at = null
        from candidates
        where event.tenant_id = candidates.tenant_id and event.id = candidates.id
        returning event.*
      `;
      return rows.map(outboxSqlRowToEvent);
    });
  }

  async acknowledge(tenant: TenantContext, id: string, ownerId: string): Promise<OutboxEvent> {
    return this.finishLease(tenant, id, ownerId, { status: "dispatched" });
  }

  async reject(tenant: TenantContext, id: string, ownerId: string, error: string, options: { backoffMs?: number; maxAttempts?: number; now?: string } = {}): Promise<OutboxEvent> {
    const now = new Date(options.now ?? new Date().toISOString());
    const nowIso = now.toISOString();
    const nextAttemptAt = new Date(now.getTime() + (options.backoffMs ?? 0)).toISOString();
    const rows = await this.sql<OutboxSqlRow[]>`
      update framekit_outbox_events
      set status = case when attempts >= ${options.maxAttempts ?? 5} then 'dead_letter' else 'failed' end,
          error = ${error}, processed_at = ${nowIso}::timestamptz, lease_owner = null, lease_expires_at = null,
          next_attempt_at = case when attempts >= ${options.maxAttempts ?? 5} then null else ${nextAttemptAt}::timestamptz end
      where tenant_id = ${tenant.tenantId} and id = ${id} and status = 'leased' and lease_owner = ${ownerId}
      returning *
    `;
    if (!rows[0]) throw new FramekitError("OUTBOX_LEASE_LOST", `Outbox event "${id}" is not leased by "${ownerId}"`, 409);
    return outboxSqlRowToEvent(rows[0]);
  }

  private async finishLease(tenant: TenantContext, id: string, ownerId: string, update: { status: "dispatched" }): Promise<OutboxEvent> {
    const rows = await this.sql<OutboxSqlRow[]>`
      update framekit_outbox_events
      set status = ${update.status}, error = null, processed_at = now(), lease_owner = null, lease_expires_at = null, next_attempt_at = null
      where tenant_id = ${tenant.tenantId} and id = ${id} and status = 'leased' and lease_owner = ${ownerId}
      returning *
    `;
    if (!rows[0]) throw new FramekitError("OUTBOX_LEASE_LOST", `Outbox event "${id}" is not leased by "${ownerId}"`, 409);
    return outboxSqlRowToEvent(rows[0]);
  }

  private async updateStatus(tenant: TenantContext, id: string, status: OutboxEvent["status"], error?: string): Promise<OutboxEvent> {
    const rows = await this.db
      .update(framekitOutboxEvents)
      .set({
        status,
        error,
        attempts: drizzleSql`${framekitOutboxEvents.attempts} + 1`,
        processedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null
      })
      .where(and(eq(framekitOutboxEvents.tenantId, tenant.tenantId), eq(framekitOutboxEvents.id, id)))
      .returning();
    if (!rows[0]) {
      throw new FramekitError("OUTBOX_EVENT_NOT_FOUND", `No outbox event with id "${id}"`, 404);
    }
    return rowToOutboxEvent(rows[0]);
  }
}

type RealtimeSqlRow = {
  cursor: string;
  channel: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: Date | string;
};

export class PostgresRealtimePublisher implements RealtimePublisher {
  private readonly sql: Sql;
  private readonly listenerSql: Sql;
  private readonly listeners = new Map<string, Set<(event: RuntimeRealtimeEvent) => void>>();
  private readonly deliveredCursors = new Map<string, string>();
  private readonly channelReady = new Map<string, Promise<void>>();
  private readonly deliveryPumps = new Map<string, Promise<void>>();
  private readonly dirtyChannels = new Set<string>();
  private readonly faultInjector?: PostgresRealtimePublisherOptions["faultInjector"];
  private listener?: Awaited<ReturnType<Sql["listen"]>>;
  private listenerReady?: Promise<void>;
  private closePromise?: Promise<void>;
  private closed = false;

  constructor(options: PostgresRealtimePublisherOptions) {
    this.sql = postgresForOptions(options);
    assertPostgresUrl(options.connectionString);
    this.listenerSql = postgres(options.connectionString, { max: 1 });
    this.faultInjector = options.faultInjector;
  }

  async start(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.sql`select 1`;
    await this.ensureListener();
    signal?.throwIfAborted();
  }

  async migrate(): Promise<void> {
    await runBootstrapMigrations(this.sql, createRealtimeTableSql());
  }

  describe(): RepositoryDiagnostics {
    return { kind: "postgres", durable: true, features: ["publish", "subscribe", "history", "cursor-replay"] };
  }

  async publish(event: RuntimeRealtimeEvent): Promise<void> {
    if (this.closed) throw new FramekitError("REALTIME_CLOSED", "Realtime publisher is closed", 503);
    await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${event.channel}, 0))`;
      await this.faultInjector?.("locked", event);
      const rows = await tx<RealtimeSqlRow[]>`
        insert into framekit_realtime_events (channel, type, payload, created_at)
        values (${event.channel}, ${event.type}, ${tx.json(event.payload as Parameters<Sql["json"]>[0])}, ${event.createdAt ? new Date(event.createdAt) : new Date()})
        returning cursor::text, channel, type, payload, created_at
      `;
      const persisted = realtimeSqlRowToEvent(rows[0]!);
      await this.faultInjector?.("inserted", event);
      await tx`select pg_notify('framekit_realtime_events', ${JSON.stringify({ cursor: persisted.cursor, channel: persisted.channel })})`;
    });
  }

  async list(channel: string, options: { limit?: number; after?: string; order?: "asc" | "desc" } = {}): Promise<RuntimeRealtimeEvent[]> {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new FramekitError("INVALID_REALTIME_CURSOR", "Realtime history limit must be an integer between 1 and 1000", 422);
    }
    if (options.after && !/^\d+$/.test(options.after)) {
      throw new FramekitError("INVALID_REALTIME_CURSOR", "Realtime cursor must be a positive integer", 422);
    }
    const rows = options.after
      ? await this.sql<RealtimeSqlRow[]>`
          select cursor::text, channel, type, payload, created_at from framekit_realtime_events
          where channel = ${channel} and cursor > ${options.after}::bigint
          order by case when ${options.order ?? "asc"} = 'asc' then cursor end asc,
                   case when ${options.order ?? "asc"} = 'desc' then cursor end desc limit ${limit}
        `
      : await this.sql<RealtimeSqlRow[]>`
          select cursor::text, channel, type, payload, created_at from framekit_realtime_events
          where channel = ${channel}
          order by case when ${options.order ?? "desc"} = 'asc' then cursor end asc,
                   case when ${options.order ?? "desc"} = 'desc' then cursor end desc limit ${limit}
        `;
    return rows.map(realtimeSqlRowToEvent);
  }

  async subscribe(channel: string, listener: (event: RuntimeRealtimeEvent) => void, options: { signal?: AbortSignal } = {}): Promise<() => void> {
    if (this.closed) throw new FramekitError("REALTIME_CLOSED", "Realtime publisher is closed", 503);
    const listeners = this.listeners.get(channel) ?? new Set<(event: RuntimeRealtimeEvent) => void>();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
    const unsubscribe = () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(channel);
        this.deliveredCursors.delete(channel);
        this.channelReady.delete(channel);
      }
    };
    try {
      await this.ensureListener();
      let ready = this.channelReady.get(channel);
      if (!ready) {
        ready = this.initializeChannel(channel);
        this.channelReady.set(channel, ready);
      }
      await ready;
      if (options.signal?.aborted) unsubscribe();
      else options.signal?.addEventListener("abort", unsubscribe, { once: true });
      return unsubscribe;
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  async health(): Promise<{ ok: boolean; details?: Record<string, unknown> }> {
    try {
      await this.ensureListener();
      await this.sql`select 1`;
      return { ok: true, details: { kind: "postgres", listening: true } };
    } catch (error) {
      return { ok: false, details: { kind: "postgres", error: error instanceof Error ? error.message : "Unknown realtime failure" } };
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeInternal();
    return this.closePromise;
  }

  private async closeInternal(): Promise<void> {
    this.closed = true;
    const errors: unknown[] = [];
    try { await this.listenerReady; } catch (error) { errors.push(error); }
    try { await this.listener?.unlisten(); } catch (error) { errors.push(error); }
    this.listeners.clear();
    await Promise.allSettled([...this.deliveryPumps.values()]);
    const closed = await Promise.allSettled([this.listenerSql.end({ timeout: 1 }), closeAdapterSql(this.sql, 1)]);
    errors.push(...closed.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason));
    this.deliveredCursors.clear();
    this.channelReady.clear();
    if (errors.length) throw new AggregateError(errors, "Realtime publisher shutdown failed.");
  }

  async dispose(): Promise<void> { await this.close(); }

  private async ensureListener(): Promise<void> {
    if (this.listener || this.closed) return;
    this.listenerReady ??= this.listenerSql.listen("framekit_realtime_events", (payload) => {
      void this.receive(payload).catch(() => undefined);
    }).then((listener) => {
      this.listener = listener;
    });
    await this.listenerReady;
  }

  private async receive(payload: string): Promise<void> {
    const notification = JSON.parse(payload) as { cursor?: string; channel?: string };
    if (!notification.cursor || !notification.channel || !this.listeners.has(notification.channel)) return;
    const ready = this.channelReady.get(notification.channel);
    if (ready) await ready;
    await this.deliverChannel(notification.channel);
  }

  private async initializeChannel(channel: string): Promise<void> {
    const rows = await this.sql<{ cursor: string }[]>`
      select coalesce(max(cursor), 0)::text as cursor from framekit_realtime_events where channel = ${channel}
    `;
    this.deliveredCursors.set(channel, rows[0]?.cursor ?? "0");
  }

  private async deliverChannel(channel: string): Promise<void> {
    this.dirtyChannels.add(channel);
    const existing = this.deliveryPumps.get(channel);
    if (existing) return existing;
    const pump = (async () => {
      while (this.dirtyChannels.delete(channel) && this.listeners.has(channel)) {
        while (this.listeners.has(channel)) {
          const after = this.deliveredCursors.get(channel) ?? "0";
          const rows = await this.sql<RealtimeSqlRow[]>`
            select cursor::text, channel, type, payload, created_at from framekit_realtime_events
            where channel = ${channel} and cursor > ${after}::bigint order by cursor asc limit 1000
          `;
          if (rows.length === 0) break;
          for (const row of rows) {
            const event = realtimeSqlRowToEvent(row);
            this.deliveredCursors.set(channel, event.cursor!);
            this.emit(event);
          }
          if (rows.length < 1_000) break;
        }
      }
    })().finally(() => {
      this.deliveryPumps.delete(channel);
      if (this.dirtyChannels.has(channel) && this.listeners.has(channel)) void this.deliverChannel(channel).catch(() => undefined);
    });
    this.deliveryPumps.set(channel, pump);
    return pump;
  }

  private emit(event: RuntimeRealtimeEvent): void {
    for (const listener of this.listeners.get(event.channel) ?? []) {
      try {
        listener(event);
      } catch {
        // One subscriber must not prevent other subscribers from advancing.
      }
    }
  }
}

export class PostgresCustomizationStore implements CustomizationStore {
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
    await runBootstrapMigrations(this.sql, createCustomFieldTableSql(),
      createViewTableSql(),
      createSettingValueTableSql());
  }

  describe(): RepositoryDiagnostics {
    return {
      kind: "postgres",
      durable: true,
      features: ["custom-fields", "views", "settings", "migration"]
    };
  }

  async listCustomFields(tenant: TenantContext): Promise<CustomFieldDefinition[]> {
    const rows = await this.db.select().from(framekitCustomFields).where(eq(framekitCustomFields.tenantId, tenant.tenantId));
    return rows.map(rowToCustomField);
  }

  async addCustomField(_tenant: TenantContext, field: CustomFieldDefinition): Promise<CustomFieldDefinition> {
    const now = new Date();
    await this.db.insert(framekitCustomFields).values({
      tenantId: field.tenantId,
      id: field.id,
      doctype: field.doctype,
      field: field.field,
      createdAt: now,
      updatedAt: now
    });
    return field;
  }

  async listViews(tenant: TenantContext): Promise<ViewDefinition[]> {
    const rows = await this.db.select().from(framekitViews).where(eq(framekitViews.tenantId, tenant.tenantId));
    return rows.map(rowToView);
  }

  async upsertView(_tenant: TenantContext, view: ViewDefinition): Promise<ViewDefinition> {
    const now = new Date();
    await this.db
      .insert(framekitViews)
      .values({
        tenantId: view.tenantId,
        id: view.id,
        doctype: view.doctype,
        type: view.type,
        fields: view.fields,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [framekitViews.tenantId, framekitViews.id],
        set: {
          fields: view.fields,
          updatedAt: now
        }
      });
    return view;
  }

  async listSettingValues(tenant: TenantContext, appName: string): Promise<StoredSettingValue[]> {
    const rows = await this.db.select().from(framekitSettingValues).where(and(
      eq(framekitSettingValues.appName, appName),
      or(eq(framekitSettingValues.scopeId, `tenant:${tenant.tenantId}`), eq(framekitSettingValues.scopeId, `app:${appName}`))
    ));
    return rows.map((row) => ({ appName: row.appName, scopeId: row.scopeId, key: row.key, value: row.value, protected: row.protected, updatedAt: row.updatedAt.toISOString() }));
  }

  async upsertSettingValue(tenant: TenantContext, value: StoredSettingValue): Promise<StoredSettingValue> {
    if (value.scopeId !== `tenant:${tenant.tenantId}` && value.scopeId !== `app:${value.appName}`) {
      throw new FramekitError("FORBIDDEN", "Setting value scope does not match the authenticated tenant or application.", 403);
    }
    await this.db.insert(framekitSettingValues).values({ ...value, updatedAt: new Date(value.updatedAt) }).onConflictDoUpdate({
      target: [framekitSettingValues.appName, framekitSettingValues.scopeId, framekitSettingValues.key],
      set: { value: value.value, protected: value.protected, updatedAt: new Date(value.updatedAt) }
    });
    return value;
  }
}

export class PostgresNamingSeriesStore implements NamingSeriesStore {
  private readonly sql: Sql;

  constructor(options: PostgresRepositoryOptions) {
    this.sql = postgresForOptions(options);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async close(): Promise<void> { await closeAdapterSql(this.sql); }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await runBootstrapMigrations(this.sql, createNamingSeriesTableSql());
  }

  describe(): RepositoryDiagnostics {
    return {
      kind: "postgres",
      durable: true,
      features: ["naming-series", "migration"]
    };
  }

  async next(tenant: TenantContext, _doctype: DocTypeDefinition, prefix: string, digits: number): Promise<string> {
    const rows = await this.sql<{ current_value: number }[]>`
      insert into framekit_naming_series (tenant_id, prefix, current_value, updated_at)
      values (${tenant.tenantId}, ${prefix}, 1, now())
      on conflict (tenant_id, prefix)
      do update set current_value = framekit_naming_series.current_value + 1, updated_at = now()
      returning current_value
    `;
    const value = rows[0]?.current_value ?? 1;
    return `${prefix}-${String(value).padStart(digits, "0")}`;
  }
}

export class PostgresMigrationStore implements MigrationStore {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;
  private readonly faultInjector?: PostgresMigrationStoreOptions["faultInjector"];
  private readonly conversionRegistry: ReadonlyMap<string, Readonly<MigrationConversionArtifact>>;

  constructor(options: PostgresMigrationStoreOptions) {
    this.conversionRegistry = createOnlineConversionRegistry(options.conversionRegistry ?? []);
    this.sql = postgresForOptions(options);
    this.db = drizzle(options.connection?.drizzleSql ?? this.sql);
    this.faultInjector = options.faultInjector;
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async close(): Promise<void> { await closeAdapterSql(this.sql); }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await runBootstrapMigrations(this.sql, `${createMigrationTableSql()}\n${createMutationTablesSql()}`);
  }

  describe(): RepositoryDiagnostics {
    return {
      kind: "postgres",
      durable: true,
      features: ["migration-history", "migration"]
    };
  }

  async list(tenant: TenantContext, options: { appName?: string } = {}): Promise<MigrationRecord[]> {
    const rows = await this.db.select().from(framekitMigrations).where(options.appName
      ? and(eq(framekitMigrations.tenantId, tenant.tenantId), eq(framekitMigrations.appName, options.appName))
      : eq(framekitMigrations.tenantId, tenant.tenantId));
    return rows.map(rowToMigration).sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  }

  async record(tenant: TenantContext, migration: MigrationRecord): Promise<MigrationRecord> {
    assertMigrationIdentity(tenant, migration.appName, migration);
    await validateMigrationPlan(migration);
    await this.db.insert(framekitMigrations).values({
      tenantId: migration.tenantId,
      id: migration.id,
      appName: migration.appName,
      fromSchemaChecksum: migration.fromSchemaChecksum,
      toSchemaChecksum: migration.toSchemaChecksum,
      fromUniqueConstraints: migration.fromUniqueConstraints,
      toUniqueConstraints: migration.toUniqueConstraints,
      changes: migration.changes,
      conversions: migration.conversions ?? [],
      checksum: migration.checksum,
      createdAt: new Date(migration.createdAt),
      appliedAt: new Date(migration.appliedAt)
    });
    return migration;
  }

  async applyPlan(tenant: TenantContext, plan: MigrationPlan, options: { allowDestructive?: boolean; appliedAt?: string } = {}): Promise<MigrationRecord> {
    await validateExecutableMigration(plan, options);
    assertMigrationIdentity(tenant, plan.appName, plan);
    const statements = executableStatements(createPostgresMigrationStatements(plan));
    const appliedAt = options.appliedAt ?? new Date().toISOString();
    const record: MigrationRecord = { ...plan, appliedAt };
    return this.sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`framekit:migration:${tenant.tenantId}:${plan.appName}`}, 0))`;
      const existing = await sql<MigrationSqlRow[]>`
        select tenant_id as "tenantId", id, app_name as "appName", from_schema_checksum as "fromSchemaChecksum",
               to_schema_checksum as "toSchemaChecksum", from_unique_constraints as "fromUniqueConstraints",
               to_unique_constraints as "toUniqueConstraints", changes, conversions, checksum, created_at as "createdAt", applied_at as "appliedAt"
        from framekit_migrations where tenant_id = ${tenant.tenantId} and app_name = ${plan.appName} and id = ${plan.id} limit 1
      `;
      if (existing[0]) {
        const applied = migrationSqlRowToRecord(existing[0]);
        if (applied.checksum === plan.checksum) return applied;
        throw new FramekitError("MIGRATION_ID_CONFLICT", `Migration ID "${plan.id}" was already applied with a different checksum.`, 409);
      }
      const latestRows = await sql<MigrationSqlRow[]>`
        select tenant_id as "tenantId", id, app_name as "appName", from_schema_checksum as "fromSchemaChecksum",
               to_schema_checksum as "toSchemaChecksum", from_unique_constraints as "fromUniqueConstraints",
               to_unique_constraints as "toUniqueConstraints", changes, conversions, checksum, created_at as "createdAt", applied_at as "appliedAt"
        from framekit_migrations where tenant_id = ${tenant.tenantId} and app_name = ${plan.appName} order by applied_at desc, id desc limit 1
      `;
      assertMigrationDrift(latestRows[0] ? migrationSqlRowToRecord(latestRows[0]) : undefined, plan);
      await assertLegacyUniqueValues(sql, tenant.tenantId, plan.toUniqueConstraints);
      for (const [statementIndex, statement] of statements.entries()) {
        await sql.unsafe(statement);
        await this.faultInjector?.("statement", plan, statementIndex);
      }
      await resynchronizeUniqueValues(sql, tenant.tenantId, plan.fromUniqueConstraints, plan.toUniqueConstraints);
      await this.faultInjector?.("backfill", plan);
      await this.faultInjector?.("record", plan);
      await sql`
        insert into framekit_migrations (
          tenant_id, id, app_name, from_schema_checksum, to_schema_checksum, from_unique_constraints,
          to_unique_constraints, changes, conversions, checksum, created_at, applied_at
        ) values (
          ${record.tenantId}, ${record.id}, ${record.appName}, ${record.fromSchemaChecksum}, ${record.toSchemaChecksum},
          ${JSON.stringify(record.fromUniqueConstraints)}::jsonb, ${JSON.stringify(record.toUniqueConstraints)}::jsonb,
          ${JSON.stringify(record.changes)}::jsonb, ${JSON.stringify(record.conversions ?? [])}::jsonb,
          ${record.checksum}, ${record.createdAt}::timestamptz, ${record.appliedAt}::timestamptz
        )
      `;
      return record;
    });
  }

  async getOnlineRun(tenant: TenantContext, appName: string, migrationId: string): Promise<OnlineMigrationRun | undefined> {
    const rows = await this.sql<OnlineMigrationRunSqlRow[]>`
      select tenant_id as "tenantId", app_name as "appName", migration_id as "migrationId",
             plan_digest as "planDigest", conversion_digest as "conversionDigest", status, checkpoint,
             approval, attempt_id as "attemptId", error, started_at as "startedAt", updated_at as "updatedAt", completed_at as "completedAt"
      from framekit_migration_runs
      where tenant_id = ${tenant.tenantId} and app_name = ${appName} and migration_id = ${migrationId}
      limit 1
    `;
    return rows[0] ? onlineMigrationSqlRowToRun(rows[0]) : undefined;
  }

  async applyOnlinePlan(tenant: TenantContext, plan: MigrationPlan, options: OnlineMigrationOptions): Promise<MigrationRecord> {
    await validateMigrationPlan(plan);
    assertMigrationIdentity(tenant, plan.appName, plan);
    const conversions = validateOnlineConversions(plan, this.conversionRegistry);
    const conversionDigest = await onlineConversionDigest(conversions);
    validateOnlineOptions(plan, options);
    const attemptId = crypto.randomUUID();
    const checkpoint = { conversionIndex: 0, processed: 0 };
    await this.withOnlineLock(tenant, plan, options.lockTimeoutMs ?? 5_000, async (sql) => {
      const existing = await selectOnlineRun(sql, tenant.tenantId, plan.appName, plan.id);
      if (existing) {
        assertOnlineRunMatches(existing, plan, conversionDigest);
        if (existing.approval.outcome === "rejected") throw new FramekitError("MIGRATION_APPROVAL_REJECTED", "Rejected online migration evidence is terminal; create a distinct reviewed plan and run identity.", 409);
        if (stableOnlineJson(existing.approval) !== stableOnlineJson(options.approval)) throw new FramekitError("MIGRATION_APPROVAL_DRIFT", "Resume approval does not match the stored approval evidence.", 409);
        await sql`update framekit_migration_runs set attempt_id = ${attemptId}, updated_at = now()
          where tenant_id = ${tenant.tenantId} and app_name = ${plan.appName} and migration_id = ${plan.id} and status <> 'completed'`;
        return;
      }
      await sql`
        insert into framekit_migration_runs (
          tenant_id, app_name, migration_id, plan_digest, conversion_digest, status, checkpoint,
          approval, attempt_id, error, started_at, updated_at
        ) values (
          ${tenant.tenantId}, ${plan.appName}, ${plan.id}, ${plan.checksum}, ${conversionDigest},
          ${options.approval.outcome === "approved" ? "pending" : "failed"}, ${JSON.stringify(checkpoint)}::jsonb,
          ${JSON.stringify(options.approval)}::jsonb, ${options.approval.outcome === "approved" ? attemptId : null}, ${options.approval.outcome === "approved" ? null : "Migration approval was rejected."}, now(), now()
        )
      `;
    });
    if (options.approval.outcome !== "approved") {
      throw new FramekitError("MIGRATION_APPROVAL_REJECTED", "Online migration approval was rejected.", 409);
    }

    const chunkSize = options.chunkSize ?? 100;
    const maxRetries = options.maxRetries ?? 3;
    try {
      while (true) {
        const transformed = await retryOnlineChunk(maxRetries, () => this.withOnlineLock(
          tenant,
          plan,
          options.lockTimeoutMs ?? 5_000,
          async (sql) => this.transformOnlineChunk(sql, tenant, plan, conversions, this.conversionRegistry, conversionDigest, chunkSize, attemptId)
        ));
        if (transformed) break;
      }
      return await this.withOnlineLock(tenant, plan, options.lockTimeoutMs ?? 5_000, async (sql) => {
        const run = await selectOnlineRun(sql, tenant.tenantId, plan.appName, plan.id);
        if (!run) throw new FramekitError("MIGRATION_RUN_MISSING", "Online migration run state is missing.", 409);
        assertOnlineRunMatches(run, plan, conversionDigest);
        if (run.approval.outcome === "rejected") throw new FramekitError("MIGRATION_APPROVAL_REJECTED", "Rejected online migration evidence is terminal.", 409);
        const prior = await selectAppliedMigration(sql, tenant.tenantId, plan.appName, plan.id);
        if (prior) {
          if (prior.checksum !== plan.checksum) throw new FramekitError("MIGRATION_ID_CONFLICT", `Migration ID "${plan.id}" was already applied with a different checksum.`, 409);
          await markOnlineRunCompleted(sql, tenant.tenantId, plan.appName, plan.id);
          return prior;
        }
        const latestRows = await sql<MigrationSqlRow[]>`
          select tenant_id as "tenantId", id, app_name as "appName", from_schema_checksum as "fromSchemaChecksum",
                 to_schema_checksum as "toSchemaChecksum", from_unique_constraints as "fromUniqueConstraints",
                 to_unique_constraints as "toUniqueConstraints", changes, conversions, checksum, created_at as "createdAt", applied_at as "appliedAt"
          from framekit_migrations where tenant_id = ${tenant.tenantId} and app_name = ${plan.appName} order by applied_at desc, id desc limit 1
        `;
        assertMigrationDrift(latestRows[0] ? migrationSqlRowToRecord(latestRows[0]) : undefined, plan);
        await assertLegacyUniqueValues(sql, tenant.tenantId, plan.toUniqueConstraints);
        const statements = executableStatements(createPostgresMigrationStatements(plan));
        for (const [statementIndex, statement] of statements.entries()) {
          await sql.unsafe(statement);
          await this.faultInjector?.("statement", plan, statementIndex);
        }
        await resynchronizeUniqueValues(sql, tenant.tenantId, plan.fromUniqueConstraints, plan.toUniqueConstraints);
        await this.faultInjector?.("backfill", plan);
        await this.faultInjector?.("record", plan);
        const record: MigrationRecord = { ...plan, appliedAt: options.appliedAt ?? new Date().toISOString() };
        await insertAppliedMigration(sql, record);
        await markOnlineRunCompleted(sql, tenant.tenantId, plan.appName, plan.id);
        return record;
      });
    } catch (error) {
      if (!(error instanceof FramekitError && error.code === "MIGRATION_LOCK_TIMEOUT")) {
        await this.withOnlineLock(tenant, plan, options.lockTimeoutMs ?? 5_000, async (sql) => {
          const applied = await selectAppliedMigration(sql, tenant.tenantId, plan.appName, plan.id);
          if (applied) return;
          await sql`update framekit_migration_runs set status = 'failed', error = ${errorMessage(error)}, updated_at = now()
            where tenant_id = ${tenant.tenantId} and app_name = ${plan.appName} and migration_id = ${plan.id}
              and plan_digest = ${plan.checksum} and conversion_digest = ${conversionDigest}
              and attempt_id = ${attemptId} and status <> 'completed'`;
        });
      }
      throw error;
    }
  }

  private async transformOnlineChunk(
    sql: postgres.TransactionSql,
    tenant: TenantContext,
    plan: MigrationPlan,
    conversions: MigrationConversion[],
    registry: ReadonlyMap<string, Readonly<MigrationConversionArtifact>>,
    conversionDigest: string,
    chunkSize: number,
    attemptId: string
  ): Promise<boolean> {
    const run = await selectOnlineRun(sql, tenant.tenantId, plan.appName, plan.id);
    if (!run) throw new FramekitError("MIGRATION_RUN_MISSING", "Online migration run state is missing.", 409);
    assertOnlineRunMatches(run, plan, conversionDigest);
    if (run.approval.outcome === "rejected") throw new FramekitError("MIGRATION_APPROVAL_REJECTED", "Rejected online migration evidence is terminal.", 409);
    if (run.status === "completed" || run.checkpoint.conversionIndex >= conversions.length) return true;
    await sql`update framekit_migration_runs set attempt_id = ${attemptId}, status = 'running', updated_at = now()
      where tenant_id = ${tenant.tenantId} and app_name = ${plan.appName} and migration_id = ${plan.id} and status <> 'completed'`;
    const conversion = conversions[run.checkpoint.conversionIndex]!;
    const artifact = registry.get(onlineConversionIdentity(conversion.id, conversion.version))!;
    const rows = await sql<{ id: string; data: Record<string, unknown> }[]>`
      select id, data from framekit_documents
      where tenant_id = ${tenant.tenantId} and doctype = ${conversion.doctype}
        and id > ${run.checkpoint.lastDocumentId ?? ""}
      order by id asc limit ${chunkSize}
      for update
    `;
    for (const row of rows) {
      const first = await artifact.convert(structuredClone(row.data[conversion.field]), structuredClone(row.data), immutableOnlineParameters(conversion.parameters));
      const second = await artifact.convert(structuredClone(row.data[conversion.field]), structuredClone(row.data), immutableOnlineParameters(conversion.parameters));
      assertOnlineConversionValue(conversion, first, row.id);
      assertOnlineConversionValue(conversion, second, row.id);
      if (stableOnlineJson(first) !== stableOnlineJson(second)) {
        throw new FramekitError("NONDETERMINISTIC_MIGRATION_CONVERSION", `Conversion ${conversion.id}@${conversion.version} returned different results for document ${row.id}.`, 422);
      }
      const data = { ...row.data, [conversion.field]: first };
      await sql`
        update framekit_documents set data = ${JSON.stringify(data)}::jsonb, revision = revision + 1, updated_at = now()
        where tenant_id = ${tenant.tenantId} and doctype = ${conversion.doctype} and id = ${row.id}
      `;
    }
    await this.faultInjector?.("online_chunk", plan, run.checkpoint.conversionIndex);
    const finishedConversion = rows.length < chunkSize;
    const nextCheckpoint = {
      conversionIndex: finishedConversion ? run.checkpoint.conversionIndex + 1 : run.checkpoint.conversionIndex,
      ...(finishedConversion || rows.length === 0 ? {} : { lastDocumentId: rows.at(-1)!.id }),
      processed: run.checkpoint.processed + rows.length
    };
    const updated = await sql<{ migrationId: string }[]>`
      update framekit_migration_runs set status = 'running', checkpoint = ${JSON.stringify(nextCheckpoint)}::jsonb,
        error = null, updated_at = now()
      where tenant_id = ${tenant.tenantId} and app_name = ${plan.appName} and migration_id = ${plan.id}
        and attempt_id = ${attemptId} and checkpoint = ${JSON.stringify(run.checkpoint)}::jsonb and status <> 'completed'
      returning migration_id as "migrationId"
    `;
    if (!updated[0]) throw new FramekitError("MIGRATION_ATTEMPT_SUPERSEDED", "Online migration checkpoint ownership changed; retry the run.", 409);
    return nextCheckpoint.conversionIndex >= conversions.length;
  }

  private async withOnlineLock<T>(
    tenant: TenantContext,
    plan: MigrationPlan,
    timeoutMs: number,
    callback: (sql: postgres.TransactionSql) => Promise<T>
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const result = await this.sql.begin(async (sql) => {
        const locked = await sql<{ locked: boolean }[]>`
          select pg_try_advisory_xact_lock(hashtextextended(${`framekit:migration:${tenant.tenantId}:${plan.appName}`}, 0)) as locked
        `;
        if (!locked[0]?.locked) return { locked: false as const };
        await sql`select set_config('lock_timeout', ${`${timeoutMs}ms`}, true)`;
        return { locked: true as const, value: await callback(sql) };
      });
      if (result.locked) return result.value;
      if (Date.now() >= deadline) throw new FramekitError("MIGRATION_LOCK_TIMEOUT", "Timed out waiting for the tenant/app migration lock.", 409);
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
    }
  }

  async rollback(tenant: TenantContext, migration: MigrationRecord, options: { allowDestructive?: boolean; id?: string; appliedAt?: string } = {}): Promise<MigrationRecord> {
    const plan = await createRollbackMigrationPlan(migration, {
      id: options.id,
      createdAt: options.appliedAt ?? new Date().toISOString()
    });
    return this.applyPlan(tenant, plan, options);
  }
}

type MigrationSqlRow = {
  tenantId: string;
  id: string;
  appName: string;
  fromSchemaChecksum: string;
  toSchemaChecksum: string;
  fromUniqueConstraints: MigrationRecord["fromUniqueConstraints"];
  toUniqueConstraints: MigrationRecord["toUniqueConstraints"];
  changes: MigrationRecord["changes"];
  conversions: MigrationConversion[];
  checksum: string;
  createdAt: Date | string;
  appliedAt: Date | string;
};

type OnlineMigrationRunSqlRow = Omit<OnlineMigrationRun, "startedAt" | "updatedAt" | "completedAt" | "error" | "attemptId"> & {
  attemptId: string | null;
  error: string | null;
  startedAt: Date | string;
  updatedAt: Date | string;
  completedAt: Date | string | null;
};

function onlineMigrationSqlRowToRun(row: OnlineMigrationRunSqlRow): OnlineMigrationRun {
  const { completedAt, error, attemptId, ...rest } = row;
  return {
    ...rest,
    startedAt: isoTimestamp(row.startedAt),
    updatedAt: isoTimestamp(row.updatedAt),
    ...(attemptId ? { attemptId } : {}),
    ...(error ? { error } : {}),
    ...(completedAt ? { completedAt: isoTimestamp(completedAt) } : {})
  };
}

function isoTimestamp(value: Date | string): string {
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

function validateOnlineConversions(
  plan: MigrationPlan,
  registry: ReadonlyMap<string, Readonly<MigrationConversionArtifact>>
): MigrationConversion[] {
  const conversions = plan.conversions ?? [];
  const typeChanges = plan.changes.filter((change) => change.kind === "change_field_type");
  if (conversions.length !== typeChanges.length) {
    throw new FramekitError("MISSING_MIGRATION_CONVERSION", "Every field type change requires exactly one versioned conversion.", 422);
  }
  const conversionIdentities = new Set<string>();
  for (const conversion of conversions) {
    const identity = `${conversion.id}@${conversion.version}`;
    if (conversionIdentities.has(identity)) throw new FramekitError("DUPLICATE_MIGRATION_CONVERSION", `Conversion descriptor ${identity} is registered more than once.`, 422);
    conversionIdentities.add(identity);
  }
  for (const conversion of conversions) {
    const artifact = registry.get(onlineConversionIdentity(conversion.id, conversion.version));
    if (!artifact) throw new FramekitError("MISSING_MIGRATION_CONVERSION", `Conversion artifact ${conversion.id}@${conversion.version} is not registered.`, 422);
    if (artifact.artifactDigest !== conversion.artifactDigest) {
      throw new FramekitError("MIGRATION_CONVERSION_DRIFT", `Conversion artifact ${conversion.id}@${conversion.version} does not match the reviewed artifact digest.`, 409);
    }
  }
  return conversions;
}

export async function migrationConversionArtifactDigest(artifact: string | Uint8Array): Promise<string> {
  const bytes = typeof artifact === "string" ? new TextEncoder().encode(artifact) : Uint8Array.from(artifact);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `sha256:${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

function createOnlineConversionRegistry(
  artifacts: readonly MigrationConversionArtifact[]
): ReadonlyMap<string, Readonly<MigrationConversionArtifact>> {
  const registry = new Map<string, Readonly<MigrationConversionArtifact>>();
  for (const artifact of artifacts) {
    const identity = onlineConversionIdentity(artifact.id, artifact.version);
    if (registry.has(identity)) throw new FramekitError("DUPLICATE_MIGRATION_CONVERSION", `Conversion artifact ${identity} is registered more than once.`, 422);
    if (!artifact.id || !Number.isSafeInteger(artifact.version) || artifact.version < 1 || !/^sha256:[A-Za-z0-9_-]{43}$/.test(artifact.artifactDigest)) {
      throw new FramekitError("INVALID_MIGRATION_CONVERSION", `Conversion artifact ${identity} requires a positive version and SHA-256 artifact digest.`, 422);
    }
    const source = Function.prototype.toString.call(artifact.convert);
    if (source.includes("[native code]")) throw new FramekitError("INVALID_MIGRATION_CONVERSION", `Conversion artifact ${identity} cannot use a native or bound function.`, 422);
    registry.set(identity, Object.freeze({ ...artifact }));
  }
  return registry;
}

function onlineConversionIdentity(id: string, version: number): string {
  return `${id}@${version}`;
}

function validateOnlineOptions(plan: MigrationPlan, options: OnlineMigrationOptions): void {
  if (!options.approval.approver || !options.approval.approvedAt || !Number.isFinite(Date.parse(options.approval.approvedAt))) {
    throw new FramekitError("INVALID_MIGRATION_APPROVAL", "Online migration approval requires an approver and valid timestamp.", 422);
  }
  if (options.approval.planDigest !== plan.checksum) {
    throw new FramekitError("MIGRATION_APPROVAL_DRIFT", "Approval digest does not match the migration plan.", 409);
  }
  if (options.chunkSize !== undefined && (!Number.isSafeInteger(options.chunkSize) || options.chunkSize < 1 || options.chunkSize > 10_000)) {
    throw new FramekitError("INVALID_MIGRATION_CHUNK_SIZE", "Online migration chunk size must be between 1 and 10000.", 422);
  }
  if (options.lockTimeoutMs !== undefined && (!Number.isSafeInteger(options.lockTimeoutMs) || options.lockTimeoutMs < 1 || options.lockTimeoutMs > 300_000)) {
    throw new FramekitError("INVALID_MIGRATION_LOCK_TIMEOUT", "Online migration lock timeout must be between 1 and 300000 milliseconds.", 422);
  }
  if (options.maxRetries !== undefined && (!Number.isSafeInteger(options.maxRetries) || options.maxRetries < 0 || options.maxRetries > 20)) {
    throw new FramekitError("INVALID_MIGRATION_RETRIES", "Online migration retries must be between 0 and 20.", 422);
  }
}

async function onlineConversionDigest(conversions: MigrationConversion[]): Promise<string> {
  const bytes = new TextEncoder().encode(stableOnlineJson(conversions));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function stableOnlineJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableOnlineJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableOnlineJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertJsonSafeOnlineValue(value: unknown, path = "value", ancestors = new WeakSet<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new FramekitError("INVALID_MIGRATION_CONVERSION_VALUE", `${path} must be a finite JSON number.`, 422);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new FramekitError("INVALID_MIGRATION_CONVERSION_VALUE", `${path} must not contain circular references.`, 422);
    ancestors.add(value);
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) {
      throw new FramekitError("INVALID_MIGRATION_CONVERSION_VALUE", `${path} must be a plain JSON array.`, 422);
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new FramekitError("INVALID_MIGRATION_CONVERSION_VALUE", `${path} must be a dense plain-data JSON array.`, 422);
      assertJsonSafeOnlineValue(descriptor.value, `${path}[${index}]`, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  if (value && typeof value === "object") {
    if (ancestors.has(value)) throw new FramekitError("INVALID_MIGRATION_CONVERSION_VALUE", `${path} must not contain circular references.`, 422);
    ancestors.add(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new FramekitError("INVALID_MIGRATION_CONVERSION_VALUE", `${path} must be a plain JSON object.`, 422);
    if (Object.getOwnPropertySymbols(value).length > 0) throw new FramekitError("INVALID_MIGRATION_CONVERSION_VALUE", `${path} must not contain symbol properties.`, 422);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable || !("value" in descriptor)) throw new FramekitError("INVALID_MIGRATION_CONVERSION_VALUE", `${path}.${key} must be enumerable plain data.`, 422);
      assertJsonSafeOnlineValue(descriptor.value, `${path}.${key}`, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  throw new FramekitError("INVALID_MIGRATION_CONVERSION_VALUE", `${path} is not JSON-safe.`, 422);
}

function immutableOnlineParameters(parameters: MigrationConversion["parameters"]): MigrationConversion["parameters"] {
  const cloned = structuredClone(parameters);
  const freeze = (value: MigrationConversion["parameters"]): MigrationConversion["parameters"] => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const item of Array.isArray(value) ? value : Object.values(value)) freeze(item);
    return Object.freeze(value) as MigrationConversion["parameters"];
  };
  return freeze(cloned);
}

function assertOnlineConversionValue(conversion: MigrationConversion, value: unknown, documentId: string): void {
  assertJsonSafeOnlineValue(value, `${conversion.id}@${conversion.version} document ${documentId}`);
  let compatible = value === null;
  const exact = /^(decimal|currency)\(([1-9][0-9]*),([0-9]+)\)(?::computed:.*)?$/.exec(conversion.toType);
  if (exact && value !== null) {
    compatible = typeof value === "string" && isCanonicalExactConversionValue(value, Number(exact[2]), Number(exact[3]));
  } else switch (conversion.toType) {
    case "number":
      compatible ||= typeof value === "number" && Number.isFinite(value);
      break;
    case "boolean":
      compatible ||= typeof value === "boolean";
      break;
    case "json":
      compatible ||= value !== undefined;
      break;
    default:
      compatible ||= typeof value === "string";
  }
  if (!compatible) {
    throw new FramekitError(
      "INVALID_MIGRATION_CONVERSION_VALUE",
      `Conversion ${conversion.id}@${conversion.version} produced an incompatible ${conversion.toType} value for document ${documentId}.`,
      422
    );
  }
}

function isCanonicalExactConversionValue(value: string, precision: number, scale: number): boolean {
  if (!Number.isSafeInteger(precision) || !Number.isSafeInteger(scale) || precision < 1 || scale < 0 || scale > precision) return false;
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match) return false;
  const fraction = match[3] ?? "";
  if (fraction.length !== scale) return false;
  const integerDigits = match[2] === "0" ? 0 : match[2]!.length;
  if (integerDigits + scale > precision) return false;
  return !(match[1] === "-" && match[2] === "0" && [...fraction].every((digit) => digit === "0"));
}

async function retryOnlineChunk<T>(maxRetries: number, operation: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableMigrationError(error)) throw error;
      attempt += 1;
    }
  }
}

function isRetryableMigrationError(error: unknown): boolean {
  if (error instanceof FramekitError) return error.code === "MIGRATION_LOCK_TIMEOUT";
  const code = (error as { code?: unknown } | null)?.code;
  return code === "40001" || code === "40P01" || code === "55P03" || code === "57P01" || code === "08006";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertOnlineRunMatches(run: OnlineMigrationRun, plan: MigrationPlan, conversionDigest: string): void {
  if (run.planDigest !== plan.checksum) {
    throw new FramekitError("MIGRATION_PLAN_DRIFT", "Migration plan changed after the online run started.", 409);
  }
  if (run.conversionDigest !== conversionDigest) {
    throw new FramekitError("MIGRATION_CONVERSION_DRIFT", "Migration conversion metadata changed after the online run started.", 409);
  }
}

async function selectOnlineRun(
  sql: postgres.TransactionSql,
  tenantId: string,
  appName: string,
  migrationId: string
): Promise<OnlineMigrationRun | undefined> {
  const rows = await sql<OnlineMigrationRunSqlRow[]>`
    select tenant_id as "tenantId", app_name as "appName", migration_id as "migrationId",
           plan_digest as "planDigest", conversion_digest as "conversionDigest", status, checkpoint,
           approval, attempt_id as "attemptId", error, started_at as "startedAt", updated_at as "updatedAt", completed_at as "completedAt"
    from framekit_migration_runs
    where tenant_id = ${tenantId} and app_name = ${appName} and migration_id = ${migrationId}
    limit 1
  `;
  return rows[0] ? onlineMigrationSqlRowToRun(rows[0]) : undefined;
}

async function selectAppliedMigration(sql: postgres.TransactionSql, tenantId: string, appName: string, migrationId: string): Promise<MigrationRecord | undefined> {
  const rows = await sql<MigrationSqlRow[]>`
    select tenant_id as "tenantId", id, app_name as "appName", from_schema_checksum as "fromSchemaChecksum",
           to_schema_checksum as "toSchemaChecksum", from_unique_constraints as "fromUniqueConstraints",
           to_unique_constraints as "toUniqueConstraints", changes, conversions, checksum, created_at as "createdAt", applied_at as "appliedAt"
    from framekit_migrations where tenant_id = ${tenantId} and app_name = ${appName} and id = ${migrationId} limit 1
  `;
  return rows[0] ? migrationSqlRowToRecord(rows[0]) : undefined;
}

async function insertAppliedMigration(sql: postgres.TransactionSql, record: MigrationRecord): Promise<void> {
  await sql`
    insert into framekit_migrations (
      tenant_id, id, app_name, from_schema_checksum, to_schema_checksum, from_unique_constraints,
      to_unique_constraints, changes, conversions, checksum, created_at, applied_at
    ) values (
      ${record.tenantId}, ${record.id}, ${record.appName}, ${record.fromSchemaChecksum}, ${record.toSchemaChecksum},
      ${JSON.stringify(record.fromUniqueConstraints)}::jsonb, ${JSON.stringify(record.toUniqueConstraints)}::jsonb,
      ${JSON.stringify(record.changes)}::jsonb, ${JSON.stringify(record.conversions ?? [])}::jsonb,
      ${record.checksum}, ${record.createdAt}::timestamptz, ${record.appliedAt}::timestamptz
    )
  `;
}

async function markOnlineRunCompleted(sql: postgres.TransactionSql, tenantId: string, appName: string, migrationId: string): Promise<void> {
  await sql`
    update framekit_migration_runs set status = 'completed', attempt_id = null, error = null, updated_at = now(), completed_at = now()
    where tenant_id = ${tenantId} and app_name = ${appName} and migration_id = ${migrationId} and status <> 'completed'
  `;
}

function migrationSqlRowToRecord(row: MigrationSqlRow): MigrationRecord {
  const { conversions, ...rest } = row;
  return {
    ...rest,
    ...(conversions.length > 0 ? { conversions } : {}),
    createdAt: typeof row.createdAt === "string" ? new Date(row.createdAt).toISOString() : row.createdAt.toISOString(),
    appliedAt: typeof row.appliedAt === "string" ? new Date(row.appliedAt).toISOString() : row.appliedAt.toISOString()
  };
}

async function assertLegacyUniqueValues(
  sql: postgres.TransactionSql,
  tenantId: string,
  constraints: Array<{ doctype: string; field: string }>
): Promise<void> {
  for (const constraint of constraints) {
    const duplicates = await sql<{ value: string; documentIds: string[] }[]>`
      select value, array_agg(id order by id) as "documentIds"
      from (
        select id, data ->> ${constraint.field} as value
        from framekit_documents
        where tenant_id = ${tenantId} and doctype = ${constraint.doctype}
          and data ? ${constraint.field} and data -> ${constraint.field} <> 'null'::jsonb
          and data ->> ${constraint.field} <> ''
      ) legacy_values
      group by value
      having count(*) > 1
      limit 1
    `;
    if (duplicates[0]) {
      throw new FramekitError("LEGACY_UNIQUE_CONFLICT", `Legacy rows conflict on ${constraint.doctype}.${constraint.field}.`, 409, {
        ...constraint,
        value: duplicates[0].value,
        documentIds: duplicates[0].documentIds
      });
    }
  }
}

async function resynchronizeUniqueValues(
  sql: postgres.TransactionSql,
  tenantId: string,
  fromConstraints: Array<{ doctype: string; field: string }>,
  toConstraints: Array<{ doctype: string; field: string }>
): Promise<void> {
  const affected = new Map([...fromConstraints, ...toConstraints].map((constraint) => [`${constraint.doctype}.${constraint.field}`, constraint]));
  for (const constraint of affected.values()) {
    await sql`
      delete from framekit_document_unique_values
      where tenant_id = ${tenantId} and doctype = ${constraint.doctype} and field = ${constraint.field}
    `;
  }
  for (const constraint of toConstraints) {
    const indexName = indexIdentifier({ doctype: constraint.doctype, field: constraint.field }, "uniq");
    const definitions = await sql<{ definition: string }[]>`select pg_get_indexdef(to_regclass(${indexName})) as definition`;
    if (definitions[0]?.definition && !definitions[0].definition.includes("<> ''::text")) {
      await sql.unsafe(`drop index ${indexName}`);
    }
    await sql.unsafe(
      `create unique index if not exists ${indexName} on framekit_documents (tenant_id, doctype, (data ->> ${sqlLiteral(constraint.field)})) ` +
      `where doctype = ${sqlLiteral(constraint.doctype)} and data ? ${sqlLiteral(constraint.field)} and data ->> ${sqlLiteral(constraint.field)} <> '';`
    );
    const indexRows = await sql<{ indexName: string | null }[]>`select to_regclass(${indexName})::text as "indexName"`;
    if (!indexRows[0]?.indexName) {
      throw new FramekitError("MIGRATION_SCHEMA_DRIFT", `Expected unique index "${indexName}" is missing.`, 409, constraint);
    }
    await sql`
      insert into framekit_document_unique_values (tenant_id, doctype, field, value, document_id)
      select tenant_id, doctype, ${constraint.field}, data ->> ${constraint.field}, id
      from framekit_documents
      where tenant_id = ${tenantId} and doctype = ${constraint.doctype}
        and data ? ${constraint.field} and data -> ${constraint.field} <> 'null'::jsonb
        and data ->> ${constraint.field} <> ''
    `;
  }
}

function rowToMigration(row: typeof framekitMigrations.$inferSelect): MigrationRecord {
  return {
    tenantId: row.tenantId,
    id: row.id,
    appName: row.appName,
    fromSchemaChecksum: row.fromSchemaChecksum,
    toSchemaChecksum: row.toSchemaChecksum,
    fromUniqueConstraints: row.fromUniqueConstraints,
    toUniqueConstraints: row.toUniqueConstraints,
    changes: row.changes,
    ...(row.conversions.length > 0 ? { conversions: row.conversions } : {}),
    checksum: row.checksum,
    createdAt: row.createdAt.toISOString(),
    appliedAt: row.appliedAt.toISOString()
  };
}

function rowToAuditEvent(row: typeof framekitAuditEvents.$inferSelect): AuditEvent {
  return {
    tenantId: row.tenantId,
    id: row.id,
    userId: row.userId,
    action: row.action,
    doctype: row.doctype,
    documentId: row.documentId,
    createdAt: row.createdAt.toISOString()
  };
}

function rowToOutboxEvent(row: typeof framekitOutboxEvents.$inferSelect): OutboxEvent {
  return {
    tenantId: row.tenantId,
    id: row.id,
    type: row.type,
    topic: row.topic,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt?.toISOString(),
    error: row.error ?? undefined,
    leaseOwner: row.leaseOwner ?? undefined,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString(),
    nextAttemptAt: row.nextAttemptAt?.toISOString()
  };
}

type OutboxSqlRow = {
  tenant_id: string;
  id: string;
  type: string;
  topic: string;
  payload: Record<string, unknown>;
  status: OutboxEvent["status"];
  attempts: number;
  created_at: Date | string;
  processed_at: Date | string | null;
  error: string | null;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  next_attempt_at: Date | string | null;
};

function outboxSqlRowToEvent(row: OutboxSqlRow): OutboxEvent {
  const iso = (value: Date | string | null): string | undefined => value === null ? undefined : new Date(value).toISOString();
  return {
    tenantId: row.tenant_id,
    id: row.id,
    type: row.type,
    topic: row.topic,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    createdAt: iso(row.created_at)!,
    processedAt: iso(row.processed_at),
    error: row.error ?? undefined,
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: iso(row.lease_expires_at),
    nextAttemptAt: iso(row.next_attempt_at)
  };
}

function realtimeSqlRowToEvent(row: RealtimeSqlRow): RuntimeRealtimeEvent {
  return {
    cursor: row.cursor,
    channel: row.channel,
    type: row.type,
    payload: row.payload,
    createdAt: new Date(row.created_at).toISOString()
  };
}

function rowToCustomField(row: typeof framekitCustomFields.$inferSelect): CustomFieldDefinition {
  return {
    tenantId: row.tenantId,
    id: row.id,
    doctype: row.doctype,
    field: row.field
  };
}

function rowToView(row: typeof framekitViews.$inferSelect): ViewDefinition {
  return {
    tenantId: row.tenantId,
    id: row.id,
    doctype: row.doctype,
    type: row.type,
    fields: row.fields
  };
}

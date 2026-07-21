import { and, asc, desc, eq, gt, gte, lt, lte, ne, or, sql as drizzleSql, type SQL } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import type {
  ApiTokenRecord, ApiTokenStore, AuthAuditEvent, AuthAuditSink, AuthIdentityLink, AuthIdentityLinkStore,
  AuthLifecycleToken, AuthLifecycleTokenKind, AuthLifecycleTokenStore, AuthRole, AuthUser,
  OidcAuthorizationState, OidcAuthorizationStateStore, RoleStore, SessionRevocationStore, UserStore
} from "@framekit/auth";
import type { CustomFieldDefinition, DocTypeDefinition, DocumentRecord, TenantContext, ViewDefinition } from "@framekit/core";
import { canTransferOwnership, FramekitError, rowPolicyScope } from "@framekit/core";
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
  type MigrationPlan,
  type MigrationRecord,
  type MigrationRollback,
  type MigrationStore,
  type MutationCommand,
  type MutationUnitOfWork,
  type NamingSeriesStore,
  type OutboxEvent,
  type OutboxClaimOptions,
  type OutboxStore,
  type RepositoryDiagnostics,
  type RealtimePublisher,
  type RuntimeRealtimeEvent,
  assertDestructiveMigration,
  assertMigrationDrift,
  assertMigrationIdentity,
  assertSupportedMigration,
  createRollbackMigrationPlan,
  validateMigrationPlan
} from "@framekit/runtime";

export const framekitDocuments = pgTable(
  "framekit_documents",
  {
    tenantId: text("tenant_id").notNull(),
    doctype: text("doctype").notNull(),
    id: text("id").notNull(),
    revision: integer("revision").notNull().default(1),
    documentStatus: text("document_status").notNull().default("draft").$type<DocumentRecord["documentStatus"]>(),
    ownerId: text("owner_id"),
    state: text("state"),
    data: jsonb("data").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [uniqueIndex("framekit_documents_identity").on(table.tenantId, table.doctype, table.id)]
);

export const framekitUsers = pgTable(
  "framekit_users",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    roles: jsonb("roles").notNull().$type<string[]>(),
    permissions: jsonb("permissions").notNull().$type<string[]>(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex("framekit_users_identity").on(table.tenantId, table.id),
    uniqueIndex("framekit_users_email").on(table.tenantId, table.email)
  ]
);

export const framekitRoles = pgTable(
  "framekit_roles",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    permissions: jsonb("permissions").notNull().$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [uniqueIndex("framekit_roles_identity").on(table.tenantId, table.id)]
);

export const framekitApiTokens = pgTable(
  "framekit_api_tokens",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id"),
    roles: jsonb("roles").notNull().$type<string[]>(),
    permissions: jsonb("permissions").notNull().$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("framekit_api_tokens_identity").on(table.tenantId, table.id),
    uniqueIndex("framekit_api_tokens_hash").on(table.tokenHash)
  ]
);

export const framekitSessionRevocations = pgTable("framekit_session_revocations", {
  sessionId: text("session_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull()
});

export const framekitAuthIdentityLinks = pgTable("framekit_auth_identity_links", {
  tenantId: text("tenant_id").notNull(), providerId: text("provider_id").notNull(), subject: text("subject").notNull(),
  userId: text("user_id").notNull(), email: text("email"), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("framekit_auth_identity_links_subject").on(table.tenantId, table.providerId, table.subject)]);

export const framekitAuthLifecycleTokens = pgTable("framekit_auth_lifecycle_tokens", {
  id: text("id").notNull(), tenantId: text("tenant_id").notNull(), kind: text("kind").notNull().$type<AuthLifecycleTokenKind>(),
  tokenHash: text("token_hash").notNull(), email: text("email"), userId: text("user_id"), name: text("name"),
  roles: jsonb("roles").$type<string[]>(), permissions: jsonb("permissions").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true })
}, (table) => [uniqueIndex("framekit_auth_lifecycle_tokens_hash").on(table.tokenHash)]);

export const framekitOidcAuthorizationStates = pgTable("framekit_oidc_authorization_states", {
  id: text("id").notNull(), providerId: text("provider_id").notNull(), tenantId: text("tenant_id").notNull(),
  stateHash: text("state_hash").notNull(), nonceHash: text("nonce_hash").notNull(), encryptedCodeVerifier: text("encrypted_code_verifier").notNull(),
  returnTo: text("return_to").notNull(), redirectUri: text("redirect_uri").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true })
}, (table) => [uniqueIndex("framekit_oidc_authorization_states_hash").on(table.providerId, table.stateHash)]);

export const framekitAuthAuditEvents = pgTable("framekit_auth_audit_events", {
  id: text("id").notNull(), tenantId: text("tenant_id").notNull(), actorUserId: text("actor_user_id"), targetUserId: text("target_user_id"),
  action: text("action").notNull(), success: integer("success").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  details: jsonb("details").$type<Record<string, unknown>>()
}, (table) => [uniqueIndex("framekit_auth_audit_events_identity").on(table.tenantId, table.id)]);

export const framekitAuditEvents = pgTable("framekit_audit_events", {
  tenantId: text("tenant_id").notNull(),
  id: text("id").notNull(),
  userId: text("user_id").notNull(),
  action: text("action").notNull(),
  doctype: text("doctype").notNull(),
  documentId: text("document_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const framekitOutboxEvents = pgTable("framekit_outbox_events", {
  tenantId: text("tenant_id").notNull(),
  id: text("id").notNull(),
  type: text("type").notNull(),
  topic: text("topic").notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  status: text("status").notNull().$type<OutboxEvent["status"]>(),
  attempts: integer("attempts").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
});

export const framekitDocumentUniqueValues = pgTable(
  "framekit_document_unique_values",
  {
    tenantId: text("tenant_id").notNull(),
    doctype: text("doctype").notNull(),
    field: text("field").notNull(),
    value: text("value").notNull(),
    documentId: text("document_id").notNull()
  },
  (table) => [
    uniqueIndex("framekit_document_unique_value").on(table.tenantId, table.doctype, table.field, table.value),
    uniqueIndex("framekit_document_unique_field").on(table.tenantId, table.doctype, table.documentId, table.field)
  ]
);

export const framekitIdempotencyKeys = pgTable(
  "framekit_idempotency_keys",
  {
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    result: jsonb("result").$type<DocumentRecord | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull()
  },
  (table) => [uniqueIndex("framekit_idempotency_identity").on(table.tenantId, table.key)]
);

export const framekitCustomFields = pgTable("framekit_custom_fields", {
  tenantId: text("tenant_id").notNull(),
  id: text("id").notNull(),
  doctype: text("doctype").notNull(),
  field: jsonb("field").notNull().$type<CustomFieldDefinition["field"]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const framekitViews = pgTable("framekit_views", {
  tenantId: text("tenant_id").notNull(),
  id: text("id").notNull(),
  doctype: text("doctype").notNull(),
  type: text("type").notNull().$type<ViewDefinition["type"]>(),
  fields: jsonb("fields").notNull().$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const framekitNamingSeries = pgTable(
  "framekit_naming_series",
  {
    tenantId: text("tenant_id").notNull(),
    prefix: text("prefix").notNull(),
    currentValue: integer("current_value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [uniqueIndex("framekit_naming_series_identity").on(table.tenantId, table.prefix)]
);

export const framekitMigrations = pgTable(
  "framekit_migrations",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    appName: text("app_name").notNull(),
    fromSchemaChecksum: text("from_schema_checksum").notNull().default(""),
    toSchemaChecksum: text("to_schema_checksum").notNull().default(""),
    fromUniqueConstraints: jsonb("from_unique_constraints").notNull().$type<MigrationRecord["fromUniqueConstraints"]>().default([]),
    toUniqueConstraints: jsonb("to_unique_constraints").notNull().$type<MigrationRecord["toUniqueConstraints"]>().default([]),
    changes: jsonb("changes").notNull().$type<MigrationRecord["changes"]>(),
    checksum: text("checksum").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull()
  },
  (table) => [uniqueIndex("framekit_migrations_identity").on(table.tenantId, table.appName, table.id)]
);

export type PostgresRepositoryOptions = {
  connectionString: string;
  max?: number;
  onQuery?: (query: { sql: string; params: unknown[] }) => void;
};

export type PostgresMutationStage = "document" | "hooks" | "audit" | "outbox" | "idempotency";

export type PostgresMutationUnitOfWorkOptions = PostgresRepositoryOptions & {
  faultInjector?: (stage: PostgresMutationStage, command: MutationCommand) => void | Promise<void>;
};

export type PostgresMigrationStage = "statement" | "backfill" | "record";

export type PostgresMigrationStoreOptions = PostgresRepositoryOptions & {
  faultInjector?: (stage: PostgresMigrationStage, plan: MigrationPlan, statementIndex?: number) => void | Promise<void>;
};

export type PostgresRealtimeStage = "locked" | "inserted";

export type PostgresRealtimePublisherOptions = PostgresRepositoryOptions & {
  faultInjector?: (stage: PostgresRealtimeStage, event: RuntimeRealtimeEvent) => void | Promise<void>;
};

export class PostgresDocumentRepository implements DocumentRepository {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;
  private readonly onQuery?: PostgresRepositoryOptions["onQuery"];

  constructor(options: PostgresRepositoryOptions) {
    this.sql = postgres(options.connectionString, { max: options.max ?? 5 });
    this.db = drizzle(this.sql);
    this.onQuery = options.onQuery;
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.db.execute(drizzleSql`select 1`); }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await this.db.execute(drizzleSql.raw(createDocumentTableSql()));
  }

  describe(): RepositoryDiagnostics {
    return {
      kind: "postgres",
      durable: true,
      features: ["crud", "jsonb", "migration", "search"]
    };
  }

  async list(tenant: TenantContext, doctype: DocTypeDefinition, options: ListOptions = {}): Promise<DocumentRecord[]> {
    return (await this.listPage(tenant, doctype, options)).items;
  }

  async listPage(tenant: TenantContext, doctype: DocTypeDefinition, options: ListOptions = {}): Promise<DocumentPage> {
    validateListOptions(doctype, options);
    const sort = normalizedDocumentSort(options.sort);
    const sortField = doctype.fields.find((field) => field.name === sort.field);
    const sortExpression = documentSortExpression(sort.field, sortField?.type);
    const idExpression = drizzleSql<string>`${framekitDocuments.id} collate "C"`;
    const conditions: SQL[] = [
      eq(framekitDocuments.tenantId, tenant.tenantId),
      eq(framekitDocuments.doctype, doctype.name),
      compileRowPolicy(tenant, doctype, "read"),
      ...compileDocumentFilters(doctype, options.filters)
    ];
    if (options.search) {
      const pattern = containsPattern(options.search.toLowerCase());
      const searchableFields = doctype.fields.filter((field) => field.type !== "json");
      conditions.push(searchableFields.length === 0
        ? drizzleSql`false`
        : or(...searchableFields.map((field) => drizzleSql`
            lower(coalesce(${framekitDocuments.data} ->> ${field.name}, '')) like ${pattern} escape '\\'
          `))!);
    }
    if (options.cursor) {
      const cursor = decodeDocumentCursor(options.cursor, sort, doctype);
      const primary = sort.direction === "asc" ? gt(sortExpression, cursor.value) : lt(sortExpression, cursor.value);
      conditions.push(or(primary, and(eq(sortExpression, cursor.value), gt(idExpression, cursor.id)))!);
    }
    const dataExpression = documentProjection(options.fields);
    const limit = options.limit ?? 100;
    const query = this.db
      .select({
        tenantId: framekitDocuments.tenantId,
        doctype: framekitDocuments.doctype,
        id: framekitDocuments.id,
        revision: framekitDocuments.revision,
        documentStatus: framekitDocuments.documentStatus,
        ownerId: framekitDocuments.ownerId,
        state: framekitDocuments.state,
        data: dataExpression,
        createdAt: framekitDocuments.createdAt,
        updatedAt: framekitDocuments.updatedAt,
        cursorValue: sortExpression
      })
      .from(framekitDocuments)
      .where(and(...conditions))
      .orderBy(sort.direction === "asc" ? asc(sortExpression) : desc(sortExpression), asc(idExpression))
      .offset(options.offset ?? 0)
      .limit(limit + 1);
    this.onQuery?.(query.toSQL());
    const rows = await query;
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map(({ cursorValue: _cursorValue, ...row }) => selectedRowToRecord(row));
    const lastRow = pageRows.at(-1);
    let nextCursor: string | undefined;
    if (hasMore && lastRow) {
      const last = items.at(-1)!;
      const cursorValue = sortField?.type === "number" || sortField?.type === "currency" ? Number(lastRow.cursorValue) : lastRow.cursorValue;
      nextCursor = encodeDocumentCursor({
        ...last,
        data: sortField ? { ...last.data, [sort.field]: cursorValue } : last.data
      }, sort, doctype);
    }
    return { items, nextCursor };
  }

  async get(tenant: TenantContext, doctype: DocTypeDefinition, id: string, options: { access?: "read" | "write" } = {}): Promise<DocumentRecord | undefined> {
    const conditions = [eq(framekitDocuments.tenantId, tenant.tenantId), eq(framekitDocuments.doctype, doctype.name), eq(framekitDocuments.id, id)];
    conditions.push(compileRowPolicy(tenant, doctype, options.access ?? "read"));
    const rows = await this.db
      .select()
      .from(framekitDocuments)
      .where(and(...conditions))
      .limit(1);
    return rows[0] ? rowToRecord(rows[0]) : undefined;
  }

  async getForOwnerTransfer(tenant: TenantContext, doctype: DocTypeDefinition, id: string): Promise<DocumentRecord | undefined> {
    if (!canTransferOwnership(tenant, doctype)) return undefined;
    const rows = await this.db.select().from(framekitDocuments).where(and(
      eq(framekitDocuments.tenantId, tenant.tenantId), eq(framekitDocuments.doctype, doctype.name), eq(framekitDocuments.id, id)
    )).limit(1);
    return rows[0] ? rowToRecord(rows[0]) : undefined;
  }

  async create(tenant: TenantContext, doctype: DocTypeDefinition, record: DocumentRecord): Promise<DocumentRecord> {
    if ((doctype.ownership && record.ownerId !== tenant.userId) || (!doctype.ownership && record.ownerId !== undefined)) {
      throw new FramekitError("INVALID_OWNER", "Document owner must be assigned by enabled ownership metadata", 403);
    }
    await this.db.insert(framekitDocuments).values({
      tenantId: record.tenantId,
      doctype: record.doctype,
      id: record.id,
      revision: record.revision,
      documentStatus: record.documentStatus,
      ownerId: record.ownerId,
      state: record.state,
      data: record.data,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
    return record;
  }

  async update(tenant: TenantContext, doctype: DocTypeDefinition, record: DocumentRecord, options: { expectedRevision?: number } = {}): Promise<DocumentRecord> {
    const conditions = [eq(framekitDocuments.tenantId, tenant.tenantId), eq(framekitDocuments.doctype, doctype.name), eq(framekitDocuments.id, record.id)];
    conditions.push(compileRowPolicy(tenant, doctype, "write"));
    conditions.push(record.ownerId === undefined ? drizzleSql`${framekitDocuments.ownerId} is null` : eq(framekitDocuments.ownerId, record.ownerId));
    if (options.expectedRevision !== undefined) conditions.push(eq(framekitDocuments.revision, options.expectedRevision));
    const rows = await this.db
      .update(framekitDocuments)
      .set({
        revision: record.revision,
        documentStatus: record.documentStatus,
        ownerId: record.ownerId,
        state: record.state,
        data: record.data,
        updatedAt: new Date(record.updatedAt)
      })
      .where(and(...conditions))
      .returning();
    if (!rows[0]) {
      const current = await this.get(tenant, doctype, record.id, { access: "write" });
      if (current && options.expectedRevision !== undefined) {
        throw postgresRevisionConflict(doctype.name, record.id, options.expectedRevision, current.revision);
      }
      throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${record.id}" does not exist`, 404);
    }
    return rowToRecord(rows[0]);
  }

  async transferOwner(tenant: TenantContext, doctype: DocTypeDefinition, id: string, ownerId: string, options: { expectedRevision: number; updatedAt: string }): Promise<DocumentRecord> {
    if (!canTransferOwnership(tenant, doctype)) throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${id}" does not exist`, 404);
    const rows = await this.db.update(framekitDocuments).set({
      ownerId, revision: options.expectedRevision + 1, updatedAt: new Date(options.updatedAt)
    }).where(and(eq(framekitDocuments.tenantId, tenant.tenantId), eq(framekitDocuments.doctype, doctype.name), eq(framekitDocuments.id, id), eq(framekitDocuments.revision, options.expectedRevision))).returning();
    if (!rows[0]) {
      const current = await this.getForOwnerTransfer(tenant, doctype, id);
      if (current) throw postgresRevisionConflict(doctype.name, id, options.expectedRevision, current.revision);
      throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${id}" does not exist`, 404);
    }
    return rowToRecord(rows[0]);
  }

  async delete(tenant: TenantContext, doctype: DocTypeDefinition, id: string, options: { expectedRevision?: number } = {}): Promise<void> {
    const conditions = [eq(framekitDocuments.tenantId, tenant.tenantId), eq(framekitDocuments.doctype, doctype.name), eq(framekitDocuments.id, id)];
    conditions.push(compileRowPolicy(tenant, doctype, "write"));
    if (options.expectedRevision !== undefined) conditions.push(eq(framekitDocuments.revision, options.expectedRevision));
    const rows = await this.db
      .delete(framekitDocuments)
      .where(and(...conditions))
      .returning({ revision: framekitDocuments.revision });
    if (!rows[0]) {
      const current = await this.get(tenant, doctype, id, { access: "write" });
      if (current && options.expectedRevision !== undefined) {
        throw postgresRevisionConflict(doctype.name, id, options.expectedRevision, current.revision);
      }
      throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${id}" does not exist`, 404);
    }
  }
}

export class PostgresMutationUnitOfWork implements MutationUnitOfWork {
  private readonly sql: Sql;
  private readonly faultInjector?: PostgresMutationUnitOfWorkOptions["faultInjector"];

  constructor(options: PostgresMutationUnitOfWorkOptions) {
    this.sql = postgres(options.connectionString, { max: options.max ?? 5 });
    this.faultInjector = options.faultInjector;
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await this.sql.unsafe(createMutationTablesSql());
  }

  describe(): RepositoryDiagnostics {
    return {
      kind: "postgres",
      durable: true,
      features: ["atomic-mutations", "optimistic-concurrency", "durable-uniqueness", "idempotency"]
    };
  }

  async replay(tenant: TenantContext, idempotencyKey: string, fingerprint: string): Promise<{ found: boolean; result?: DocumentRecord }> {
    const rows = await this.sql<{ fingerprint: string; result: DocumentRecord | null }[]>`
      select fingerprint, result
      from framekit_idempotency_keys
      where tenant_id = ${tenant.tenantId} and key = ${idempotencyKey}
      limit 1
    `;
    if (!rows[0]) return { found: false };
    assertIdempotencyFingerprint(idempotencyKey, fingerprint, rows[0].fingerprint);
    return rows[0].result ? { found: true, result: rows[0].result } : { found: true };
  }

  async execute(command: MutationCommand): Promise<{ document?: DocumentRecord; replayed: boolean }> {
    if (command.operation === "create" && ((command.doctype.ownership && command.document.ownerId !== command.tenant.userId) || (!command.doctype.ownership && command.document.ownerId !== undefined))) {
      throw new FramekitError("INVALID_OWNER", "Document owner must be assigned by enabled ownership metadata", 403);
    }
    try {
      return await this.sql.begin(async (tx) => {
        if (command.idempotencyKey) {
          await tx`select pg_advisory_xact_lock(hashtextextended(${`${command.tenant.tenantId}:${command.idempotencyKey}`}, 0))`;
          const replay = await tx<{ fingerprint: string; result: DocumentRecord | null }[]>`
            select fingerprint, result
            from framekit_idempotency_keys
            where tenant_id = ${command.tenant.tenantId} and key = ${command.idempotencyKey}
            limit 1
          `;
          if (replay[0]) {
            assertIdempotencyFingerprint(command.idempotencyKey, command.idempotencyFingerprint, replay[0].fingerprint);
            return { document: replay[0].result ?? undefined, replayed: true };
          }
        }

        let result: DocumentRecord | undefined;
        if (command.operation === "create") {
          await tx`
            insert into framekit_documents (tenant_id, doctype, id, revision, document_status, owner_id, state, data, created_at, updated_at)
            values (
              ${command.document.tenantId}, ${command.document.doctype}, ${command.document.id}, ${command.document.revision},
              ${command.document.documentStatus}, ${command.document.ownerId ?? null}, ${command.document.state ?? null}, ${tx.json(command.document.data as postgres.JSONValue)}, ${command.document.createdAt}, ${command.document.updatedAt}
            )
          `;
          result = command.document;
          await replaceUniqueValues(tx, command);
        } else if (command.operation === "update") {
          const scope = rowPolicyScope(command.tenant, command.doctype, "write");
          const rows = await tx<{ revision: number }[]>`
            update framekit_documents
            set revision = ${command.document.revision}, document_status = ${command.document.documentStatus}, owner_id = ${command.document.ownerId ?? null}, state = ${command.document.state ?? null},
                data = ${tx.json(command.document.data as postgres.JSONValue)}, updated_at = ${command.document.updatedAt}
            where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name}
              and id = ${command.document.id} and revision = ${command.expectedRevision!}
              and (${scope === "all"} or (${scope === "self"} and owner_id = ${command.tenant.userId}))
              and owner_id is not distinct from ${command.document.ownerId ?? null}
            returning revision
          `;
          if (!rows[0]) await throwMutationWriteFailure(tx, command);
          result = command.document;
          await replaceUniqueValues(tx, command);
        } else if (command.operation === "transfer_owner") {
          const rows = await tx<typeof framekitDocuments.$inferSelect[]>`
            update framekit_documents
            set owner_id = ${command.document.ownerId!}, revision = ${command.document.revision}, updated_at = ${command.document.updatedAt}
            where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name}
              and id = ${command.document.id} and revision = ${command.expectedRevision!}
              and ${canTransferOwnership(command.tenant, command.doctype)}
            returning tenant_id as "tenantId", doctype, id, revision, document_status as "documentStatus", owner_id as "ownerId", state, data,
                      created_at as "createdAt", updated_at as "updatedAt"
          `;
          if (!rows[0]) await throwMutationWriteFailure(tx, command);
          result = rowToRecord(rows[0]!);
        } else {
          const scope = rowPolicyScope(command.tenant, command.doctype, "write");
          const rows = await tx<{ revision: number }[]>`
            delete from framekit_documents
            where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name}
              and id = ${command.document.id} and revision = ${command.expectedRevision!}
              and (${scope === "all"} or (${scope === "self"} and owner_id = ${command.tenant.userId}))
            returning revision
          `;
          if (!rows[0]) await throwMutationWriteFailure(tx, command);
          await tx`
            delete from framekit_document_unique_values
            where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name} and document_id = ${command.document.id}
          `;
        }

        await this.faultInjector?.("document", command);
        await command.afterWrite(result);
        await this.faultInjector?.("hooks", command);
        const sideEffects = typeof command.sideEffects === "function" ? command.sideEffects(result!) : command.sideEffects;
        await tx`
          insert into framekit_audit_events (tenant_id, id, user_id, action, doctype, document_id, created_at)
          values (${sideEffects.audit.tenantId}, ${sideEffects.audit.id}, ${sideEffects.audit.userId}, ${sideEffects.audit.action},
                  ${sideEffects.audit.doctype}, ${sideEffects.audit.documentId}, ${sideEffects.audit.createdAt})
        `;
        await this.faultInjector?.("audit", command);
        await tx`
          insert into framekit_outbox_events (tenant_id, id, type, topic, payload, status, attempts, created_at, processed_at, error)
          values (${sideEffects.outbox.tenantId}, ${sideEffects.outbox.id}, ${sideEffects.outbox.type}, ${sideEffects.outbox.topic},
                  ${tx.json(sideEffects.outbox.payload as postgres.JSONValue)}, ${sideEffects.outbox.status}, ${sideEffects.outbox.attempts}, ${sideEffects.outbox.createdAt}, null, null)
        `;
        await this.faultInjector?.("outbox", command);
        if (command.idempotencyKey) {
          await tx`
            insert into framekit_idempotency_keys (tenant_id, key, fingerprint, result, created_at)
            values (${command.tenant.tenantId}, ${command.idempotencyKey}, ${command.idempotencyFingerprint},
                    ${result ? tx.json(result as unknown as postgres.JSONValue) : null}, now())
          `;
        }
        await this.faultInjector?.("idempotency", command);
        return { document: result, replayed: false };
      });
    } catch (error) {
      throw mapMutationError(error, command);
    }
  }
}

export class PostgresUserStore implements UserStore {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.sql = postgres(options.connectionString, { max: options.max ?? 5 });
    this.db = drizzle(this.sql);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.db.execute(drizzleSql`select 1`); }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
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

  async delete(tenantId: string, userId: string): Promise<void> {
    await this.db.delete(framekitUsers).where(and(eq(framekitUsers.tenantId, tenantId), eq(framekitUsers.id, userId)));
  }
}

export class PostgresRoleStore implements RoleStore {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.sql = postgres(options.connectionString, { max: options.max ?? 5 });
    this.db = drizzle(this.sql);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.db.execute(drizzleSql`select 1`); }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
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

  async delete(tenantId: string, roleId: string): Promise<void> {
    await this.db.delete(framekitRoles).where(and(eq(framekitRoles.tenantId, tenantId), eq(framekitRoles.id, roleId)));
  }
}

export class PostgresApiTokenStore implements ApiTokenStore {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.sql = postgres(options.connectionString, { max: options.max ?? 5 });
    this.db = drizzle(this.sql);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.db.execute(drizzleSql`select 1`); }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
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
    this.sql = postgres(options.connectionString, { max: options.max ?? 5 });
    this.db = drizzle(this.sql);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.db.execute(drizzleSql`select 1`); }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
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
  constructor(options: PostgresRepositoryOptions) { this.sql = postgres(options.connectionString, { max: options.max ?? 5 }); this.db = drizzle(this.sql); }
  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
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
  constructor(options: PostgresRepositoryOptions) { this.sql = postgres(options.connectionString, { max: options.max ?? 5 }); }
  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
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
}

export class PostgresOidcAuthorizationStateStore implements OidcAuthorizationStateStore {
  private readonly sql: Sql;
  constructor(options: PostgresRepositoryOptions) { this.sql = postgres(options.connectionString, { max: options.max ?? 5 }); }
  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
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
}

export class PostgresAuthAuditStore implements AuthAuditSink {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;
  constructor(options: PostgresRepositoryOptions) { this.sql = postgres(options.connectionString, { max: options.max ?? 5 }); this.db = drizzle(this.sql); }
  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
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

export class PostgresAuditStore implements AuditStore {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.sql = postgres(options.connectionString, { max: options.max ?? 5 });
    this.db = drizzle(this.sql);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.db.execute(drizzleSql`select 1`); }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await this.db.execute(drizzleSql.raw(createAuditTableSql()));
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
    this.sql = postgres(options.connectionString, { max: options.max ?? 5 });
    this.db = drizzle(this.sql);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await this.db.execute(drizzleSql.raw(createOutboxTableSql()));
  }

  describe(): RepositoryDiagnostics {
    return {
      kind: "postgres",
      durable: true,
      features: ["outbox", "migration"]
    };
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
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
  private closed = false;

  constructor(options: PostgresRealtimePublisherOptions) {
    this.sql = postgres(options.connectionString, { max: options.max ?? 5 });
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
    await this.sql.unsafe(createRealtimeTableSql());
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

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.listenerReady;
    await this.listener?.unlisten();
    this.listeners.clear();
    await Promise.allSettled([...this.deliveryPumps.values()]);
    await Promise.all([this.listenerSql.end({ timeout: 1 }), this.sql.end({ timeout: 1 })]);
    this.deliveredCursors.clear();
    this.channelReady.clear();
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
    this.sql = postgres(options.connectionString, { max: options.max ?? 5 });
    this.db = drizzle(this.sql);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.db.execute(drizzleSql`select 1`); }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await this.db.execute(drizzleSql.raw(createCustomFieldTableSql()));
    await this.db.execute(drizzleSql.raw(createViewTableSql()));
  }

  describe(): RepositoryDiagnostics {
    return {
      kind: "postgres",
      durable: true,
      features: ["custom-fields", "views", "migration"]
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
}

export class PostgresNamingSeriesStore implements NamingSeriesStore {
  private readonly sql: Sql;

  constructor(options: PostgresRepositoryOptions) {
    this.sql = postgres(options.connectionString, { max: options.max ?? 5 });
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await this.sql.unsafe(createNamingSeriesTableSql());
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

  constructor(options: PostgresMigrationStoreOptions) {
    this.sql = postgres(options.connectionString, { max: options.max ?? 5 });
    this.db = drizzle(this.sql);
    this.faultInjector = options.faultInjector;
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1`; }
  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await this.db.execute(drizzleSql.raw(`${createMigrationTableSql()}\n${createMutationTablesSql()}`));
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
               to_unique_constraints as "toUniqueConstraints", changes, checksum, created_at as "createdAt", applied_at as "appliedAt"
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
               to_unique_constraints as "toUniqueConstraints", changes, checksum, created_at as "createdAt", applied_at as "appliedAt"
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
          to_unique_constraints, changes, checksum, created_at, applied_at
        ) values (
          ${record.tenantId}, ${record.id}, ${record.appName}, ${record.fromSchemaChecksum}, ${record.toSchemaChecksum},
          ${JSON.stringify(record.fromUniqueConstraints)}::jsonb, ${JSON.stringify(record.toUniqueConstraints)}::jsonb,
          ${JSON.stringify(record.changes)}::jsonb,
          ${record.checksum}, ${record.createdAt}::timestamptz, ${record.appliedAt}::timestamptz
        )
      `;
      return record;
    });
  }

  async rollback(tenant: TenantContext, migration: MigrationRecord, options: { allowDestructive?: boolean; id?: string; appliedAt?: string } = {}): Promise<MigrationRecord> {
    const plan = await createRollbackMigrationPlan(migration, {
      id: options.id,
      createdAt: options.appliedAt ?? new Date().toISOString()
    });
    return this.applyPlan(tenant, plan, options);
  }
}

export function createDocumentTableSql(): string {
  return `
create table if not exists framekit_documents (
  tenant_id text not null,
  doctype text not null,
  id text not null,
  revision integer not null default 1,
  document_status text not null default 'draft',
  owner_id text,
  state text,
  data jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint framekit_documents_identity unique (tenant_id, doctype, id)
);
alter table framekit_documents add column if not exists revision integer not null default 1;
alter table framekit_documents add column if not exists document_status text not null default 'draft';
alter table framekit_documents add column if not exists owner_id text;
create index if not exists framekit_documents_lookup on framekit_documents (tenant_id, doctype, updated_at desc);
`;
}

export function createMutationTablesSql(): string {
  return `
alter table framekit_documents add column if not exists revision integer not null default 1;
alter table framekit_documents add column if not exists document_status text not null default 'draft';
alter table framekit_documents add column if not exists owner_id text;
create table if not exists framekit_document_unique_values (
  tenant_id text not null,
  doctype text not null,
  field text not null,
  value text not null,
  document_id text not null,
  constraint framekit_document_unique_value unique (tenant_id, doctype, field, value),
  constraint framekit_document_unique_field unique (tenant_id, doctype, document_id, field)
);
create table if not exists framekit_idempotency_keys (
  tenant_id text not null,
  key text not null,
  fingerprint text not null,
  result jsonb,
  created_at timestamptz not null,
  constraint framekit_idempotency_identity unique (tenant_id, key)
);
`;
}

export function createUserTableSql(): string {
  return `
create table if not exists framekit_users (
  tenant_id text not null,
  id text not null,
  email text not null,
  name text not null,
  password_hash text not null,
  roles jsonb not null,
  permissions jsonb not null,
  disabled_at timestamptz,
  locked_until timestamptz,
  failed_login_attempts integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint framekit_users_identity unique (tenant_id, id),
  constraint framekit_users_email unique (tenant_id, email)
);
alter table framekit_users add column if not exists disabled_at timestamptz;
alter table framekit_users add column if not exists locked_until timestamptz;
alter table framekit_users add column if not exists failed_login_attempts integer not null default 0;
create index if not exists framekit_users_lookup on framekit_users (tenant_id, email);
`;
}

export function createRoleTableSql(): string {
  return `
create table if not exists framekit_roles (
  tenant_id text not null,
  id text not null,
  name text not null,
  permissions jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint framekit_roles_identity unique (tenant_id, id)
);
create index if not exists framekit_roles_lookup on framekit_roles (tenant_id, name);
`;
}

export function createApiTokenTableSql(): string {
  return `
create table if not exists framekit_api_tokens (
  tenant_id text not null,
  id text not null,
  name text not null,
  token_hash text not null,
  user_id text,
  roles jsonb not null,
  permissions jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint framekit_api_tokens_identity unique (tenant_id, id),
  constraint framekit_api_tokens_hash unique (token_hash)
);
create index if not exists framekit_api_tokens_lookup on framekit_api_tokens (tenant_id, created_at desc);
`;
}

export function createSessionRevocationTableSql(): string {
  return `
create table if not exists framekit_session_revocations (
  session_id text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz not null
);
create unique index if not exists framekit_session_revocations_identity on framekit_session_revocations (session_id);
create index if not exists framekit_session_revocations_expiry on framekit_session_revocations (expires_at);
`;
}

export function createAuthIdentityLifecycleTablesSql(): string {
  return `
create table if not exists framekit_auth_identity_links (
  tenant_id text not null, provider_id text not null, subject text not null, user_id text not null, email text,
  created_at timestamptz not null, updated_at timestamptz not null,
  constraint framekit_auth_identity_links_subject unique (tenant_id, provider_id, subject)
);
create index if not exists framekit_auth_identity_links_user on framekit_auth_identity_links (tenant_id, user_id);
create table if not exists framekit_auth_lifecycle_tokens (
  id text not null, tenant_id text not null, kind text not null, token_hash text not null, email text, user_id text, name text,
  roles jsonb, permissions jsonb, created_at timestamptz not null, expires_at timestamptz not null, used_at timestamptz,
  constraint framekit_auth_lifecycle_tokens_hash unique (token_hash)
);
create index if not exists framekit_auth_lifecycle_tokens_lookup on framekit_auth_lifecycle_tokens (tenant_id, kind, expires_at);
create table if not exists framekit_oidc_authorization_states (
  id text not null, provider_id text not null, tenant_id text not null, state_hash text not null, nonce_hash text not null,
  encrypted_code_verifier text not null, return_to text not null, redirect_uri text not null,
  created_at timestamptz not null, expires_at timestamptz not null, used_at timestamptz,
  constraint framekit_oidc_authorization_states_hash unique (provider_id, state_hash)
);
create index if not exists framekit_oidc_authorization_states_expiry on framekit_oidc_authorization_states (expires_at);
create table if not exists framekit_auth_audit_events (
  id text not null, tenant_id text not null, actor_user_id text, target_user_id text, action text not null,
  success integer not null, created_at timestamptz not null, details jsonb,
  constraint framekit_auth_audit_events_identity unique (tenant_id, id)
);
create index if not exists framekit_auth_audit_events_lookup on framekit_auth_audit_events (tenant_id, created_at desc);
`;
}

export function createAuditTableSql(): string {
  return `
create table if not exists framekit_audit_events (
  tenant_id text not null,
  id text not null,
  user_id text not null,
  action text not null,
  doctype text not null,
  document_id text not null,
  created_at timestamptz not null
);
create unique index if not exists framekit_audit_events_identity on framekit_audit_events (tenant_id, id);
create index if not exists framekit_audit_events_lookup on framekit_audit_events (tenant_id, created_at desc);
`;
}

export function createOutboxTableSql(): string {
  return `
create table if not exists framekit_outbox_events (
  tenant_id text not null,
  id text not null,
  type text not null,
  topic text not null,
  payload jsonb not null,
  status text not null,
  attempts integer not null default 0,
  created_at timestamptz not null,
  processed_at timestamptz,
  error text,
  lease_owner text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz
);
alter table framekit_outbox_events add column if not exists lease_owner text;
alter table framekit_outbox_events add column if not exists lease_expires_at timestamptz;
alter table framekit_outbox_events add column if not exists next_attempt_at timestamptz;
create unique index if not exists framekit_outbox_events_identity on framekit_outbox_events (tenant_id, id);
create index if not exists framekit_outbox_events_pending on framekit_outbox_events (tenant_id, status, created_at asc);
create index if not exists framekit_outbox_events_claim on framekit_outbox_events (tenant_id, status, next_attempt_at, lease_expires_at, created_at asc);
`;
}

export function createRealtimeTableSql(): string {
  return `
create table if not exists framekit_realtime_events (
  cursor bigserial primary key,
  channel text not null,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists framekit_realtime_events_channel_cursor on framekit_realtime_events (channel, cursor desc);
`;
}

export function createCustomFieldTableSql(): string {
  return `
create table if not exists framekit_custom_fields (
  tenant_id text not null,
  id text not null,
  doctype text not null,
  field jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index if not exists framekit_custom_fields_identity on framekit_custom_fields (tenant_id, id);
create index if not exists framekit_custom_fields_lookup on framekit_custom_fields (tenant_id, doctype);
`;
}

export function createViewTableSql(): string {
  return `
create table if not exists framekit_views (
  tenant_id text not null,
  id text not null,
  doctype text not null,
  type text not null,
  fields jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index if not exists framekit_views_identity on framekit_views (tenant_id, id);
create index if not exists framekit_views_lookup on framekit_views (tenant_id, doctype, type);
`;
}

export function createNamingSeriesTableSql(): string {
  return `
create table if not exists framekit_naming_series (
  tenant_id text not null,
  prefix text not null,
  current_value integer not null,
  updated_at timestamptz not null,
  constraint framekit_naming_series_identity unique (tenant_id, prefix)
);
`;
}

export function createMigrationTableSql(): string {
  return `
create table if not exists framekit_migrations (
  tenant_id text not null,
  id text not null,
  app_name text not null,
  from_schema_checksum text not null default '',
  to_schema_checksum text not null default '',
  from_unique_constraints jsonb not null default '[]'::jsonb,
  to_unique_constraints jsonb not null default '[]'::jsonb,
  changes jsonb not null,
  checksum text not null default '',
  created_at timestamptz not null,
  applied_at timestamptz not null,
  constraint framekit_migrations_identity unique (tenant_id, app_name, id)
);
alter table framekit_migrations add column if not exists checksum text not null default '';
alter table framekit_migrations add column if not exists from_schema_checksum text not null default '';
alter table framekit_migrations add column if not exists to_schema_checksum text not null default '';
alter table framekit_migrations add column if not exists from_unique_constraints jsonb not null default '[]'::jsonb;
alter table framekit_migrations add column if not exists to_unique_constraints jsonb not null default '[]'::jsonb;
alter table framekit_migrations drop constraint if exists framekit_migrations_identity;
create unique index if not exists framekit_migrations_identity on framekit_migrations (tenant_id, app_name, id);
create index if not exists framekit_migrations_lookup on framekit_migrations (tenant_id, applied_at desc);
`;
}

export function createPostgresMigrationSql(plan: MigrationPlan, options: { direction?: "up" | "down" } = {}): string {
  return `${createPostgresMigrationStatements(plan, options).join("\n")}\n`;
}

export function createPostgresRollbackSql(migration: MigrationRecord): string {
  return createPostgresMigrationSql(migration, { direction: "down" });
}

export function createPostgresMigrationStatements(plan: MigrationPlan, options: { direction?: "up" | "down" } = {}): string[] {
  const changes = options.direction === "down"
    ? plan.changes.slice().reverse().map((change) => change.rollback ?? rollbackFromChange(change))
    : plan.changes;
  return changes.flatMap((change) => statementsForChange(plan.tenantId, change));
}

async function validateExecutableMigration(plan: MigrationPlan, options: { allowDestructive?: boolean }): Promise<void> {
  await validateMigrationPlan(plan);
  assertDestructiveMigration(plan, options);
  assertSupportedMigration(plan);
}

function statementsForChange(tenantId: string, change: MigrationChange | MigrationRollback): string[] {
  switch (change.kind) {
    case "add_doctype":
      return [`-- add_doctype ${change.doctype}: documents use the shared JSONB table`];
    case "remove_doctype":
      return [`delete from framekit_documents where tenant_id = ${sqlLiteral(tenantId)} and doctype = ${sqlLiteral(change.doctype)};`];
    case "add_field": {
      const field = change.to && typeof change.to === "object" ? change.to as { default?: unknown } : undefined;
      if (field && "default" in field) {
        return [
          `update framekit_documents set data = jsonb_set(data, '{${jsonPathSegment(change.field)}}', ${sqlLiteralJson(field.default)}::jsonb, true) where tenant_id = ${sqlLiteral(tenantId)} and doctype = ${sqlLiteral(change.doctype)} and not (data ? ${sqlLiteral(change.field)});`
        ];
      }
      return [`-- add_field ${change.doctype}.${change.field}: no DDL required for JSONB document data`];
    }
    case "remove_field":
      return [
        `update framekit_documents set data = data - ${sqlLiteral(change.field)} where tenant_id = ${sqlLiteral(tenantId)} and doctype = ${sqlLiteral(change.doctype)} and data ? ${sqlLiteral(change.field)};`
      ];
    case "change_field_type":
      return [`-- change_field_type ${change.doctype}.${change.field}: no safe automatic JSONB cast generated`];
    case "add_index":
      return [`create index if not exists ${indexIdentifier(change, "idx")} on framekit_documents (tenant_id, doctype, ${indexExpressions(change.field).join(", ")}) where doctype = ${sqlLiteral(change.doctype)};`];
    case "remove_index":
      return [`drop index if exists ${indexIdentifier(change, "idx")};`];
    case "add_unique_constraint":
      return [`create unique index if not exists ${indexIdentifier(change, "uniq")} on framekit_documents (tenant_id, doctype, (data ->> ${sqlLiteral(change.field)})) where doctype = ${sqlLiteral(change.doctype)} and data ? ${sqlLiteral(change.field)} and data ->> ${sqlLiteral(change.field)} <> '';`];
    case "remove_unique_constraint":
      return [`drop index if exists ${indexIdentifier(change, "uniq")};`];
    case "change_row_policy":
      return [`-- change_row_policy ${change.doctype}: authorize only after any required owner_id backfill`];
  }
}

function executableStatements(statements: string[]): string[] {
  return statements.filter((statement) => !statement.trimStart().startsWith("--"));
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
  checksum: string;
  createdAt: Date | string;
  appliedAt: Date | string;
};

function migrationSqlRowToRecord(row: MigrationSqlRow): MigrationRecord {
  return {
    ...row,
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

function rollbackFromChange(change: MigrationChange): MigrationRollback {
  if (change.rollback) {
    return change.rollback;
  }
  switch (change.kind) {
    case "add_doctype":
      return { kind: "remove_doctype", doctype: change.doctype, field: "*", destructive: true, from: change.to };
    case "remove_doctype":
      throw new FramekitError("IRREVERSIBLE_MIGRATION", `Removing DocType "${change.doctype}" cannot be rolled back automatically.`, 409);
    case "add_field":
      return { kind: "remove_field", doctype: change.doctype, field: change.field, destructive: true, from: change.to };
    case "remove_field":
      throw new FramekitError("IRREVERSIBLE_MIGRATION", `Removing field ${change.doctype}.${change.field} cannot restore deleted values automatically.`, 409);
    case "change_field_type":
      return { kind: "change_field_type", doctype: change.doctype, field: change.field, destructive: true, from: change.to, to: change.from };
    case "add_index":
      return { kind: "remove_index", doctype: change.doctype, field: change.field, destructive: false, from: change.to };
    case "remove_index":
      return { kind: "add_index", doctype: change.doctype, field: change.field, destructive: false, to: change.from };
    case "add_unique_constraint":
      return { kind: "remove_unique_constraint", doctype: change.doctype, field: change.field, destructive: false, from: change.to };
    case "remove_unique_constraint":
      return { kind: "add_unique_constraint", doctype: change.doctype, field: change.field, destructive: false, to: change.from };
    case "change_row_policy":
      return { kind: "change_row_policy", doctype: change.doctype, field: "row_policy", destructive: true, from: change.to, to: change.from };
  }
}

function indexIdentifier(change: Pick<MigrationChange, "doctype" | "field">, suffix: "idx" | "uniq"): string {
  return `framekit_documents_${identifierPart(change.doctype)}_${identifierPart(change.field)}_${suffix}`;
}

function identifierPart(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_]+/g, "_").replaceAll(/^_+|_+$/g, "").toLowerCase();
}

function indexExpressions(fields: string): string[] {
  return fields.split(",").map((field) => `(data ->> ${sqlLiteral(field)})`);
}

function jsonPathSegment(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlLiteralJson(value: unknown): string {
  return sqlLiteral(JSON.stringify(value));
}

async function replaceUniqueValues(sql: postgres.TransactionSql, command: MutationCommand): Promise<void> {
  await sql`
    delete from framekit_document_unique_values
    where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name} and document_id = ${command.document.id}
  `;
  for (const field of command.doctype.fields.filter((candidate) => candidate.unique)) {
    const value = command.document.data[field.name];
    if (value === undefined || value === null || value === "") continue;
    await sql`
      insert into framekit_document_unique_values (tenant_id, doctype, field, value, document_id)
      values (${command.tenant.tenantId}, ${command.doctype.name}, ${field.name}, ${canonicalUniqueValue(value)}, ${command.document.id})
    `;
  }
}

async function throwMutationWriteFailure(sql: postgres.TransactionSql, command: MutationCommand): Promise<never> {
  const scope = command.operation === "transfer_owner" && canTransferOwnership(command.tenant, command.doctype) ? "all" : rowPolicyScope(command.tenant, command.doctype, "write");
  const rows = await sql<{ revision: number }[]>`
    select revision from framekit_documents
    where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name} and id = ${command.document.id}
      and (${scope === "all"} or (${scope === "self"} and owner_id = ${command.tenant.userId}))
    limit 1
  `;
  if (!rows[0]) {
    throw new FramekitError("DOCUMENT_NOT_FOUND", `${command.doctype.name} "${command.document.id}" does not exist`, 404);
  }
  throw postgresRevisionConflict(command.doctype.name, command.document.id, command.expectedRevision!, rows[0].revision);
}

function canonicalUniqueValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function postgresRevisionConflict(doctype: string, id: string, expectedRevision: number, actualRevision: number): FramekitError {
  return new FramekitError("REVISION_CONFLICT", `${doctype} "${id}" changed since it was read`, 409, {
    doctype,
    id,
    expectedRevision,
    actualRevision
  });
}

function assertIdempotencyFingerprint(key: string, expected: string, actual: string): void {
  if (expected !== actual) {
    throw new FramekitError("IDEMPOTENCY_KEY_REUSED", `Idempotency key "${key}" was already used for another command`, 409, { key });
  }
}

function mapMutationError(error: unknown, command: MutationCommand): unknown {
  if (error instanceof FramekitError) return error;
  const postgresError = error as { code?: string; constraint_name?: string };
  if (postgresError.code === "23505") {
    if (postgresError.constraint_name === "framekit_document_unique_value" || postgresError.constraint_name?.endsWith("_uniq")) {
      return new FramekitError("UNIQUE_CONSTRAINT_FAILED", `${command.doctype.name} contains a duplicate unique value`, 409, {
        doctype: command.doctype.name
      });
    }
    return new FramekitError("DOCUMENT_EXISTS", `${command.doctype.name} "${command.document.id}" already exists`, 409);
  }
  return error;
}

function normalizedDocumentSort(sort: ListOptions["sort"]): { field: string; direction: "asc" | "desc" } {
  return {
    field: sort?.field ?? "updatedAt",
    direction: sort?.direction === "asc" ? "asc" : "desc"
  };
}

function documentSortExpression(field: string, fieldType?: string): SQL<string | number> {
  if (field === "id") return drizzleSql<string>`${framekitDocuments.id} collate "C"`;
  if (field === "createdAt") return drizzleSql<string>`to_char(${framekitDocuments.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') collate "C"`;
  if (field === "updatedAt") return drizzleSql<string>`to_char(${framekitDocuments.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') collate "C"`;
  if (fieldType === "number" || fieldType === "currency") {
    return drizzleSql<number>`coalesce((${framekitDocuments.data} ->> ${field})::numeric, 0)`;
  }
  return drizzleSql<string>`coalesce(${framekitDocuments.data} ->> ${field}, '') collate "C"`;
}

function documentProjection(fields?: string[]): typeof framekitDocuments.data | SQL<Record<string, unknown>> {
  if (!fields) return framekitDocuments.data;
  if (fields.length === 0) return drizzleSql<Record<string, unknown>>`'{}'::jsonb`;
  const objects = fields.map((field) => drizzleSql`
    case when ${framekitDocuments.data} ? cast(${field} as text)
      then jsonb_build_object(cast(${field} as text), ${framekitDocuments.data} -> cast(${field} as text))
      else '{}'::jsonb end
  `);
  return drizzleSql<Record<string, unknown>>`${drizzleSql.join(objects, drizzleSql` || `)}`;
}

function compileDocumentFilters(doctype: DocTypeDefinition, filters: ListOptions["filters"] = {}): SQL[] {
  const conditions: SQL[] = [];
  for (const [field, filter] of Object.entries(filters)) {
    if (filter === undefined || filter === "") continue;
    const fieldType = doctype.fields.find((candidate) => candidate.name === field)?.type;
    if (!fieldType) throw new FramekitError("UNKNOWN_FILTER_FIELD", `Unknown filter field "${field}" for ${doctype.name}`, 422);
    if (fieldType === "json" && (!filter || typeof filter !== "object" || Array.isArray(filter) || Object.keys(filter).length !== 1 || filter.isNull === undefined)) {
      throw new FramekitError("UNSUPPORTED_QUERY_SHAPE", `JSON field "${field}" only supports isNull filtering`, 422);
    }
    const text = drizzleSql<string>`coalesce(${framekitDocuments.data} ->> ${field}, '')`;
    const comparable = fieldType === "number" || fieldType === "currency"
      ? drizzleSql<number>`coalesce((${framekitDocuments.data} ->> ${field})::numeric, 0)`
      : text;
    if (Array.isArray(filter)) {
      conditions.push(filter.length === 0 ? drizzleSql`false` : or(...filter.map((value) => equalityFilter(field, text, value)))!);
      continue;
    }
    if (!filter || typeof filter !== "object") {
      conditions.push(equalityFilter(field, text, filter));
      continue;
    }
    const operator = filter as FilterOperator;
    const unknownOperators = Object.keys(operator).filter((key) => !["eq", "ne", "in", "contains", "gt", "gte", "lt", "lte", "isNull"].includes(key));
    if (unknownOperators.length > 0 || (operator.in !== undefined && !Array.isArray(operator.in))) {
      throw new FramekitError("UNSUPPORTED_QUERY_SHAPE", `Unsupported filter shape for ${doctype.name}.${field}`, 422, { operators: unknownOperators });
    }
    if (operator.isNull !== undefined) {
      const isNull = or(
        drizzleSql`not (${framekitDocuments.data} ? ${field})`,
        drizzleSql`${framekitDocuments.data} -> ${field} = 'null'::jsonb`,
        eq(text, "")
      )!;
      conditions.push(operator.isNull ? isNull : drizzleSql`not (${isNull})`);
    }
    if (operator.eq !== undefined) conditions.push(equalityFilter(field, text, operator.eq));
    if (operator.ne !== undefined) {
      conditions.push(operator.ne === null
        ? or(drizzleSql`not (${framekitDocuments.data} ? ${field})`, drizzleSql`${framekitDocuments.data} -> ${field} <> 'null'::jsonb` )!
        : or(
            drizzleSql`not (${framekitDocuments.data} ? ${field})`,
            drizzleSql`${framekitDocuments.data} -> ${field} = 'null'::jsonb`,
            ne(text, String(operator.ne))
          )!);
    }
    if (operator.in !== undefined) {
      conditions.push(operator.in.length === 0 ? drizzleSql`false` : or(...operator.in.map((value) => equalityFilter(field, text, value)))!);
    }
    if (operator.contains !== undefined) {
      conditions.push(drizzleSql`lower(${text}) like ${containsPattern(operator.contains.toLowerCase())} escape '\\'`);
    }
    const present = fieldType === "number" || fieldType === "currency"
      ? and(drizzleSql`${framekitDocuments.data} ? ${field}`, ne(text, ""))!
      : undefined;
    if (operator.gt !== undefined) conditions.push(present ? and(present, gt(comparable, operator.gt))! : gt(comparable, operator.gt));
    if (operator.gte !== undefined) conditions.push(present ? and(present, gte(comparable, operator.gte))! : gte(comparable, operator.gte));
    if (operator.lt !== undefined) conditions.push(present ? and(present, lt(comparable, operator.lt))! : lt(comparable, operator.lt));
    if (operator.lte !== undefined) conditions.push(present ? and(present, lte(comparable, operator.lte))! : lte(comparable, operator.lte));
  }
  return conditions;
}

function compileRowPolicy(tenant: TenantContext, doctype: DocTypeDefinition, operation: "read" | "write"): SQL {
  const scope = rowPolicyScope(tenant, doctype, operation);
  if (scope === "all") return drizzleSql`true`;
  if (scope === "self") return eq(framekitDocuments.ownerId, tenant.userId);
  return drizzleSql`false`;
}

function equalityFilter(field: string, text: SQL<string>, value: unknown): SQL {
  if (value === null) return drizzleSql`${framekitDocuments.data} -> ${field} = 'null'::jsonb`;
  return and(
    drizzleSql`${framekitDocuments.data} ? ${field}`,
    drizzleSql`${framekitDocuments.data} -> ${field} <> 'null'::jsonb`,
    eq(text, String(value))
  )!;
}

function containsPattern(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function selectedRowToRecord(row: {
  tenantId: string;
  doctype: string;
  id: string;
  revision: number;
  documentStatus: DocumentRecord["documentStatus"];
  ownerId: string | null;
  state: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}): DocumentRecord {
  return {
    tenantId: row.tenantId,
    doctype: row.doctype,
    id: row.id,
    revision: row.revision,
    documentStatus: row.documentStatus,
    ownerId: row.ownerId ?? undefined,
    state: row.state ?? undefined,
    data: row.data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function rowToRecord(row: typeof framekitDocuments.$inferSelect): DocumentRecord {
  return {
    tenantId: row.tenantId,
    doctype: row.doctype,
    id: row.id,
    revision: row.revision,
    documentStatus: row.documentStatus,
    ownerId: row.ownerId ?? undefined,
    state: row.state ?? undefined,
    data: row.data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
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

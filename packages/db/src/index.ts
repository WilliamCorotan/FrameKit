import { and, asc, desc, eq, gt, gte, lt, lte, ne, or, sql as drizzleSql, type SQL } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import type { ApiTokenRecord, ApiTokenStore, AuthRole, AuthUser, RoleStore, SessionRevocationStore, UserStore } from "@framekit/auth";
import type { CustomFieldDefinition, DocTypeDefinition, DocumentRecord, TenantContext, ViewDefinition } from "@framekit/core";
import { FramekitError } from "@framekit/core";
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
  type OutboxStore,
  type RepositoryDiagnostics,
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
  error: text("error")
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
  (table) => [uniqueIndex("framekit_migrations_identity").on(table.tenantId, table.id)]
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

export class PostgresDocumentRepository implements DocumentRepository {
  private readonly db: PostgresJsDatabase;
  private readonly onQuery?: PostgresRepositoryOptions["onQuery"];

  constructor(options: PostgresRepositoryOptions) {
    this.db = drizzle(postgres(options.connectionString, { max: options.max ?? 5 }));
    this.onQuery = options.onQuery;
  }

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

  async get(tenant: TenantContext, doctype: DocTypeDefinition, id: string): Promise<DocumentRecord | undefined> {
    const rows = await this.db
      .select()
      .from(framekitDocuments)
      .where(and(eq(framekitDocuments.tenantId, tenant.tenantId), eq(framekitDocuments.doctype, doctype.name), eq(framekitDocuments.id, id)))
      .limit(1);
    return rows[0] ? rowToRecord(rows[0]) : undefined;
  }

  async create(_tenant: TenantContext, _doctype: DocTypeDefinition, record: DocumentRecord): Promise<DocumentRecord> {
    await this.db.insert(framekitDocuments).values({
      tenantId: record.tenantId,
      doctype: record.doctype,
      id: record.id,
      revision: record.revision,
      state: record.state,
      data: record.data,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
    return record;
  }

  async update(tenant: TenantContext, doctype: DocTypeDefinition, record: DocumentRecord, options: { expectedRevision?: number } = {}): Promise<DocumentRecord> {
    const conditions = [eq(framekitDocuments.tenantId, tenant.tenantId), eq(framekitDocuments.doctype, doctype.name), eq(framekitDocuments.id, record.id)];
    if (options.expectedRevision !== undefined) conditions.push(eq(framekitDocuments.revision, options.expectedRevision));
    const rows = await this.db
      .update(framekitDocuments)
      .set({
        revision: record.revision,
        state: record.state,
        data: record.data,
        updatedAt: new Date(record.updatedAt)
      })
      .where(and(...conditions))
      .returning();
    if (!rows[0]) {
      const current = await this.get(tenant, doctype, record.id);
      if (current && options.expectedRevision !== undefined) {
        throw postgresRevisionConflict(doctype.name, record.id, options.expectedRevision, current.revision);
      }
      throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${record.id}" does not exist`, 404);
    }
    return rowToRecord(rows[0]);
  }

  async delete(tenant: TenantContext, doctype: DocTypeDefinition, id: string, options: { expectedRevision?: number } = {}): Promise<void> {
    const conditions = [eq(framekitDocuments.tenantId, tenant.tenantId), eq(framekitDocuments.doctype, doctype.name), eq(framekitDocuments.id, id)];
    if (options.expectedRevision !== undefined) conditions.push(eq(framekitDocuments.revision, options.expectedRevision));
    const rows = await this.db
      .delete(framekitDocuments)
      .where(and(...conditions))
      .returning({ revision: framekitDocuments.revision });
    if (!rows[0]) {
      const current = await this.get(tenant, doctype, id);
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
            insert into framekit_documents (tenant_id, doctype, id, revision, state, data, created_at, updated_at)
            values (
              ${command.document.tenantId}, ${command.document.doctype}, ${command.document.id}, ${command.document.revision},
              ${command.document.state ?? null}, ${tx.json(command.document.data as postgres.JSONValue)}, ${command.document.createdAt}, ${command.document.updatedAt}
            )
          `;
          result = command.document;
          await replaceUniqueValues(tx, command);
        } else if (command.operation === "update") {
          const rows = await tx<{ revision: number }[]>`
            update framekit_documents
            set revision = ${command.document.revision}, state = ${command.document.state ?? null},
                data = ${tx.json(command.document.data as postgres.JSONValue)}, updated_at = ${command.document.updatedAt}
            where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name}
              and id = ${command.document.id} and revision = ${command.expectedRevision!}
            returning revision
          `;
          if (!rows[0]) await throwMutationWriteFailure(tx, command);
          result = command.document;
          await replaceUniqueValues(tx, command);
        } else {
          const rows = await tx<{ revision: number }[]>`
            delete from framekit_documents
            where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name}
              and id = ${command.document.id} and revision = ${command.expectedRevision!}
            returning revision
          `;
          if (!rows[0]) await throwMutationWriteFailure(tx, command);
          await tx`
            delete from framekit_document_unique_values
            where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name} and document_id = ${command.document.id}
          `;
        }

        await this.faultInjector?.("document", command);
        await command.afterWrite();
        await this.faultInjector?.("hooks", command);
        await tx`
          insert into framekit_audit_events (tenant_id, id, user_id, action, doctype, document_id, created_at)
          values (${command.audit.tenantId}, ${command.audit.id}, ${command.audit.userId}, ${command.audit.action},
                  ${command.audit.doctype}, ${command.audit.documentId}, ${command.audit.createdAt})
        `;
        await this.faultInjector?.("audit", command);
        await tx`
          insert into framekit_outbox_events (tenant_id, id, type, topic, payload, status, attempts, created_at, processed_at, error)
          values (${command.outbox.tenantId}, ${command.outbox.id}, ${command.outbox.type}, ${command.outbox.topic},
                  ${tx.json(command.outbox.payload as postgres.JSONValue)}, ${command.outbox.status}, ${command.outbox.attempts}, ${command.outbox.createdAt}, null, null)
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
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.db = drizzle(postgres(options.connectionString, { max: options.max ?? 5 }));
  }

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
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.db = drizzle(postgres(options.connectionString, { max: options.max ?? 5 }));
  }

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
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.db = drizzle(postgres(options.connectionString, { max: options.max ?? 5 }));
  }

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
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.db = drizzle(postgres(options.connectionString, { max: options.max ?? 5 }));
  }

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

export class PostgresAuditStore implements AuditStore {
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.db = drizzle(postgres(options.connectionString, { max: options.max ?? 5 }));
  }

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
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.db = drizzle(postgres(options.connectionString, { max: options.max ?? 5 }));
  }

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
      error: event.error
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

  private async updateStatus(tenant: TenantContext, id: string, status: OutboxEvent["status"], error?: string): Promise<OutboxEvent> {
    const rows = await this.db
      .update(framekitOutboxEvents)
      .set({
        status,
        error,
        attempts: drizzleSql`${framekitOutboxEvents.attempts} + 1`,
        processedAt: new Date()
      })
      .where(and(eq(framekitOutboxEvents.tenantId, tenant.tenantId), eq(framekitOutboxEvents.id, id)))
      .returning();
    if (!rows[0]) {
      throw new FramekitError("OUTBOX_EVENT_NOT_FOUND", `No outbox event with id "${id}"`, 404);
    }
    return rowToOutboxEvent(rows[0]);
  }
}

export class PostgresCustomizationStore implements CustomizationStore {
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.db = drizzle(postgres(options.connectionString, { max: options.max ?? 5 }));
  }

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

  async list(tenant: TenantContext): Promise<MigrationRecord[]> {
    const rows = await this.db.select().from(framekitMigrations).where(eq(framekitMigrations.tenantId, tenant.tenantId));
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
      await sql`select pg_advisory_xact_lock(hashtextextended(${`framekit:migration:${tenant.tenantId}`}, 0))`;
      const existing = await sql<MigrationSqlRow[]>`
        select tenant_id as "tenantId", id, app_name as "appName", from_schema_checksum as "fromSchemaChecksum",
               to_schema_checksum as "toSchemaChecksum", from_unique_constraints as "fromUniqueConstraints",
               to_unique_constraints as "toUniqueConstraints", changes, checksum, created_at as "createdAt", applied_at as "appliedAt"
        from framekit_migrations where tenant_id = ${tenant.tenantId} and id = ${plan.id} limit 1
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
        from framekit_migrations where tenant_id = ${tenant.tenantId} order by applied_at desc, id desc limit 1
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
  state text,
  data jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint framekit_documents_identity unique (tenant_id, doctype, id)
);
alter table framekit_documents add column if not exists revision integer not null default 1;
create index if not exists framekit_documents_lookup on framekit_documents (tenant_id, doctype, updated_at desc);
`;
}

export function createMutationTablesSql(): string {
  return `
alter table framekit_documents add column if not exists revision integer not null default 1;
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
  error text
);
create unique index if not exists framekit_outbox_events_identity on framekit_outbox_events (tenant_id, id);
create index if not exists framekit_outbox_events_pending on framekit_outbox_events (tenant_id, status, created_at asc);
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
  constraint framekit_migrations_identity unique (tenant_id, id)
);
alter table framekit_migrations add column if not exists checksum text not null default '';
alter table framekit_migrations add column if not exists from_schema_checksum text not null default '';
alter table framekit_migrations add column if not exists to_schema_checksum text not null default '';
alter table framekit_migrations add column if not exists from_unique_constraints jsonb not null default '[]'::jsonb;
alter table framekit_migrations add column if not exists to_unique_constraints jsonb not null default '[]'::jsonb;
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
      return [`create unique index if not exists ${indexIdentifier(change, "uniq")} on framekit_documents (tenant_id, doctype, (data ->> ${sqlLiteral(change.field)})) where doctype = ${sqlLiteral(change.doctype)} and data ? ${sqlLiteral(change.field)};`];
    case "remove_unique_constraint":
      return [`drop index if exists ${indexIdentifier(change, "uniq")};`];
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
    await sql.unsafe(
      `create unique index if not exists ${indexName} on framekit_documents (tenant_id, doctype, (data ->> ${sqlLiteral(constraint.field)})) ` +
      `where doctype = ${sqlLiteral(constraint.doctype)} and data ? ${sqlLiteral(constraint.field)};`
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
  const rows = await sql<{ revision: number }[]>`
    select revision from framekit_documents
    where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name} and id = ${command.document.id}
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
    error: row.error ?? undefined
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

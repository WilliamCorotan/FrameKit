import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import type { AuthUser, UserStore } from "@framekit/auth";
import type { CustomFieldDefinition, DocTypeDefinition, DocumentRecord, TenantContext, ViewDefinition } from "@framekit/core";
import { FramekitError } from "@framekit/core";
import type { AuditEvent, AuditStore, CustomizationStore, DocumentRepository, ListOptions, NamingSeriesStore, OutboxEvent, OutboxStore, RepositoryDiagnostics } from "@framekit/runtime";

export const framekitDocuments = pgTable(
  "framekit_documents",
  {
    tenantId: text("tenant_id").notNull(),
    doctype: text("doctype").notNull(),
    id: text("id").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex("framekit_users_identity").on(table.tenantId, table.id),
    uniqueIndex("framekit_users_email").on(table.tenantId, table.email)
  ]
);

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

export type PostgresRepositoryOptions = {
  connectionString: string;
  max?: number;
};

export class PostgresDocumentRepository implements DocumentRepository {
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresRepositoryOptions) {
    this.db = drizzle(postgres(options.connectionString, { max: options.max ?? 5 }));
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
    const rows = await this.db
      .select()
      .from(framekitDocuments)
      .where(and(eq(framekitDocuments.tenantId, tenant.tenantId), eq(framekitDocuments.doctype, doctype.name)))
      .limit(options.limit ?? 100);
    const records = rows.map(rowToRecord);
    return options.search ? records.filter((record) => JSON.stringify(record.data).toLowerCase().includes(options.search!.toLowerCase())) : records;
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
      state: record.state,
      data: record.data,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
    return record;
  }

  async update(tenant: TenantContext, doctype: DocTypeDefinition, record: DocumentRecord): Promise<DocumentRecord> {
    const rows = await this.db
      .update(framekitDocuments)
      .set({
        state: record.state,
        data: record.data,
        updatedAt: new Date(record.updatedAt)
      })
      .where(and(eq(framekitDocuments.tenantId, tenant.tenantId), eq(framekitDocuments.doctype, doctype.name), eq(framekitDocuments.id, record.id)))
      .returning();
    if (!rows[0]) {
      throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${record.id}" does not exist`, 404);
    }
    return rowToRecord(rows[0]);
  }

  async delete(tenant: TenantContext, doctype: DocTypeDefinition, id: string): Promise<void> {
    await this.db
      .delete(framekitDocuments)
      .where(and(eq(framekitDocuments.tenantId, tenant.tenantId), eq(framekitDocuments.doctype, doctype.name), eq(framekitDocuments.id, id)));
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
          updatedAt: now
        }
      });
    return user;
  }

  async findByEmail(email: string): Promise<AuthUser | undefined> {
    const rows = await this.db.select().from(framekitUsers).where(eq(framekitUsers.email, email.toLowerCase())).limit(1);
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

export function createDocumentTableSql(): string {
  return `
create table if not exists framekit_documents (
  tenant_id text not null,
  doctype text not null,
  id text not null,
  state text,
  data jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint framekit_documents_identity unique (tenant_id, doctype, id)
);
create index if not exists framekit_documents_lookup on framekit_documents (tenant_id, doctype, updated_at desc);
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
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint framekit_users_identity unique (tenant_id, id),
  constraint framekit_users_email unique (tenant_id, email)
);
create index if not exists framekit_users_lookup on framekit_users (tenant_id, email);
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

function rowToRecord(row: typeof framekitDocuments.$inferSelect): DocumentRecord {
  return {
    tenantId: row.tenantId,
    doctype: row.doctype,
    id: row.id,
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
    permissions: row.permissions
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

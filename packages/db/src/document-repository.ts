import { and, asc, desc, eq, gt, gte, lt, lte, ne, or, sql as drizzleSql, type SQL } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { type Sql } from "postgres";
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
import { framekitDocuments } from "./schema.js";
import type { PostgresRepositoryOptions } from "./types.js";
import { createDocumentTableSql } from "./ddl.js";
import { postgresRevisionConflict, rowToRecord } from "./document-mapping.js";
import { closeAdapterSql, postgresForOptions, runBootstrapMigrations } from "./connection.js";

export class PostgresDocumentRepository implements DocumentRepository {
  private readonly sql: Sql;
  private readonly db: PostgresJsDatabase;
  private readonly onQuery?: PostgresRepositoryOptions["onQuery"];

  constructor(options: PostgresRepositoryOptions) {
    this.sql = postgresForOptions(options);
    this.db = drizzle(options.connection?.drizzleSql ?? this.sql);
    this.onQuery = options.onQuery;
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.db.execute(drizzleSql`select 1`); }
  async close(): Promise<void> { await closeAdapterSql(this.sql); }
  async dispose(): Promise<void> { await this.close(); }

  async migrate(): Promise<void> {
    await runBootstrapMigrations(this.sql, createDocumentTableSql());
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
    return this.listPageWithPolicy(tenant, doctype, options, true);
  }

  async listForMaintenance(tenant: TenantContext, doctype: DocTypeDefinition, options: ListOptions = {}): Promise<DocumentPage> {
    return this.listPageWithPolicy(tenant, doctype, options, false);
  }

  private async listPageWithPolicy(tenant: TenantContext, doctype: DocTypeDefinition, options: ListOptions, enforceRowPolicy: boolean): Promise<DocumentPage> {
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
    if (enforceRowPolicy) conditions.push(compileRowPolicy(tenant, doctype, "read"));
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
      const cursorValue = sortField?.type === "number" ? Number(lastRow.cursorValue) : lastRow.cursorValue;
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
  if (fieldType === "number" || fieldType === "decimal" || fieldType === "currency") {
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
    const numericComparable = drizzleSql<number>`coalesce((${framekitDocuments.data} ->> ${field})::numeric, 0)`;
    const comparable = fieldType === "number" || fieldType === "decimal" || fieldType === "currency"
      ? numericComparable
      : text;
    if (Array.isArray(filter)) {
      conditions.push(filter.length === 0 ? drizzleSql`false` : or(...filter.map((value) => equalityFilter(field, text, value, fieldType === "decimal" || fieldType === "currency" ? numericComparable : undefined)))!);
      continue;
    }
    if (!filter || typeof filter !== "object") {
      conditions.push(equalityFilter(field, text, filter, fieldType === "decimal" || fieldType === "currency" ? numericComparable : undefined));
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
    if (operator.eq !== undefined) conditions.push(equalityFilter(field, text, operator.eq, fieldType === "decimal" || fieldType === "currency" ? numericComparable : undefined));
    if (operator.ne !== undefined) {
      conditions.push(operator.ne === null
        ? or(drizzleSql`not (${framekitDocuments.data} ? ${field})`, drizzleSql`${framekitDocuments.data} -> ${field} <> 'null'::jsonb` )!
        : or(
            drizzleSql`not (${framekitDocuments.data} ? ${field})`,
            drizzleSql`${framekitDocuments.data} -> ${field} = 'null'::jsonb`,
            fieldType === "decimal" || fieldType === "currency" ? ne(numericComparable, operator.ne) : ne(text, String(operator.ne))
          )!);
    }
    if (operator.in !== undefined) {
      conditions.push(operator.in.length === 0 ? drizzleSql`false` : or(...operator.in.map((value) => equalityFilter(field, text, value, fieldType === "decimal" || fieldType === "currency" ? numericComparable : undefined)))!);
    }
    if (operator.contains !== undefined) {
      conditions.push(drizzleSql`lower(${text}) like ${containsPattern(operator.contains.toLowerCase())} escape '\\'`);
    }
    const present = fieldType === "number" || fieldType === "decimal" || fieldType === "currency"
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

function equalityFilter(field: string, text: SQL<string>, value: unknown, exactComparable?: SQL<number>): SQL {
  if (value === null) return drizzleSql`${framekitDocuments.data} -> ${field} = 'null'::jsonb`;
  return and(
    drizzleSql`${framekitDocuments.data} ? ${field}`,
    drizzleSql`${framekitDocuments.data} -> ${field} <> 'null'::jsonb`,
    exactComparable ? eq(exactComparable, value as string | number) : eq(text, String(value))
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

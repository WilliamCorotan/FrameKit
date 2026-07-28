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
import { framekitDocuments } from "./schema.js";
import type { PostgresMutationUnitOfWorkOptions } from "./types.js";
import { createMutationTablesSql } from "./ddl.js";
import { rowToRecord } from "./document-repository.js";

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

  async replayBatch(tenant: TenantContext, idempotencyKey: string, fingerprint: string): Promise<MutationBatchResult | undefined> {
    const rows = await this.sql<{ fingerprint: string; result: Array<DocumentRecord | null> | null }[]>`
      select fingerprint, result from framekit_idempotency_keys
      where tenant_id = ${tenant.tenantId} and key = ${idempotencyKey} limit 1
    `;
    if (!rows[0]) return undefined;
    assertIdempotencyFingerprint(idempotencyKey, fingerprint, rows[0].fingerprint);
    return { documents: (rows[0].result ?? []).map((document) => document ?? undefined), replayed: true };
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
          const rows = await tx<typeof framekitDocuments.$inferSelect[]>`
            delete from framekit_documents
            where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name}
              and id = ${command.document.id} and revision = ${command.expectedRevision!}
              and (${scope === "all"} or (${scope === "self"} and owner_id = ${command.tenant.userId}))
            returning tenant_id as "tenantId", doctype, id, revision, document_status as "documentStatus", owner_id as "ownerId", state, data,
                      created_at as "createdAt", updated_at as "updatedAt"
          `;
          if (!rows[0]) await throwMutationWriteFailure(tx, command);
          result = rowToRecord(rows[0]!);
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

  async executeBatch(
    commands: MutationCommand[],
    options: { tenant: TenantContext; idempotencyKey?: string; idempotencyFingerprint: string }
  ): Promise<MutationBatchResult> {
    const principalSignature = (tenant: TenantContext) => JSON.stringify({
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      roles: [...tenant.roles].sort(),
      permissions: [...tenant.permissions].sort()
    });
    const expectedPrincipal = principalSignature(options.tenant);
    if (commands.length === 0 || commands.some((command) =>
      principalSignature(command.tenant) !== expectedPrincipal ||
      !["create", "update", "delete"].includes(command.operation)
    )) {
      throw new FramekitError("INVALID_COMMAND", "Atomic command batches must contain supported operations for exactly one authenticated principal.", 422);
    }
    for (const command of commands) {
      assertPermission(command.tenant, command.doctype, command.operation as "create" | "update" | "delete");
      if (command.operation === "create" && ((command.doctype.ownership && command.document.ownerId !== command.tenant.userId) || (!command.doctype.ownership && command.document.ownerId !== undefined))) {
        throw new FramekitError("INVALID_OWNER", "Document owner must be assigned by enabled ownership metadata", 403);
      }
    }
    let activeCommand = commands[0]!;
    try {
      return await this.sql.begin(async (tx) => {
        if (options.idempotencyKey) {
          await tx`select pg_advisory_xact_lock(hashtextextended(${`${options.tenant.tenantId}:${options.idempotencyKey}`}, 0))`;
          const replay = await tx<{ fingerprint: string; result: Array<DocumentRecord | null> | null }[]>`
            select fingerprint, result from framekit_idempotency_keys
            where tenant_id = ${options.tenant.tenantId} and key = ${options.idempotencyKey} limit 1
          `;
          if (replay[0]) {
            assertIdempotencyFingerprint(options.idempotencyKey, options.idempotencyFingerprint, replay[0].fingerprint);
            return { documents: (replay[0].result ?? []).map((document) => document ?? undefined), replayed: true };
          }
        }
        const documents: Array<DocumentRecord | undefined> = [];
        for (const command of commands) {
          activeCommand = command;
          let result: DocumentRecord | undefined;
          if (command.operation === "create") {
            const rows = await tx<typeof framekitDocuments.$inferSelect[]>`
              insert into framekit_documents (tenant_id, doctype, id, revision, document_status, owner_id, state, data, created_at, updated_at)
              values (${command.document.tenantId}, ${command.document.doctype}, ${command.document.id}, ${command.document.revision},
                      ${command.document.documentStatus}, ${command.document.ownerId ?? null}, ${command.document.state ?? null}, ${tx.json(command.document.data as postgres.JSONValue)},
                      ${command.document.createdAt}, ${command.document.updatedAt})
              returning tenant_id as "tenantId", doctype, id, revision, document_status as "documentStatus", owner_id as "ownerId", state, data,
                        created_at as "createdAt", updated_at as "updatedAt"
            `;
            result = rowToRecord(rows[0]!);
            await replaceUniqueValues(tx, command);
          } else if (command.operation === "update") {
            const scope = rowPolicyScope(command.tenant, command.doctype, "write");
            const rows = await tx<typeof framekitDocuments.$inferSelect[]>`
              update framekit_documents set revision = ${command.document.revision}, document_status = ${command.document.documentStatus}, owner_id = ${command.document.ownerId ?? null},
                state = ${command.document.state ?? null}, data = ${tx.json(command.document.data as postgres.JSONValue)}, updated_at = ${command.document.updatedAt}
              where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name}
                and id = ${command.document.id} and revision = ${command.expectedRevision!}
                and (${scope === "all"} or (${scope === "self"} and owner_id = ${command.tenant.userId}))
                and owner_id is not distinct from ${command.document.ownerId ?? null}
              returning tenant_id as "tenantId", doctype, id, revision, document_status as "documentStatus", owner_id as "ownerId", state, data,
                        created_at as "createdAt", updated_at as "updatedAt"
            `;
            if (!rows[0]) await throwMutationWriteFailure(tx, command);
            result = rowToRecord(rows[0]!);
            await replaceUniqueValues(tx, command);
          } else {
            const scope = rowPolicyScope(command.tenant, command.doctype, "write");
            const rows = await tx<typeof framekitDocuments.$inferSelect[]>`
              delete from framekit_documents where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name}
                and id = ${command.document.id} and revision = ${command.expectedRevision!}
                and (${scope === "all"} or (${scope === "self"} and owner_id = ${command.tenant.userId}))
              returning tenant_id as "tenantId", doctype, id, revision, document_status as "documentStatus", owner_id as "ownerId", state, data,
                        created_at as "createdAt", updated_at as "updatedAt"
            `;
            if (!rows[0]) await throwMutationWriteFailure(tx, command);
            result = rowToRecord(rows[0]!);
            await tx`delete from framekit_document_unique_values where tenant_id = ${command.tenant.tenantId} and doctype = ${command.doctype.name} and document_id = ${command.document.id}`;
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
          documents.push(result);
        }
        if (options.idempotencyKey) {
          await tx`
            insert into framekit_idempotency_keys (tenant_id, key, fingerprint, result, created_at)
            values (${options.tenant.tenantId}, ${options.idempotencyKey}, ${options.idempotencyFingerprint},
                    ${tx.json(documents.map((document) => document ?? null) as unknown as postgres.JSONValue)}, now())
          `;
        }
        await this.faultInjector?.("idempotency", activeCommand);
        return { documents, replayed: false };
      });
    } catch (error) {
      throw mapMutationError(error, activeCommand);
    }
  }
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

export function postgresRevisionConflict(doctype: string, id: string, expectedRevision: number, actualRevision: number): FramekitError {
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

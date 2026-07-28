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
import { indexExpressions, indexIdentifier, jsonPathSegment, rollbackFromChange, sqlLiteral, sqlLiteralJson } from "./migration-sql-helpers.js";
import { fixedIndexDdl, fixedSchema, fixedTableDdl } from "./schema-contract.js";

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
  created_at timestamptz not null, updated_at timestamptz not null
);
create unique index if not exists framekit_auth_identity_links_subject on framekit_auth_identity_links (tenant_id, provider_id, subject);
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
${fixedTableDdl(fixedSchema.auditEvents)}
${fixedIndexDdl(fixedSchema.auditEvents)}
create index if not exists framekit_audit_events_lookup on framekit_audit_events (tenant_id, created_at desc);
`;
}

export function createOutboxTableSql(): string {
  return `
${fixedTableDdl(fixedSchema.outboxEvents)}
alter table framekit_outbox_events add column if not exists lease_owner text;
alter table framekit_outbox_events add column if not exists lease_expires_at timestamptz;
alter table framekit_outbox_events add column if not exists next_attempt_at timestamptz;
${fixedIndexDdl(fixedSchema.outboxEvents)}
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
${fixedTableDdl(fixedSchema.customFields)}
${fixedIndexDdl(fixedSchema.customFields)}
create index if not exists framekit_custom_fields_lookup on framekit_custom_fields (tenant_id, doctype);
`;
}

export function createViewTableSql(): string {
  return `
${fixedTableDdl(fixedSchema.views)}
${fixedIndexDdl(fixedSchema.views)}
create index if not exists framekit_views_lookup on framekit_views (tenant_id, doctype, type);
`;
}

export function createSettingValueTableSql(): string {
  return `
create table if not exists framekit_setting_values (
  app_name text not null,
  scope_id text not null,
  key text not null,
  value jsonb not null,
  protected boolean not null default false,
  updated_at timestamptz not null,
  constraint framekit_setting_values_identity unique (app_name, scope_id, key)
);
create index if not exists framekit_setting_values_scope on framekit_setting_values (app_name, scope_id);
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
  conversions jsonb not null default '[]'::jsonb,
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
alter table framekit_migrations add column if not exists conversions jsonb not null default '[]'::jsonb;
alter table framekit_migrations drop constraint if exists framekit_migrations_identity;
create unique index if not exists framekit_migrations_identity on framekit_migrations (tenant_id, app_name, id);
create index if not exists framekit_migrations_lookup on framekit_migrations (tenant_id, applied_at desc);
create table if not exists framekit_migration_runs (
  tenant_id text not null,
  app_name text not null,
  migration_id text not null,
  plan_digest text not null,
  conversion_digest text not null,
  status text not null,
  checkpoint jsonb not null,
  approval jsonb not null,
  attempt_id text,
  error text,
  started_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  constraint framekit_migration_runs_identity unique (tenant_id, app_name, migration_id)
);
alter table framekit_migration_runs add column if not exists attempt_id text;
create index if not exists framekit_migration_runs_status on framekit_migration_runs (tenant_id, app_name, status, updated_at);
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

export async function validateExecutableMigration(plan: MigrationPlan, options: { allowDestructive?: boolean }): Promise<void> {
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
    case "change_collection_schema":
      return [`-- change_collection_schema ${change.doctype}.${change.field}: validate or backfill existing JSONB values before deployment`];
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
    case "add_setting":
      return [`-- add_setting ${change.field}: settings use the shared framekit_setting_values table`];
    case "remove_setting":
      return [`-- remove_setting ${change.field}: explicit operator-reviewed durable value cleanup is required`];
    case "change_setting":
      return [`-- change_setting ${change.field}: explicit operator-reviewed settings value migration is required`];
  }
}

export function executableStatements(statements: string[]): string[] {
  return statements.filter((statement) => !statement.trimStart().startsWith("--"));
}

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
import { fixedIndex, fixedSchema } from "./schema-contract.js";
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
}, (table) => [uniqueIndex("framekit_session_revocations_identity").on(table.sessionId)]);

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
}, (table) => [uniqueIndex(fixedIndex(fixedSchema.auditEvents, "framekit_audit_events_identity").name).on(table.tenantId, table.id)]);

export const framekitOutboxEvents = pgTable("framekit_outbox_events", {
  tenantId: text("tenant_id").notNull(),
  id: text("id").notNull(),
  type: text("type").notNull(),
  topic: text("topic").notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  status: text("status").notNull().$type<OutboxEvent["status"]>(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
}, (table) => [uniqueIndex(fixedIndex(fixedSchema.outboxEvents, "framekit_outbox_events_identity").name).on(table.tenantId, table.id)]);

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
}, (table) => [uniqueIndex(fixedIndex(fixedSchema.customFields, "framekit_custom_fields_identity").name).on(table.tenantId, table.id)]);

export const framekitViews = pgTable("framekit_views", {
  tenantId: text("tenant_id").notNull(),
  id: text("id").notNull(),
  doctype: text("doctype").notNull(),
  type: text("type").notNull().$type<ViewDefinition["type"]>(),
  fields: jsonb("fields").notNull().$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex(fixedIndex(fixedSchema.views, "framekit_views_identity").name).on(table.tenantId, table.id)]);

export const framekitSettingValues = pgTable("framekit_setting_values", {
  appName: text("app_name").notNull(),
  scopeId: text("scope_id").notNull(),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
  protected: boolean("protected").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("framekit_setting_values_identity").on(table.appName, table.scopeId, table.key)]);

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
    conversions: jsonb("conversions").notNull().$type<MigrationConversion[]>().default([]),
    checksum: text("checksum").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull()
  },
  (table) => [uniqueIndex("framekit_migrations_identity").on(table.tenantId, table.appName, table.id)]
);

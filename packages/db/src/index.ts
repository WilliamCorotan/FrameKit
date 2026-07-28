// Public package boundary. Implementation is grouped by persistence concern.
export * from "./schema.js";
export * from "./types.js";
export { PostgresDocumentRepository } from "./document-repository.js";
export { PostgresMutationUnitOfWork } from "./mutation-repository.js";
export {
  PostgresApiTokenStore,
  PostgresAuthAuditStore,
  PostgresAuthIdentityLinkStore,
  PostgresAuthLifecycleTokenStore,
  PostgresOidcAuthorizationStateStore,
  PostgresRoleStore,
  PostgresSessionRevocationStore,
  PostgresUserStore
} from "./auth-adapters.js";
export {
  migrationConversionArtifactDigest,
  PostgresAuditStore,
  PostgresCustomizationStore,
  PostgresMigrationStore,
  PostgresNamingSeriesStore,
  PostgresOutboxStore,
  PostgresRealtimePublisher
} from "./runtime-adapters.js";
export {
  createApiTokenTableSql,
  createAuditTableSql,
  createAuthIdentityLifecycleTablesSql,
  createCustomFieldTableSql,
  createDocumentTableSql,
  createMigrationTableSql,
  createMutationTablesSql,
  createNamingSeriesTableSql,
  createOutboxTableSql,
  createPostgresMigrationSql,
  createPostgresMigrationStatements,
  createPostgresRollbackSql,
  createRealtimeTableSql,
  createRoleTableSql,
  createSessionRevocationTableSql,
  createSettingValueTableSql,
  createUserTableSql,
  createViewTableSql
} from "./ddl.js";

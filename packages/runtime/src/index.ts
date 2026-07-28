// The public surface remains intentionally flat; implementation is organized by
// runtime orchestration, migration planning, queries, and adapter boundaries.
export * from "./internal/types.js";
export {
  addExactDecimals,
  normalizeExactDecimal
} from "./internal/validation.js";
export {
  applyFilters,
  applyListOptions,
  applyListOptionsPage,
  decodeDocumentCursor,
  encodeDocumentCursor,
  sortRecords,
  validateListOptions
} from "./internal/query.js";
export {
  assertDestructiveMigration,
  assertMigrationDrift,
  assertMigrationIdentity,
  assertSupportedMigration,
  createExecutableMigrationArtifact,
  createRollbackMigrationPlan,
  migrationChangeIsDestructive,
  migrationChecksum,
  validateMigrationPlan,
  appSchemaChecksum
} from "./internal/migrations.js";
export {
  InMemoryAttachmentStorage,
  InMemoryAuditStore,
  InMemoryCustomizationStore,
  InMemoryDocumentRepository,
  InMemoryMigrationStore,
  InMemoryMutationUnitOfWork,
  InMemoryNamingSeriesStore,
  InMemoryOutboxStore,
  NoopRealtimePublisher
} from "./internal/adapters/memory.js";
export { createRuntime, FramekitRuntime } from "./internal/runtime.js";

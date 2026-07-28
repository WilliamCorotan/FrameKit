import {
  assertPermission,
  canTransferOwnership,
  CustomFieldSchema,
  defineApp,
  defineDocType,
  DocumentCommandRequestSchema,
  decimalPrecision,
  decimalScale,
  FramekitError,
  getDocType,
  hasRowAccess,
  hasAccess,
  localeFallbackChain,
  resolveTranslation,
  validateSettingValue,
  ViewSchema,
  type AppDefinition,
  type AttachmentMetadata,
  type ChildRecord,
  type CustomFieldDefinition,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentCommandOperation,
  type DocumentCommandRequest,
  type DocumentRecord,
  type FieldDefinition,
  type HookName,
  type OwnerTransferReceipt,
  type SettingDefinition,
  type TenantContext,
  type ViewDefinition
} from "@framekit/core";
export type ListOptions = {
  limit?: number;
  offset?: number;
  cursor?: string;
  fields?: string[];
  search?: string;
  filters?: Record<string, FilterValue>;
  sort?: {
    field: string;
    direction?: "asc" | "desc";
  };
};

export type DocumentPage = {
  items: DocumentRecord[];
  nextCursor?: string;
};

export type FilterPrimitive = string | number | boolean | null;

export type FilterOperator = {
  eq?: FilterPrimitive;
  ne?: FilterPrimitive;
  in?: FilterPrimitive[];
  contains?: string;
  gt?: number | string;
  gte?: number | string;
  lt?: number | string;
  lte?: number | string;
  isNull?: boolean;
};

export type FilterValue = FilterPrimitive | FilterPrimitive[] | FilterOperator;

export type LifecycleResource = {
  start?(signal?: AbortSignal): void | Promise<void>;
  close?(): void | Promise<void>;
  dispose?(): void | Promise<void>;
};

export type DocumentRepository = LifecycleResource & {
  list(tenant: TenantContext, doctype: DocTypeDefinition, options?: ListOptions): Promise<DocumentRecord[]>;
  listPage?(tenant: TenantContext, doctype: DocTypeDefinition, options?: ListOptions): Promise<DocumentPage>;
  listForMaintenance?(tenant: TenantContext, doctype: DocTypeDefinition, options?: ListOptions): Promise<DocumentPage>;
  get(tenant: TenantContext, doctype: DocTypeDefinition, id: string, options?: { access?: "read" | "write" }): Promise<DocumentRecord | undefined>;
  getForOwnerTransfer(tenant: TenantContext, doctype: DocTypeDefinition, id: string): Promise<DocumentRecord | undefined>;
  create(tenant: TenantContext, doctype: DocTypeDefinition, record: DocumentRecord): Promise<DocumentRecord>;
  update(tenant: TenantContext, doctype: DocTypeDefinition, record: DocumentRecord, options?: { expectedRevision?: number }): Promise<DocumentRecord>;
  transferOwner(tenant: TenantContext, doctype: DocTypeDefinition, id: string, ownerId: string, options: { expectedRevision: number; updatedAt: string }): Promise<DocumentRecord>;
  delete(tenant: TenantContext, doctype: DocTypeDefinition, id: string, options?: { expectedRevision?: number }): Promise<void>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type MutationOptions = {
  expectedRevision?: number;
  idempotencyKey?: string;
};

export type MutationCommand = {
  operation: "create" | "update" | "delete" | "transfer_owner";
  tenant: TenantContext;
  doctype: DocTypeDefinition;
  document: DocumentRecord;
  expectedRevision?: number;
  idempotencyKey?: string;
  idempotencyFingerprint: string;
  sideEffects: { audit: AuditEvent; outbox: OutboxEvent } | ((persisted: DocumentRecord) => { audit: AuditEvent; outbox: OutboxEvent });
  afterWrite(persisted?: DocumentRecord): Promise<void>;
};

export type MutationBatchResult = {
  documents: Array<DocumentRecord | undefined>;
  replayed: boolean;
};

export type MutationUnitOfWork = LifecycleResource & {
  execute(command: MutationCommand): Promise<{ document?: DocumentRecord; replayed: boolean }>;
  executeBatch?(commands: MutationCommand[], options: { tenant: TenantContext; idempotencyKey?: string; idempotencyFingerprint: string }): Promise<MutationBatchResult>;
  replayBatch?(tenant: TenantContext, idempotencyKey: string, fingerprint: string): Promise<MutationBatchResult | undefined>;
  replay?(tenant: TenantContext, idempotencyKey: string, fingerprint: string): Promise<{ found: boolean; result?: DocumentRecord }>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type { DocumentCommandOperation, DocumentCommandRequest } from "@framekit/core";

export type DocumentCommandResult = {
  command: string;
  mode: "atomic" | "saga";
  replayed: boolean;
  documents: Array<DocumentRecord | undefined>;
};

export type CommandRowPolicy = (input: {
  tenant: TenantContext;
  command: string;
  operation: DocumentCommandOperation;
  document?: DocumentRecord;
}) => boolean | Promise<boolean>;

export type RepositoryDiagnostics = {
  kind: string;
  durable: boolean;
  features: string[];
};

export type AuditSink = {
  record(event: AuditEvent): Promise<void> | void;
};

export type AuditStore = LifecycleResource & AuditSink & {
  list(tenant: TenantContext, options?: { limit?: number }): Promise<AuditEvent[]>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type AuditEvent = {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  doctype: string;
  documentId: string;
  createdAt: string;
};

export type OutboxEvent = {
  id: string;
  tenantId: string;
  type: string;
  topic: string;
  payload: Record<string, unknown>;
  status: "pending" | "leased" | "dispatched" | "failed" | "dead_letter";
  attempts: number;
  createdAt: string;
  processedAt?: string;
  error?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  nextAttemptAt?: string;
};

export type OutboxClaimOptions = {
  ownerId: string;
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
  now?: string;
};

export type OutboxStore = LifecycleResource & {
  record(event: OutboxEvent): Promise<void> | void;
  list(tenant: TenantContext, options?: { limit?: number; status?: OutboxEvent["status"] }): Promise<OutboxEvent[]>;
  markDispatched(tenant: TenantContext, id: string): Promise<OutboxEvent>;
  markFailed(tenant: TenantContext, id: string, error: string): Promise<OutboxEvent>;
  claim(tenant: TenantContext, options: OutboxClaimOptions): Promise<OutboxEvent[]>;
  acknowledge(tenant: TenantContext, id: string, ownerId: string): Promise<OutboxEvent>;
  reject(tenant: TenantContext, id: string, ownerId: string, error: string, options?: { backoffMs?: number; maxAttempts?: number; now?: string }): Promise<OutboxEvent>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type CustomizationStore = LifecycleResource & {
  listCustomFields(tenant: TenantContext): Promise<CustomFieldDefinition[]>;
  addCustomField(tenant: TenantContext, field: CustomFieldDefinition): Promise<CustomFieldDefinition>;
  listViews(tenant: TenantContext): Promise<ViewDefinition[]>;
  upsertView(tenant: TenantContext, view: ViewDefinition): Promise<ViewDefinition>;
  listSettingValues?(tenant: TenantContext, appName: string): Promise<StoredSettingValue[]>;
  upsertSettingValue?(tenant: TenantContext, value: StoredSettingValue): Promise<StoredSettingValue>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type StoredSettingValue = {
  scopeId: string;
  appName: string;
  key: string;
  value: unknown;
  protected: boolean;
  updatedAt: string;
};

export type SettingsSecretPort = {
  seal(value: string, context: { appName: string; scopeId: string; key: string }): Promise<string> | string;
  unseal(value: string, context: { appName: string; scopeId: string; key: string }): Promise<string> | string;
};

export type PublicSetting = Omit<SettingDefinition, "default"> & {
  value?: string | number | boolean;
  configured: boolean;
  redacted: boolean;
};

export type NamingSeriesStore = LifecycleResource & {
  next(tenant: TenantContext, doctype: DocTypeDefinition, prefix: string, digits: number): Promise<string>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type MigrationChange = {
  kind: "add_doctype" | "remove_doctype" | "add_field" | "remove_field" | "change_field_type" | "change_collection_schema" | "add_index" | "remove_index" | "add_unique_constraint" | "remove_unique_constraint" | "change_row_policy" | "add_setting" | "remove_setting" | "change_setting";
  doctype: string;
  field: string;
  destructive: boolean;
  from?: unknown;
  to?: unknown;
  rollback?: MigrationRollback;
};

export type MigrationRollback = Omit<MigrationChange, "rollback">;

export type MigrationPlan = {
  id: string;
  tenantId: string;
  appName: string;
  fromSchemaChecksum: string;
  toSchemaChecksum: string;
  fromUniqueConstraints: Array<{ doctype: string; field: string }>;
  toUniqueConstraints: Array<{ doctype: string; field: string }>;
  createdAt: string;
  changes: MigrationChange[];
  conversions?: MigrationConversion[];
  checksum: string;
};

export type MigrationConversion = {
  id: string;
  version: number;
  doctype: string;
  field: string;
  fromType: string;
  toType: string;
  parameters: MigrationConversionParameters;
  artifactDigest: string;
};

export type MigrationConversionParameters = null | boolean | number | string | MigrationConversionParameters[] | { [key: string]: MigrationConversionParameters };

export type MigrationApproval = {
  approver: string;
  planDigest: string;
  approvedAt: string;
  outcome: "approved" | "rejected";
};

export type MigrationConversionArtifact = {
  id: string;
  version: number;
  artifactDigest: string;
  convert(value: unknown, document: Readonly<Record<string, unknown>>, parameters: MigrationConversionParameters): unknown | Promise<unknown>;
};

export type OnlineMigrationCheckpoint = {
  conversionIndex: number;
  lastDocumentId?: string;
  processed: number;
};

export type OnlineMigrationRun = {
  tenantId: string;
  appName: string;
  migrationId: string;
  planDigest: string;
  conversionDigest: string;
  status: "pending" | "running" | "failed" | "completed";
  checkpoint: OnlineMigrationCheckpoint;
  approval: MigrationApproval;
  attemptId?: string;
  error?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type OnlineMigrationOptions = {
  approval: MigrationApproval;
  chunkSize?: number;
  lockTimeoutMs?: number;
  maxRetries?: number;
  appliedAt?: string;
};

export type MigrationRecord = MigrationPlan & {
  appliedAt: string;
};

export type ExecutableMigrationArtifact = MigrationPlan & {
  up: MigrationChange[];
  down: MigrationRollback[];
};

export type MigrationStore = LifecycleResource & {
  list(tenant: TenantContext, options?: { appName?: string }): Promise<MigrationRecord[]>;
  record(tenant: TenantContext, migration: MigrationRecord): Promise<MigrationRecord>;
  applyPlan?(tenant: TenantContext, plan: MigrationPlan, options?: { allowDestructive?: boolean; appliedAt?: string }): Promise<MigrationRecord>;
  applyOnlinePlan?(tenant: TenantContext, plan: MigrationPlan, options: OnlineMigrationOptions): Promise<MigrationRecord>;
  getOnlineRun?(tenant: TenantContext, appName: string, migrationId: string): Promise<OnlineMigrationRun | undefined>;
  rollback?(tenant: TenantContext, migration: MigrationRecord, options?: { allowDestructive?: boolean; id?: string; appliedAt?: string }): Promise<MigrationRecord>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type RuntimeRealtimeEvent = {
  cursor?: string;
  channel: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt?: string;
};

export type RealtimePublisher = LifecycleResource & {
  publish(event: RuntimeRealtimeEvent): Promise<void> | void;
  list?(channel: string, options?: { limit?: number; after?: string; order?: "asc" | "desc" }): Promise<RuntimeRealtimeEvent[]> | RuntimeRealtimeEvent[];
  subscribe?(channel: string, listener: (event: RuntimeRealtimeEvent) => void, options?: { signal?: AbortSignal }): Promise<() => void> | (() => void);
  health?(): Promise<{ ok: boolean; details?: Record<string, unknown> }>;
  close?(): Promise<void>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type RuntimeOptions = {
  repository?: DocumentRepository;
  audit?: AuditStore;
  outbox?: OutboxStore;
  customization?: CustomizationStore;
  namingSeries?: NamingSeriesStore;
  migrations?: MigrationStore;
  realtime?: RealtimePublisher;
  mutations?: MutationUnitOfWork;
  commandRowPolicy?: CommandRowPolicy;
  resources?: LifecycleResource[];
  attachmentStorage?: AttachmentStorage;
  idGenerator?: () => string;
  now?: () => Date;
  settingsSecrets?: SettingsSecretPort;
};

export type AttachmentStorage = {
  put(key: string, bytes: Uint8Array, metadata: { contentType: string; lease?: { owner: string; durationMs: number } }): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  releaseLease?(key: string, owner: string): Promise<void>;
  deleteIfUnleased?(key: string, options: { minimumAgeMs: number }): Promise<boolean>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
  close?(): Promise<void>;
};

export type AttachmentUpload = { name: string; contentType: string; bytes: Uint8Array };

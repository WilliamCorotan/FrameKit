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
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type NamingSeriesStore = LifecycleResource & {
  next(tenant: TenantContext, doctype: DocTypeDefinition, prefix: string, digits: number): Promise<string>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type MigrationChange = {
  kind: "add_doctype" | "remove_doctype" | "add_field" | "remove_field" | "change_field_type" | "change_collection_schema" | "add_index" | "remove_index" | "add_unique_constraint" | "remove_unique_constraint" | "change_row_policy";
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
};

export type AttachmentStorage = {
  put(key: string, bytes: Uint8Array, metadata: { contentType: string }): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
  close?(): Promise<void>;
};

export type AttachmentUpload = { name: string; contentType: string; bytes: Uint8Array };

export class FramekitRuntime {
  readonly app: AppDefinition;
  private readonly repository: DocumentRepository;
  private readonly audit: AuditStore;
  private readonly outbox: OutboxStore;
  private readonly customization: CustomizationStore;
  private readonly namingSeries: NamingSeriesStore;
  private readonly migrations: MigrationStore;
  private readonly realtime: RealtimePublisher;
  private readonly mutations?: MutationUnitOfWork;
  private readonly commandRowPolicy?: CommandRowPolicy;
  private readonly attachmentStorage: AttachmentStorage;
  private readonly idGenerator: () => string;
  private readonly now: () => Date;
  private readonly resources: LifecycleResource[];
  private lifecycleState: "created" | "started" | "closing" | "closed" = "created";
  private startPromise?: Promise<void>;
  private closePromise?: Promise<void>;

  constructor(app: AppDefinition, options: RuntimeOptions = {}) {
    this.app = defineApp(app);
    const repository = options.repository ?? new InMemoryDocumentRepository();
    const audit = options.audit ?? new InMemoryAuditStore();
    const outbox = options.outbox ?? new InMemoryOutboxStore();
    this.repository = repository;
    this.audit = audit;
    this.outbox = outbox;
    this.customization = options.customization ?? new InMemoryCustomizationStore();
    this.namingSeries = options.namingSeries ?? new InMemoryNamingSeriesStore();
    this.migrations = options.migrations ?? new InMemoryMigrationStore();
    this.realtime = options.realtime ?? new NoopRealtimePublisher();
    this.attachmentStorage = options.attachmentStorage ?? new InMemoryAttachmentStorage();
    this.mutations = options.mutations ?? (
      repository instanceof InMemoryDocumentRepository && audit instanceof InMemoryAuditStore && outbox instanceof InMemoryOutboxStore
        ? new InMemoryMutationUnitOfWork(repository, audit, outbox)
        : undefined
    );
    this.commandRowPolicy = options.commandRowPolicy;
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
    this.resources = uniqueLifecycleResources([
      repository, audit, outbox, this.customization, this.namingSeries, this.migrations, this.realtime, this.attachmentStorage,
      ...(this.mutations ? [this.mutations] : []), ...(options.resources ?? [])
    ]);
  }

  async start(signal?: AbortSignal): Promise<void> {
    if (this.lifecycleState === "started") return;
    if (this.startPromise) return this.startPromise;
    if (this.lifecycleState !== "created") throw new FramekitError("RUNTIME_CLOSED", "Runtime cannot be started after shutdown.", 503);
    const operation = this.startResources(signal);
    this.startPromise = operation;
    try {
      await operation;
    } finally {
      if (this.startPromise === operation) this.startPromise = undefined;
    }
  }

  async close(): Promise<void> {
    if (this.lifecycleState === "closed") return;
    if (this.closePromise) return this.closePromise;
    const operation = this.closeResources();
    this.closePromise = operation;
    try {
      await operation;
    } finally {
      if (this.closePromise === operation) this.closePromise = undefined;
    }
  }

  async dispose(): Promise<void> { await this.close(); }

  lifecycleStatus(): { state: "created" | "started" | "closing" | "closed"; ready: boolean } {
    return { state: this.lifecycleState, ready: this.lifecycleState === "started" };
  }

  private async startResources(signal?: AbortSignal): Promise<void> {
    const started: LifecycleResource[] = [];
    let starting: LifecycleResource | undefined;
    try {
      for (const resource of this.resources) {
        signal?.throwIfAborted();
        starting = resource;
        await resource.start?.(signal);
        started.push(resource);
        starting = undefined;
      }
      this.lifecycleState = "started";
    } catch (error) {
      try {
        await closeLifecycleResources([...(starting ? [starting] : []), ...started.reverse()]);
      } catch (closeError) {
        throw new AggregateError([error, ...aggregateErrorCauses(closeError)], "Runtime startup and rollback both failed.");
      } finally {
        this.lifecycleState = "closed";
      }
      throw error;
    }
  }

  private async closeResources(): Promise<void> {
    try {
      await this.startPromise;
    } catch {
      return;
    }
    if (this.lifecycleState === "closed") return;
    this.lifecycleState = "closing";
    try {
      await closeLifecycleResources([...this.resources].reverse());
    } finally {
      this.lifecycleState = "closed";
    }
  }

  async metadata(tenant?: TenantContext) {
    const modules = tenant ? await this.modulesWithCustomFields(tenant) : this.app.modules;
    return {
      name: this.app.name,
      version: this.app.version,
      modules: modules.map(({ hooks: _hooks, ...module }) => module)
    };
  }

  async diagnostics() {
    const repository = this.repository.describe ? await this.repository.describe() : { kind: "unknown", durable: false, features: [] };
    const audit = this.audit.describe ? await this.audit.describe() : { kind: "unknown", durable: false, features: [] };
    const outbox = this.outbox.describe ? await this.outbox.describe() : { kind: "unknown", durable: false, features: [] };
    const customization = this.customization.describe ? await this.customization.describe() : { kind: "unknown", durable: false, features: [] };
    const namingSeries = this.namingSeries.describe ? await this.namingSeries.describe() : { kind: "unknown", durable: false, features: [] };
    const migrations = this.migrations.describe ? await this.migrations.describe() : { kind: "unknown", durable: false, features: [] };
    const realtime = this.realtime.describe ? await this.realtime.describe() : { kind: "unknown", durable: false, features: [] };
    const mutations = this.mutations?.describe ? await this.mutations.describe() : { kind: "none", durable: false, features: [] };
    const doctypes = this.app.modules.flatMap((module) => module.doctypes);
    return {
      app: {
        name: this.app.name,
        version: this.app.version
      },
      repository,
      audit,
      outbox,
      customization,
      namingSeries,
      migrations,
      realtime,
      mutations,
      modules: this.app.modules.map((module) => ({
        id: module.id,
        name: module.name,
        doctypes: module.doctypes.length,
        permissions: module.permissions.length,
        jobs: module.jobs.length
      })),
      doctypes: doctypes.map((doctype) => ({
        name: doctype.name,
        label: doctype.label,
        fields: doctype.fields.length,
        permissions: doctype.permissions.length,
        workflow: Boolean(doctype.workflow)
      })),
      warnings: createRuntimeWarnings(repository, audit, outbox, customization, namingSeries, mutations, doctypes)
    };
  }

  async migrationHistory(tenant: TenantContext): Promise<MigrationRecord[]> {
    return this.migrations.list(tenant, { appName: this.app.name });
  }

  async realtimeEvents(tenant: TenantContext, options: { limit?: number; after?: string; order?: "asc" | "desc" } = {}): Promise<RuntimeRealtimeEvent[]> {
    if (!this.realtime.list) {
      return [];
    }
    return this.realtime.list(`tenant:${tenant.tenantId}:documents`, options);
  }

  async subscribeRealtime(tenant: TenantContext, listener: (event: RuntimeRealtimeEvent) => void, options: { signal?: AbortSignal } = {}): Promise<() => void> {
    if (!this.realtime.subscribe) {
      throw new FramekitError("REALTIME_STREAM_UNAVAILABLE", "Realtime streaming is not available for this app.", 501);
    }
    return await this.realtime.subscribe(`tenant:${tenant.tenantId}:documents`, listener, options);
  }

  async planMigration(tenant: TenantContext, nextApp: AppDefinition): Promise<MigrationPlan> {
    const parsed = defineApp(nextApp);
    assertMigrationMetadata(this.app);
    assertMigrationMetadata(parsed);
    const changes: MigrationChange[] = [];
    const currentDocTypes = this.app.modules.flatMap((module) => module.doctypes);
    const nextDocTypes = parsed.modules.flatMap((module) => module.doctypes);
    for (const nextDocType of nextDocTypes) {
      const currentDocType = currentDocTypes.find((doctype) => doctype.name === nextDocType.name);
      if (!currentDocType) {
        changes.push(migrationChange({ kind: "add_doctype", doctype: nextDocType.name, field: "*", destructive: false, to: nextDocType }));
        for (const field of nextDocType.fields) {
          changes.push(migrationChange({ kind: "add_field", doctype: nextDocType.name, field: field.name, destructive: false, to: field }));
          if (field.unique) {
            changes.push(migrationChange({ kind: "add_unique_constraint", doctype: nextDocType.name, field: field.name, destructive: false, to: field.name }));
          }
        }
        for (const index of nextDocType.indexes) {
          changes.push(migrationChange({ kind: "add_index", doctype: nextDocType.name, field: indexKey(index), destructive: false, to: index }));
        }
        continue;
      }
      for (const field of nextDocType.fields) {
        const currentField = currentDocType.fields.find((candidate) => candidate.name === field.name);
        if (!currentField) {
          changes.push(migrationChange({ kind: "add_field", doctype: nextDocType.name, field: field.name, destructive: false, to: field }));
          if (field.unique) {
            changes.push(migrationChange({ kind: "add_unique_constraint", doctype: nextDocType.name, field: field.name, destructive: false, to: field.name }));
          }
        } else if ((field.type === "children" || field.type === "attachments") && currentField.type === field.type && stableJson(currentField) !== stableJson(field)) {
          changes.push(migrationChange({ kind: "change_collection_schema", doctype: nextDocType.name, field: field.name, destructive: true, from: currentField, to: field }));
        } else if (fieldStorageContract(currentField) !== fieldStorageContract(field)) {
          changes.push(migrationChange({
            kind: "change_field_type",
            doctype: nextDocType.name,
            field: field.name,
            destructive: true,
            from: fieldStorageContract(currentField),
            to: fieldStorageContract(field)
          }));
        } else if (currentField.unique !== field.unique) {
          changes.push(migrationChange({
            kind: field.unique ? "add_unique_constraint" : "remove_unique_constraint",
            doctype: nextDocType.name,
            field: field.name,
            destructive: false,
            from: currentField.unique,
            to: field.unique
          }));
        }
      }
      for (const field of currentDocType.fields) {
        if (!nextDocType.fields.some((candidate) => candidate.name === field.name)) {
          changes.push(migrationChange({ kind: "remove_field", doctype: nextDocType.name, field: field.name, destructive: true, from: field }));
          if (field.unique) {
            changes.push(migrationChange({ kind: "remove_unique_constraint", doctype: nextDocType.name, field: field.name, destructive: false, from: field.name }));
          }
        }
      }
      for (const index of nextDocType.indexes) {
        if (!currentDocType.indexes.some((candidate) => indexKey(candidate) === indexKey(index))) {
          changes.push(migrationChange({ kind: "add_index", doctype: nextDocType.name, field: indexKey(index), destructive: false, to: index }));
        }
      }
      for (const index of currentDocType.indexes) {
        if (!nextDocType.indexes.some((candidate) => indexKey(candidate) === indexKey(index))) {
          changes.push(migrationChange({ kind: "remove_index", doctype: nextDocType.name, field: indexKey(index), destructive: false, from: index }));
        }
      }
      const currentPolicy = { ownership: currentDocType.ownership, rowPolicy: currentDocType.rowPolicy };
      const nextPolicy = { ownership: nextDocType.ownership, rowPolicy: nextDocType.rowPolicy };
      if (stableJson(currentPolicy) !== stableJson(nextPolicy)) {
        changes.push(migrationChange({ kind: "change_row_policy", doctype: nextDocType.name, field: "row_policy", destructive: true, from: currentPolicy, to: nextPolicy }));
      }
    }
    for (const currentDocType of currentDocTypes) {
      if (nextDocTypes.some((doctype) => doctype.name === currentDocType.name)) continue;
      for (const index of currentDocType.indexes) {
        changes.push(migrationChange({ kind: "remove_index", doctype: currentDocType.name, field: indexKey(index), destructive: false, from: index }));
      }
      for (const field of currentDocType.fields.filter((candidate) => candidate.unique)) {
        changes.push(migrationChange({ kind: "remove_unique_constraint", doctype: currentDocType.name, field: field.name, destructive: false, from: field.name }));
      }
      changes.push(migrationChange({ kind: "remove_doctype", doctype: currentDocType.name, field: "*", destructive: true, from: currentDocType }));
    }
    const plan = {
      id: this.idGenerator(),
      tenantId: tenant.tenantId,
      appName: parsed.name,
      fromSchemaChecksum: await appSchemaChecksum(this.app),
      toSchemaChecksum: await appSchemaChecksum(parsed),
      fromUniqueConstraints: appUniqueConstraints(this.app),
      toUniqueConstraints: appUniqueConstraints(parsed),
      createdAt: this.now().toISOString(),
      changes
    };
    return { ...plan, checksum: await migrationChecksum(plan) };
  }

  async applyMigration(tenant: TenantContext, plan: MigrationPlan, options: { allowDestructive?: boolean } = {}): Promise<MigrationRecord> {
    await validateMigrationPlan(plan);
    assertMigrationIdentity(tenant, this.app.name, plan);
    const destructive = plan.changes.filter((change) => change.destructive);
    if (destructive.length > 0 && !options.allowDestructive) {
      throw new FramekitError("DESTRUCTIVE_MIGRATION", "Migration contains destructive changes.", 409, destructive);
    }
    if (!this.migrations.applyPlan) {
      throw new FramekitError("MIGRATION_EXECUTOR_UNAVAILABLE", "The configured migration store cannot execute migration plans.", 501);
    }
    return this.migrations.applyPlan(tenant, plan, { ...options, appliedAt: this.now().toISOString() });
  }

  async rollbackMigration(tenant: TenantContext, migration: MigrationRecord, options: { allowDestructive?: boolean; id?: string } = {}): Promise<MigrationRecord> {
    assertMigrationIdentity(tenant, this.app.name, migration);
    if (this.migrations.rollback) {
      return this.migrations.rollback(tenant, migration, { ...options, appliedAt: this.now().toISOString() });
    }
    const plan = await createRollbackMigrationPlan(migration, {
      id: options.id ?? `${migration.id}-rollback`,
      createdAt: this.now().toISOString()
    });
    return this.applyMigration(tenant, plan, options);
  }

  async customFields(tenant: TenantContext): Promise<CustomFieldDefinition[]> {
    return this.customization.listCustomFields(tenant);
  }

  async views(tenant: TenantContext): Promise<ViewDefinition[]> {
    return this.customization.listViews(tenant);
  }

  async upsertView(tenant: TenantContext, input: { doctype: string; type: "list" | "form"; fields: string[] }): Promise<ViewDefinition> {
    const doctype = await this.getEffectiveDocType(tenant, input.doctype);
    const unknown = input.fields.filter((field) => !doctype.fields.some((candidate) => candidate.name === field));
    if (unknown.length > 0) {
      throw new FramekitError("UNKNOWN_VIEW_FIELD", `Unknown fields for ${doctype.name}: ${unknown.join(", ")}`, 422);
    }
    const view = ViewSchema.parse({
      id: `${tenant.tenantId}.${doctype.name}.${input.type}`,
      tenantId: tenant.tenantId,
      doctype: doctype.name,
      type: input.type,
      fields: input.fields
    });
    return this.customization.upsertView(tenant, view);
  }

  async addCustomField(tenant: TenantContext, input: { doctype: string; field: unknown }): Promise<CustomFieldDefinition> {
    const base = getDocType(this.app, input.doctype);
    const parsedField = CustomFieldSchema.shape.field.parse(input.field);
    const effective = await this.getEffectiveDocType(tenant, input.doctype);
    if (effective.fields.some((field) => field.name === parsedField.name)) {
      throw new FramekitError("FIELD_EXISTS", `Field "${parsedField.name}" already exists on ${base.name}`, 409);
    }
    const canonicalDocType = defineDocType({ ...effective, fields: [...effective.fields, parsedField] });
    const canonicalField = canonicalDocType.fields.at(-1)!;
    if (canonicalField.type === "link") getDocType(this.app, canonicalField.linkTo!);
    return this.customization.addCustomField(tenant, {
      id: `${base.name}.${canonicalField.name}`,
      tenantId: tenant.tenantId,
      doctype: base.name,
      field: canonicalField
    });
  }

  async auditTrail(tenant: TenantContext, options?: { limit?: number }): Promise<AuditEvent[]> {
    return this.audit.list(tenant, options);
  }

  async outboxEvents(tenant: TenantContext, options?: { limit?: number; status?: OutboxEvent["status"] }): Promise<OutboxEvent[]> {
    return this.outbox.list(tenant, options);
  }

  async markOutboxDispatched(tenant: TenantContext, id: string): Promise<OutboxEvent> {
    return this.outbox.markDispatched(tenant, id);
  }

  async markOutboxFailed(tenant: TenantContext, id: string, error: string): Promise<OutboxEvent> {
    return this.outbox.markFailed(tenant, id, error);
  }

  async claimOutboxEvents(tenant: TenantContext, options: OutboxClaimOptions): Promise<OutboxEvent[]> {
    return this.outbox.claim(tenant, options);
  }

  async acknowledgeOutboxEvent(tenant: TenantContext, id: string, ownerId: string): Promise<OutboxEvent> {
    return this.outbox.acknowledge(tenant, id, ownerId);
  }

  async rejectOutboxEvent(tenant: TenantContext, id: string, ownerId: string, error: string, options: { backoffMs?: number; maxAttempts?: number; now?: string } = {}): Promise<OutboxEvent> {
    return this.outbox.reject(tenant, id, ownerId, error, options);
  }

  async list(tenant: TenantContext, doctypeName: string, options?: ListOptions): Promise<DocumentRecord[]> {
    return (await this.listPage(tenant, doctypeName, options)).items;
  }

  async listPage(tenant: TenantContext, doctypeName: string, options: ListOptions = {}): Promise<DocumentPage> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "read");
    this.assertListOptions(doctype, options);
    if (this.repository.listPage) return this.repository.listPage(tenant, doctype, options);
    const limit = options.limit ?? 100;
    const items = await this.repository.list(tenant, doctype, { ...options, limit: limit + 1 });
    const hasMore = items.length > limit;
    const pageItems = items.slice(0, limit);
    return {
      items: pageItems,
      nextCursor: hasMore && pageItems.length > 0 ? encodeDocumentCursor(pageItems.at(-1)!, options.sort, doctype) : undefined
    };
  }

  async get(tenant: TenantContext, doctypeName: string, id: string): Promise<DocumentRecord> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "read");
    const document = await this.repository.get(tenant, doctype, id);
    if (!document) {
      throw new FramekitError("DOCUMENT_NOT_FOUND", `No ${doctype.name} document with id "${id}"`, 404);
    }
    return document;
  }

  async create(tenant: TenantContext, doctypeName: string, input: DocumentData, options: Omit<MutationOptions, "expectedRevision"> = {}): Promise<DocumentRecord> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "create");
    if (doctype.ownership && Object.hasOwn(input, "ownerId")) throw new FramekitError("OWNER_IMMUTABLE", "Owner is assigned from the authenticated creator", 403);
    const directManagedField = doctype.fields.find((field) => field.type === "attachments" && Object.hasOwn(input, field.name));
    if (directManagedField) throw new FramekitError("ATTACHMENTS_MANAGED", `Field "${directManagedField.label}" can only change through attachment commands`, 422);
    const fingerprint = mutationFingerprint("create", doctype.name, input);
    const replay = await this.replayMutation(tenant, options.idempotencyKey, fingerprint);
    if (replay) return replay;
    const candidate = { ...input };
    await this.runHooks("beforeValidate", tenant, doctype, undefined, candidate);
    if (doctype.workflow) {
      const suppliedState = candidate[doctype.workflow.field];
      if (suppliedState !== undefined && suppliedState !== doctype.workflow.initialState) {
        throw new FramekitError("INVALID_INITIAL_STATE", `New ${doctype.name} documents must start in "${doctype.workflow.initialState}"`, 422);
      }
      candidate[doctype.workflow.field] = doctype.workflow.initialState;
    }
    const data = this.prepareInput(doctype, candidate, true, {}, input);
    await this.assertLinksExist(tenant, doctype, data);
    await this.assertUniqueFields(tenant, doctype, data);
    const state = doctype.workflow?.initialState;
    const timestamp = this.now().toISOString();
    const document: DocumentRecord = {
      id: await this.createDocumentId(tenant, doctype, data),
      doctype: doctype.name,
      tenantId: tenant.tenantId,
      revision: 1,
      documentStatus: "draft",
      ownerId: doctype.ownership ? tenant.userId : undefined,
      data,
      state,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.runHooks("beforeInsert", tenant, doctype, document, data);
    const audit = this.createAuditEvent(tenant, "create", document);
    const outbox = this.createOutboxEvent(tenant, "created", document);
    const execution = this.mutations
      ? await this.mutations.execute({
          operation: "create",
          tenant,
          doctype,
          document,
          idempotencyKey: options.idempotencyKey,
          idempotencyFingerprint: fingerprint,
          sideEffects: { audit, outbox },
          afterWrite: () => this.runHooks("afterInsert", tenant, doctype, document, data)
        })
      : { document: await this.createWithoutUnitOfWork(tenant, doctype, document, data, audit, outbox), replayed: false };
    const created = execution.document!;
    if (!execution.replayed) await this.publishDocumentEvent(tenant, "created", created);
    return created;
  }

  async update(tenant: TenantContext, doctypeName: string, id: string, input: DocumentData, options: MutationOptions = {}): Promise<DocumentRecord> {
    return this.updateDocument(tenant, doctypeName, id, input, options);
  }

  private async updateDocument(tenant: TenantContext, doctypeName: string, id: string, input: DocumentData, options: MutationOptions = {}, managedFields = new Set<string>()): Promise<DocumentRecord> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "update");
    if (doctype.ownership && Object.hasOwn(input, "ownerId")) throw new FramekitError("OWNER_IMMUTABLE", "Owner changes require transferOwner", 403);
    requireExpectedRevisionForRetry(options);
    const fingerprint = mutationFingerprint("update", doctype.name, { id, input, expectedRevision: options.expectedRevision });
    const replay = await this.replayMutation(tenant, options.idempotencyKey, fingerprint);
    if (replay) return replay;
    const existing = await this.getForWrite(tenant, doctype, id);
    assertDraftDocument(existing, "update");
    const directManagedField = doctype.fields.find((field) => field.type === "attachments" && Object.hasOwn(input, field.name) && !managedFields.has(field.name));
    if (directManagedField) throw new FramekitError("ATTACHMENTS_MANAGED", `Field "${directManagedField.label}" can only change through attachment commands`, 422);
    const candidate = { ...existing.data, ...input };
    await this.runHooks("beforeValidate", tenant, doctype, existing, candidate);
    const data = this.prepareInput(doctype, candidate, false, existing.data, input, managedFields);
    await this.assertLinksExist(tenant, doctype, data);
    await this.assertUniqueFields(tenant, doctype, data, id);
    const expectedRevision = options.expectedRevision ?? existing.revision;
    const updated: DocumentRecord = { ...existing, revision: existing.revision + 1, data, updatedAt: this.now().toISOString() };
    await this.runHooks("beforeUpdate", tenant, doctype, updated, data);
    const audit = this.createAuditEvent(tenant, "update", updated);
    const outbox = this.createOutboxEvent(tenant, "updated", updated);
    const execution = this.mutations
      ? await this.mutations.execute({
          operation: "update",
          tenant,
          doctype,
          document: updated,
          expectedRevision,
          idempotencyKey: options.idempotencyKey,
          idempotencyFingerprint: fingerprint,
          sideEffects: { audit, outbox },
          afterWrite: () => this.runHooks("afterUpdate", tenant, doctype, updated, data)
        })
      : { document: await this.updateWithoutUnitOfWork(tenant, doctype, updated, data, expectedRevision, audit, outbox), replayed: false };
    const saved = execution.document!;
    if (!execution.replayed) await this.publishDocumentEvent(tenant, "updated", saved);
    return saved;
  }

  async delete(tenant: TenantContext, doctypeName: string, id: string, options: MutationOptions = {}): Promise<void> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "delete");
    requireExpectedRevisionForRetry(options);
    const fingerprint = mutationFingerprint("delete", doctype.name, { id, expectedRevision: options.expectedRevision });
    if ((await this.replayMutation(tenant, options.idempotencyKey, fingerprint)) !== undefined) return;
    const existing = await this.getForWrite(tenant, doctype, id);
    assertDraftDocument(existing, "delete");
    const attachmentKeys = doctype.fields.filter((field) => field.type === "attachments")
      .flatMap((field) => attachmentList(existing.data[field.name]).map((attachment) => attachment.storageKey));
    const expectedRevision = options.expectedRevision ?? existing.revision;
    await this.runHooks("beforeDelete", tenant, doctype, existing, existing.data);
    const audit = this.createAuditEvent(tenant, "delete", existing);
    const outbox = this.createOutboxEvent(tenant, "deleted", existing);
    if (this.mutations) {
      const execution = await this.mutations.execute({
        operation: "delete",
        tenant,
        doctype,
        document: existing,
        expectedRevision,
        idempotencyKey: options.idempotencyKey,
        idempotencyFingerprint: fingerprint,
        sideEffects: { audit, outbox },
        afterWrite: () => this.runHooks("afterDelete", tenant, doctype, existing, existing.data)
      });
      if (execution.replayed) return;
    } else {
      await this.deleteWithoutUnitOfWork(tenant, doctype, existing, expectedRevision, audit, outbox);
    }
    await this.publishDocumentEvent(tenant, "deleted", existing);
    await Promise.allSettled(attachmentKeys.map((key) => this.attachmentStorage.delete(key)));
  }

  async transition(tenant: TenantContext, doctypeName: string, id: string, action: string, options: MutationOptions = {}): Promise<DocumentRecord> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "transition");
    requireExpectedRevisionForRetry(options);
    const fingerprint = mutationFingerprint("transition", doctype.name, { id, action, expectedRevision: options.expectedRevision });
    const replay = await this.replayMutation(tenant, options.idempotencyKey, fingerprint);
    if (replay) return replay;
    const workflow = doctype.workflow;
    if (!workflow) {
      throw new FramekitError("WORKFLOW_NOT_DEFINED", `${doctype.name} does not define a workflow`, 400);
    }
    const existing = await this.getForWrite(tenant, doctype, id);
    assertDraftDocument(existing, "transition");
    const currentState = existing.state ?? workflow.initialState;
    const transition = workflow.transitions.find((candidate) => candidate.action === action && candidate.from.includes(currentState));
    if (!transition) {
      throw new FramekitError("INVALID_TRANSITION", `Cannot run "${action}" from "${currentState}"`, 409);
    }
    if (!hasAccess(tenant, transition)) {
      throw new FramekitError("FORBIDDEN", `Missing permission to run transition "${action}"`, 403);
    }
    const candidate = { ...existing.data, [workflow.field]: transition.to };
    await this.runHooks("beforeValidate", tenant, doctype, existing, candidate);
    const data = this.prepareInput(doctype, candidate, false, candidate, {});
    await this.assertLinksExist(tenant, doctype, data);
    await this.assertUniqueFields(tenant, doctype, data, id);
    const updated: DocumentRecord = {
      ...existing,
      revision: existing.revision + 1,
      data,
      state: transition.to,
      updatedAt: this.now().toISOString()
    };
    const expectedRevision = options.expectedRevision ?? existing.revision;
    await this.runHooks("beforeTransition", tenant, doctype, updated, data);
    const audit = this.createAuditEvent(tenant, `transition:${action}`, updated);
    const outbox = this.createOutboxEvent(tenant, `transition.${action}`, updated);
    const execution = this.mutations
      ? await this.mutations.execute({
          operation: "update",
          tenant,
          doctype,
          document: updated,
          expectedRevision,
          idempotencyKey: options.idempotencyKey,
          idempotencyFingerprint: fingerprint,
          sideEffects: { audit, outbox },
          afterWrite: () => this.runHooks("afterTransition", tenant, doctype, updated, data)
        })
      : { document: await this.updateWithoutUnitOfWork(tenant, doctype, updated, data, expectedRevision, audit, outbox, "afterTransition"), replayed: false };
    const saved = execution.document!;
    if (!execution.replayed) await this.publishDocumentEvent(tenant, `transition.${action}`, saved);
    return saved;
  }

  async submit(tenant: TenantContext, doctypeName: string, id: string, options: MutationOptions = {}): Promise<DocumentRecord> {
    return this.changeDocumentStatus(tenant, doctypeName, id, "submit", "submitted", "beforeSubmit", "afterSubmit", options);
  }

  async cancel(tenant: TenantContext, doctypeName: string, id: string, options: MutationOptions = {}): Promise<DocumentRecord> {
    return this.changeDocumentStatus(tenant, doctypeName, id, "cancel", "cancelled", "beforeCancel", "afterCancel", options);
  }

  async transferOwner(tenant: TenantContext, doctypeName: string, id: string, ownerId: string, options: MutationOptions = {}): Promise<OwnerTransferReceipt> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    if (!doctype.ownership) throw new FramekitError("OWNERSHIP_NOT_ENABLED", `${doctype.name} does not enable ownership`, 400);
    assertPermission(tenant, doctype, "transfer_owner");
    if (!canTransferOwnership(tenant, doctype)) {
      throw new FramekitError("FORBIDDEN", `Missing permission to transfer ownership of ${doctype.name}`, 403);
    }
    if (typeof ownerId !== "string" || !ownerId.trim()) throw new FramekitError("INVALID_OWNER", "Owner id must be a non-empty string", 422);
    ownerId = ownerId.trim();
    requireExpectedRevisionForRetry(options);
    const fingerprint = mutationFingerprint("transfer_owner", doctype.name, { id, ownerId, expectedRevision: options.expectedRevision });
    const replay = await this.replayMutation(tenant, options.idempotencyKey, fingerprint);
    if (replay) return ownerTransferReceipt(replay);
    const existing = await this.repository.getForOwnerTransfer(tenant, doctype, id);
    if (!existing) throw new FramekitError("DOCUMENT_NOT_FOUND", `No ${doctype.name} document with id "${id}"`, 404);
    const expectedRevision = options.expectedRevision ?? existing.revision;
    const updated: DocumentRecord = { ...existing, ownerId, revision: existing.revision + 1, updatedAt: this.now().toISOString() };
    await this.runImmutableHooks("beforeOwnerTransfer", tenant, doctype, updated);
    const execution = this.mutations
      ? await this.mutations.execute({
          operation: "transfer_owner", tenant, doctype, document: updated, expectedRevision,
          idempotencyKey: options.idempotencyKey, idempotencyFingerprint: fingerprint,
          sideEffects: (persisted) => ({
            audit: this.createAuditEvent(tenant, "transfer_owner", persisted),
            outbox: this.createOwnerTransferOutboxEvent(tenant, persisted)
          }),
          afterWrite: (persisted) => this.runImmutableHooks("afterOwnerTransfer", tenant, doctype, persisted!)
        })
      : { document: await this.transferOwnerWithoutUnitOfWork(tenant, doctype, updated, expectedRevision), replayed: false };
    const saved = execution.document!;
    if (!execution.replayed) await this.publishOwnerTransferEvent(tenant, saved);
    return ownerTransferReceipt(saved);
  }

  async executeDocumentCommand(tenant: TenantContext, commandId: string, request: DocumentCommandRequest): Promise<DocumentCommandResult> {
    const definition = this.app.modules.flatMap((module) => module.commands).find((command) => command.id === commandId);
    if (!definition) throw new FramekitError("COMMAND_NOT_FOUND", `Unknown document command "${commandId}".`, 404);
    const parsedRequest = DocumentCommandRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw new FramekitError("INVALID_COMMAND_OPERATION", `Command "${commandId}" contains invalid operation data.`, 422, {
        issues: parsedRequest.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      });
    }
    request = parsedRequest.data;
    if (!tenant.permissions.includes("*") && !tenant.permissions.includes(definition.permission)) {
      throw new FramekitError("FORBIDDEN", `Missing permission "${definition.permission}" for command "${commandId}".`, 403);
    }
    if (!Array.isArray(request.operations) || request.operations.length < 1 || request.operations.length > definition.maxOperations) {
      throw new FramekitError("INVALID_COMMAND", `Command "${commandId}" requires between 1 and ${definition.maxOperations} operations.`, 422);
    }
    const targets = new Set<string>();
    for (const operation of request.operations) {
      if (!definition.doctypes.includes(operation.doctype) || !definition.operations.includes(operation.operation)) {
        throw new FramekitError("INVALID_COMMAND_OPERATION", `Command "${commandId}" does not allow ${operation.operation} on ${operation.doctype}.`, 422);
      }
      const target = operation.id ? `${operation.doctype}:${operation.id}` : undefined;
      if (target && targets.has(target)) throw new FramekitError("DUPLICATE_COMMAND_TARGET", `Command targets ${target} more than once.`, 422);
      if (target) targets.add(target);
      if (definition.mode === "saga" && !operation.compensation) {
        throw new FramekitError("COMPENSATION_REQUIRED", `Saga operation ${operation.doctype}:${operation.id ?? "new"} requires compensation metadata.`, 422);
      }
      if (operation.compensation && (
        !definition.doctypes.includes(operation.compensation.doctype) ||
        !definition.operations.includes(operation.compensation.operation)
      )) {
        throw new FramekitError("INVALID_COMMAND_COMPENSATION", `Command "${commandId}" contains a disallowed or incomplete compensation.`, 422);
      }
    }
    const fingerprint = commandFingerprint(tenant, commandId, request.operations);
    if (definition.mode === "atomic") {
      if (!this.mutations?.executeBatch) {
        throw new FramekitError("COMMAND_ATOMICITY_UNAVAILABLE", `Command "${commandId}" requires a batch-capable mutation unit of work.`, 501);
      }
      if (request.idempotencyKey && this.mutations.replayBatch) {
        const replay = await this.mutations.replayBatch(tenant, request.idempotencyKey, fingerprint);
        if (replay) return { command: commandId, mode: "atomic", replayed: true, documents: await this.authorizeCommandReplay(tenant, commandId, request.operations, replay.documents) };
      }
      const commands: MutationCommand[] = [];
      for (const operation of request.operations) commands.push(await this.prepareDocumentCommandMutation(tenant, commandId, operation));
      const execution = await this.mutations.executeBatch(commands, {
        tenant,
        idempotencyKey: request.idempotencyKey,
        idempotencyFingerprint: fingerprint
      });
      const documents = execution.replayed
        ? await this.authorizeCommandReplay(tenant, commandId, request.operations, execution.documents)
        : execution.documents;
      if (!execution.replayed) {
        for (const [index, command] of commands.entries()) {
          await this.publishDocumentEvent(tenant, command.operation === "create" ? "created" : command.operation === "update" ? "updated" : "deleted", execution.documents[index] ?? command.document);
        }
      }
      return { command: commandId, mode: "atomic", replayed: execution.replayed, documents };
    }

    if (!this.mutations) {
      throw new FramekitError("COMMAND_EXECUTION_UNAVAILABLE", `Saga command "${commandId}" requires a mutation unit of work for each local step.`, 501);
    }

    const completed: Array<{ operation: DocumentCommandOperation; document?: DocumentRecord }> = [];
    let allReplayed = Boolean(request.idempotencyKey);
    try {
      for (const [index, operation] of request.operations.entries()) {
        const stepKey = request.idempotencyKey ? `${request.idempotencyKey}:step:${index}` : undefined;
        const stepFingerprint = commandMutationFingerprint(tenant, commandId, operation);
        if (stepKey && this.mutations.replay) {
          if (operation.compensation) {
            const compensationKey = `${request.idempotencyKey}:compensation:${index}`;
            const compensated = await this.mutations.replay(tenant, compensationKey, commandMutationFingerprint(tenant, commandId, operation.compensation));
            if (compensated.found) throw new FramekitError("COMMAND_SAGA_TERMINAL", `Command "${commandId}" was compensated and cannot be resumed with the same idempotency key.`, 409);
          }
          const doctype = await this.getEffectiveDocType(tenant, operation.doctype);
          assertPermission(tenant, doctype, operation.operation);
          const replay = await this.mutations.replay(tenant, stepKey, stepFingerprint);
          if (replay.found) {
            const [authorized] = await this.authorizeCommandReplay(tenant, commandId, [operation], [replay.result]);
            completed.push({ operation, document: authorized });
            continue;
          }
        }
        allReplayed = false;
        const command = await this.prepareDocumentCommandMutation(tenant, commandId, operation, stepKey);
        const execution = await this.mutations!.execute(command);
        completed.push({ operation, document: execution.document });
        if (!execution.replayed) await this.publishDocumentEvent(tenant, command.operation === "create" ? "created" : command.operation === "update" ? "updated" : "deleted", execution.document ?? command.document);
      }
      return { command: commandId, mode: "saga", replayed: allReplayed, documents: completed.map((item) => item.document) };
    } catch (cause) {
      if (cause instanceof FramekitError && (cause.code === "IDEMPOTENCY_KEY_REUSED" || cause.code === "COMMAND_SAGA_TERMINAL")) throw cause;
      const compensationFailures: Array<{ index: number; message: string }> = [];
      for (const [reverseIndex, item] of completed.slice().reverse().entries()) {
        const originalIndex = completed.length - reverseIndex - 1;
        try {
          const compensation = await this.prepareDocumentCommandMutation(
            tenant,
            commandId,
            item.operation.compensation!,
            request.idempotencyKey ? `${request.idempotencyKey}:compensation:${originalIndex}` : undefined
          );
          const execution = await this.mutations!.execute(compensation);
          if (!execution.replayed) await this.publishDocumentEvent(tenant, `compensated.${compensation.operation}`, execution.document ?? compensation.document);
        } catch (error) {
          compensationFailures.push({ index: originalIndex, message: error instanceof Error ? error.message : String(error) });
        }
      }
      throw new FramekitError("COMMAND_SAGA_FAILED", `Command "${commandId}" failed and compensation was attempted.`, 409, {
        cause: cause instanceof Error ? cause.message : String(cause),
        ...(cause instanceof FramekitError ? { causeCode: cause.code, causeDetails: cause.details } : {}),
        compensationFailures
      });
    }
  }

  private async prepareDocumentCommandMutation(
    tenant: TenantContext,
    commandId: string,
    operation: DocumentCommandOperation,
    idempotencyKey?: string
  ): Promise<MutationCommand> {
    const doctype = await this.getEffectiveDocType(tenant, operation.doctype);
    assertPermission(tenant, doctype, operation.operation);
    let document: DocumentRecord;
    let expectedRevision: number | undefined;
    let auditAction: string;
    let outboxAction: string;
    let afterWrite: (persisted?: DocumentRecord) => Promise<void>;
    if (operation.operation === "create") {
      const candidate = { ...(operation.data ?? {}) };
      await this.runHooks("beforeValidate", tenant, doctype, undefined, candidate);
      if (doctype.workflow) {
        const suppliedState = candidate[doctype.workflow.field];
        if (suppliedState !== undefined && suppliedState !== doctype.workflow.initialState) throw new FramekitError("INVALID_INITIAL_STATE", `New ${doctype.name} documents must start in "${doctype.workflow.initialState}"`, 422);
        candidate[doctype.workflow.field] = doctype.workflow.initialState;
      }
      const data = this.prepareInput(doctype, candidate, true, {}, operation.data ?? {});
      await this.assertLinksExist(tenant, doctype, data);
      await this.assertUniqueFields(tenant, doctype, data);
      const timestamp = this.now().toISOString();
      document = {
        id: operation.id ?? await this.createDocumentId(tenant, doctype, data), doctype: doctype.name, tenantId: tenant.tenantId,
        revision: 1, documentStatus: "draft", ownerId: doctype.ownership ? tenant.userId : undefined,
        data, state: doctype.workflow?.initialState, createdAt: timestamp, updatedAt: timestamp
      };
      await this.runHooks("beforeInsert", tenant, doctype, document, data);
      auditAction = "command:create";
      outboxAction = "command.created";
      afterWrite = (persisted) => this.runCommandAfterHook("afterInsert", tenant, doctype, persisted!);
    } else {
      const existing = await this.getForWrite(tenant, doctype, operation.id);
      if (!(await this.commandRowPolicy?.({ tenant, command: commandId, operation, document: existing }) ?? true)) {
        throw new FramekitError("FORBIDDEN", `Row policy denied command "${commandId}" for ${doctype.name} "${existing.id}".`, 403);
      }
      expectedRevision = operation.expectedRevision;
      if (operation.operation === "delete") {
        assertDraftDocument(existing, "delete");
        document = existing;
        await this.runHooks("beforeDelete", tenant, doctype, document, document.data);
        auditAction = "command:delete";
        outboxAction = "command.deleted";
        afterWrite = (persisted) => this.runCommandAfterHook("afterDelete", tenant, doctype, persisted!);
      } else {
        assertDraftDocument(existing, "update");
        const candidate = { ...existing.data, ...(operation.data ?? {}) };
        await this.runHooks("beforeValidate", tenant, doctype, existing, candidate);
        const data = this.prepareInput(doctype, candidate, false, existing.data, operation.data ?? {});
        await this.assertLinksExist(tenant, doctype, data);
        await this.assertUniqueFields(tenant, doctype, data, existing.id);
        document = { ...existing, revision: existing.revision + 1, data, updatedAt: this.now().toISOString() };
        await this.runHooks("beforeUpdate", tenant, doctype, document, data);
        auditAction = "command:update";
        outboxAction = "command.updated";
        afterWrite = (persisted) => this.runCommandAfterHook("afterUpdate", tenant, doctype, persisted!);
      }
    }
    if (!(await this.commandRowPolicy?.({ tenant, command: commandId, operation, document }) ?? true)) {
      throw new FramekitError("FORBIDDEN", `Row policy denied command "${commandId}" for ${doctype.name} "${document.id}".`, 403);
    }
    return {
      operation: operation.operation, tenant, doctype, document, expectedRevision, idempotencyKey,
      idempotencyFingerprint: commandMutationFingerprint(tenant, commandId, operation),
      sideEffects: (persisted) => ({
        audit: this.createAuditEvent(tenant, auditAction, persisted),
        outbox: this.createOutboxEvent(tenant, outboxAction, persisted)
      }),
      afterWrite
    };
  }

  private async authorizeCommandReplay(
    tenant: TenantContext,
    commandId: string,
    operations: DocumentCommandOperation[],
    stored: Array<DocumentRecord | undefined>
  ): Promise<Array<DocumentRecord | undefined>> {
    if (stored.length !== operations.length) throw new FramekitError("COMMAND_REPLAY_UNVERIFIABLE", "Stored command result does not match the reviewed operation count.", 409);
    const authorized: Array<DocumentRecord | undefined> = [];
    for (const [index, operation] of operations.entries()) {
      const doctype = await this.getEffectiveDocType(tenant, operation.doctype);
      assertPermission(tenant, doctype, operation.operation);
      const prior = stored[index];
      if (!prior || prior.tenantId !== tenant.tenantId || prior.doctype !== doctype.name || (operation.id && prior.id !== operation.id)) {
        throw new FramekitError("COMMAND_REPLAY_UNVERIFIABLE", "Stored command result does not match the reviewed operation target.", 409);
      }
      const access = operation.operation === "create" ? "read" : "write";
      if (!hasRowAccess(tenant, doctype, access, prior.ownerId) || !(await this.commandRowPolicy?.({ tenant, command: commandId, operation, document: structuredClone(prior) }) ?? true)) {
        throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${prior.id}" does not exist`, 404);
      }
      authorized.push(structuredClone(prior));
    }
    return authorized;
  }

  async uploadAttachment(tenant: TenantContext, doctypeName: string, id: string, fieldName: string, upload: AttachmentUpload, options: MutationOptions = {}): Promise<AttachmentMetadata> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "update");
    const field = attachmentField(doctype, fieldName);
    if (!upload.name.trim() || !upload.contentType.trim() || upload.bytes.length === 0 || upload.bytes.length > 10 * 1024 * 1024) {
      throw new FramekitError("INVALID_ATTACHMENT", "Attachment name, content type, and 1-10485760 bytes are required", 422);
    }
    const existing = await this.get(tenant, doctypeName, id);
    assertDraftDocument(existing, "upload attachments to");
    const attachmentId = this.idGenerator();
    const storageKey = [tenant.tenantId, doctype.name, id, field.name, attachmentId].map(encodeURIComponent).join("/");
    const metadata: AttachmentMetadata = {
      id: attachmentId, name: upload.name, contentType: upload.contentType, size: upload.bytes.length,
      storageKey, createdAt: this.now().toISOString(), createdBy: tenant.userId
    };
    await this.attachmentStorage.put(storageKey, upload.bytes, { contentType: upload.contentType });
    try {
      const attachments = attachmentList(existing.data[field.name]);
      await this.updateDocument(tenant, doctypeName, id, { [field.name]: [...attachments, metadata] }, options, new Set([field.name]));
      return metadata;
    } catch (error) {
      await this.attachmentStorage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async downloadAttachment(tenant: TenantContext, doctypeName: string, id: string, fieldName: string, attachmentId: string): Promise<{ metadata: AttachmentMetadata; bytes: Uint8Array }> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    attachmentField(doctype, fieldName);
    const document = await this.get(tenant, doctypeName, id);
    const metadata = attachmentList(document.data[fieldName]).find((attachment) => attachment.id === attachmentId);
    if (!metadata) throw new FramekitError("ATTACHMENT_NOT_FOUND", `Attachment "${attachmentId}" does not exist`, 404);
    const bytes = await this.attachmentStorage.get(metadata.storageKey);
    if (!bytes) throw new FramekitError("ATTACHMENT_BYTES_MISSING", `Attachment "${attachmentId}" bytes are unavailable`, 410);
    return { metadata, bytes };
  }

  async deleteAttachment(tenant: TenantContext, doctypeName: string, id: string, fieldName: string, attachmentId: string, options: MutationOptions = {}): Promise<void> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "update");
    const field = attachmentField(doctype, fieldName);
    const document = await this.get(tenant, doctypeName, id);
    assertDraftDocument(document, "delete attachments from");
    const attachments = attachmentList(document.data[field.name]);
    const metadata = attachments.find((attachment) => attachment.id === attachmentId);
    if (!metadata) throw new FramekitError("ATTACHMENT_NOT_FOUND", `Attachment "${attachmentId}" does not exist`, 404);
    await this.updateDocument(tenant, doctypeName, id, { [field.name]: attachments.filter((attachment) => attachment.id !== attachmentId) }, options, new Set([field.name]));
    await this.attachmentStorage.delete(metadata.storageKey);
  }

  async cleanupOrphanAttachments(tenant: TenantContext): Promise<string[]> {
    if (!tenant.permissions.includes("*") && !tenant.permissions.includes("framekit.attachments.cleanup")) {
      throw new FramekitError("FORBIDDEN", "Missing framekit.attachments.cleanup permission", 403);
    }
    const referenced = new Set<string>();
    for (const doctype of this.app.modules.flatMap((module) => module.doctypes)) {
      const attachmentFields = doctype.fields.filter((field) => field.type === "attachments");
      if (attachmentFields.length === 0) continue;
      if (doctype.rowPolicy && !this.repository.listForMaintenance) {
        throw new FramekitError("ATTACHMENT_CLEANUP_UNSUPPORTED", `Repository cannot safely scan row-protected ${doctype.name} attachments`, 501);
      }
      let cursor: string | undefined;
      do {
        const page = this.repository.listForMaintenance
          ? await this.repository.listForMaintenance(tenant, doctype, { cursor, limit: 100 })
          : this.repository.listPage
          ? await this.repository.listPage(tenant, doctype, { cursor, limit: 100 })
          : { items: await this.repository.list(tenant, doctype, { cursor, limit: 100 }), nextCursor: undefined };
        for (const document of page.items) {
          for (const field of attachmentFields) for (const attachment of attachmentList(document.data[field.name])) referenced.add(attachment.storageKey);
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
    const prefix = `${encodeURIComponent(tenant.tenantId)}/`;
    const orphaned = (await this.attachmentStorage.list(prefix)).filter((key) => !referenced.has(key));
    await Promise.all(orphaned.map((key) => this.attachmentStorage.delete(key)));
    return orphaned;
  }

  private async changeDocumentStatus(
    tenant: TenantContext,
    doctypeName: string,
    id: string,
    action: "submit" | "cancel",
    target: "submitted" | "cancelled",
    beforeHook: "beforeSubmit" | "beforeCancel",
    afterHook: "afterSubmit" | "afterCancel",
    options: MutationOptions
  ): Promise<DocumentRecord> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, action);
    requireExpectedRevisionForRetry(options);
    const fingerprint = mutationFingerprint(action, doctype.name, { id, expectedRevision: options.expectedRevision });
    const replay = await this.replayMutation(tenant, options.idempotencyKey, fingerprint);
    if (replay) return replay;
    const existing = await this.getForWrite(tenant, doctype, id);
    const expectedStatus = action === "submit" ? "draft" : "submitted";
    if (existing.documentStatus !== expectedStatus) {
      throw new FramekitError("INVALID_DOCUMENT_STATUS", `Cannot ${action} ${doctype.name} "${id}" from ${existing.documentStatus}`, 409);
    }
    const candidate = { ...existing.data };
    await this.runHooks("beforeValidate", tenant, doctype, existing, candidate);
    const data = this.prepareInput(doctype, candidate, false, candidate, {});
    await this.assertLinksExist(tenant, doctype, data);
    await this.assertUniqueFields(tenant, doctype, data, id);
    const expectedRevision = options.expectedRevision ?? existing.revision;
    const updated: DocumentRecord = {
      ...existing,
      revision: existing.revision + 1,
      documentStatus: target,
      data,
      updatedAt: this.now().toISOString()
    };
    await this.runHooks(beforeHook, tenant, doctype, updated, data);
    const audit = this.createAuditEvent(tenant, action, updated);
    const outbox = this.createOutboxEvent(tenant, target, updated);
    const execution = this.mutations
      ? await this.mutations.execute({
          operation: "update",
          tenant,
          doctype,
          document: updated,
          expectedRevision,
          idempotencyKey: options.idempotencyKey,
          idempotencyFingerprint: fingerprint,
          sideEffects: { audit, outbox },
          afterWrite: () => this.runHooks(afterHook, tenant, doctype, updated, data)
        })
      : { document: await this.updateWithoutUnitOfWork(tenant, doctype, updated, data, expectedRevision, audit, outbox, afterHook), replayed: false };
    const saved = execution.document!;
    if (!execution.replayed) await this.publishDocumentEvent(tenant, target, saved);
    return saved;
  }

  private prepareInput(
    doctype: DocTypeDefinition,
    input: DocumentData,
    inserting: boolean,
    protectedData: DocumentData = {},
    clientInput: DocumentData = input,
    managedFields = new Set<string>()
  ): DocumentData {
    const output: DocumentData = {};
    const fieldNames = new Set(doctype.fields.map((field) => field.name));
    const unknownFields = Object.keys(clientInput).filter((key) => !fieldNames.has(key));
    if (unknownFields.length > 0) {
      throw new FramekitError("FIELD_VALIDATION_FAILED", "One or more fields failed validation.", 422, {
        violations: unknownFields.map((field) => ({ field, rule: "schema", code: "unknown_field" }))
      });
    }
    const computedFields = doctype.fields.filter((field) => field.computed);
    for (const field of computedFields) {
      if (Object.prototype.hasOwnProperty.call(clientInput, field.name)) {
        throw new FramekitError("COMPUTED_FIELD_READ_ONLY", `Computed field "${doctype.name}.${field.name}" cannot be written.`, 422, {
          field: field.name,
          code: "computed_read_only"
        });
      }
    }
    for (const field of doctype.fields) {
      const value = input[field.name] ?? field.default;
      if (field.type === "attachments") {
        if (inserting && value !== undefined && (!Array.isArray(value) || value.length > 0)) {
          throw new FramekitError("ATTACHMENTS_MANAGED", `Field "${field.label}" can only change through attachment commands`, 422);
        }
        output[field.name] = managedFields.has(field.name) ? value ?? [] : protectedData[field.name] ?? [];
        continue;
      }
      if (field.type === "children") {
        output[field.name] = this.normalizeChildren(doctype, field, value ?? [], inserting ? [] : protectedData[field.name]);
        if (field.required && (output[field.name] as ChildRecord[]).length === 0) {
          throw new FramekitError("VALIDATION_FAILED", `Field "${field.label}" requires at least one child row`, 422);
        }
        continue;
      }
      if (field.required && (value === undefined || value === null || value === "")) {
        throw new FramekitError("VALIDATION_FAILED", `Field "${field.label}" is required`, 422);
      }
    }
    for (const field of doctype.fields.filter((candidate) => !candidate.computed && candidate.type !== "children" && candidate.type !== "attachments")) {
      const value = input[field.name] ?? field.default;
      if (field.readOnly && !inserting) {
        if (protectedData[field.name] !== undefined) output[field.name] = protectedData[field.name];
        continue;
      }
      if (value !== undefined) {
        output[field.name] = coerceFieldValue(doctype.name, field, value);
      }
    }
    const pending = new Set(computedFields.map((field) => field.name));
    while (pending.size > 0) {
      const field = computedFields.find((candidate) => pending.has(candidate.name) && candidate.computed!.dependencies.every((dependency) => !pending.has(dependency)));
      if (!field) throw new FramekitError("COMPUTED_FIELD_CYCLE", `Computed field cycle detected on ${doctype.name}.`, 422);
      output[field.name] = computeFieldValue(doctype.name, field, output);
      pending.delete(field.name);
    }
    const violations = doctype.fields.filter((field) => field.type !== "children" && field.type !== "attachments")
      .flatMap((field) => validateFieldValue(doctype.name, field, output[field.name]));
    if (violations.length > 0) {
      throw new FramekitError("FIELD_VALIDATION_FAILED", "One or more fields failed validation.", 422, { violations });
    }
    return output;
  }

  private async getForWrite(tenant: TenantContext, doctype: DocTypeDefinition, id: string): Promise<DocumentRecord> {
    const document = await this.repository.get(tenant, doctype, id, { access: "write" });
    if (!document) throw new FramekitError("DOCUMENT_NOT_FOUND", `No ${doctype.name} document with id "${id}"`, 404);
    return document;
  }

  private normalizeChildren(doctype: DocTypeDefinition, field: DocTypeDefinition["fields"][number], value: unknown, existingValue: unknown): ChildRecord[] {
    if (!Array.isArray(value)) throw new FramekitError("VALIDATION_FAILED", `${doctype.name}.${field.name} must be an array`, 422);
    const existing = new Map((Array.isArray(existingValue) ? existingValue : []).map((row) => [(row as ChildRecord).id, row as ChildRecord]));
    const seen = new Set<string>();
    return value.map((candidate, position) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new FramekitError("VALIDATION_FAILED", `${doctype.name}.${field.name}[${position}] must be an object`, 422);
      const supplied = candidate as Record<string, unknown>;
      const id = typeof supplied.id === "string" ? supplied.id : undefined;
      if (id && (!existing.has(id) || seen.has(id))) throw new FramekitError("INVALID_CHILD_ID", `Child row "${id}" does not belong to this parent`, 422);
      if (id) seen.add(id);
      const rawData = supplied.data && typeof supplied.data === "object" && !Array.isArray(supplied.data) ? supplied.data as DocumentData : supplied;
      const childNames = new Set((field.fields ?? []).map((childField) => childField.name));
      const unknownFields = Object.keys(rawData).filter((key) => !childNames.has(key) && !(rawData === supplied && ["id", "position"].includes(key)));
      if (unknownFields.length > 0) {
        throw new FramekitError("FIELD_VALIDATION_FAILED", "One or more child fields failed validation.", 422, {
          violations: unknownFields.map((name) => ({ field: `${field.name}.${name}`, rule: "schema", code: "unknown_field" }))
        });
      }
      const data: DocumentData = {};
      for (const childField of field.fields ?? []) {
        const childValue = rawData[childField.name] ?? childField.default;
        if (childField.required && (childValue === undefined || childValue === null || childValue === "")) {
          throw new FramekitError("VALIDATION_FAILED", `Child field "${childField.label}" is required`, 422);
        }
        const nestedField = { ...childField, name: `${field.name}.${childField.name}` } as FieldDefinition;
        if (childValue !== undefined) data[childField.name] = coerceFieldValue(doctype.name, nestedField, childValue);
        const violations = validateFieldValue(doctype.name, nestedField, data[childField.name]);
        if (violations.length > 0) throw new FramekitError("FIELD_VALIDATION_FAILED", "One or more child fields failed validation.", 422, { violations });
      }
      return { id: id ?? this.idGenerator(), position, data };
    });
  }

  private assertListOptions(doctype: DocTypeDefinition, options: ListOptions = {}): void {
    validateListOptions(doctype, options);
  }

  private async assertLinksExist(tenant: TenantContext, doctype: DocTypeDefinition, data: DocumentData): Promise<void> {
    for (const field of doctype.fields.filter((candidate) => candidate.type === "link" && candidate.linkTo)) {
      const value = data[field.name];
      if (value === undefined || value === null || value === "") {
        continue;
      }
      const linkedDocType = await this.getEffectiveDocType(tenant, field.linkTo!);
      const linked = await this.repository.get(tenant, linkedDocType, String(value));
      if (!linked) {
        throw new FramekitError("LINK_NOT_FOUND", `${doctype.name}.${field.name} references missing ${linkedDocType.name} "${String(value)}"`, 422, {
          doctype: doctype.name,
          field: field.name,
          linkTo: linkedDocType.name,
          value
        });
      }
    }
    for (const field of doctype.fields.filter((candidate) => candidate.type === "children")) {
      const rows = Array.isArray(data[field.name]) ? data[field.name] as ChildRecord[] : [];
      for (const childField of (field.fields ?? []).filter((candidate) => candidate.type === "link" && candidate.linkTo)) {
        const linkedDocType = await this.getEffectiveDocType(tenant, childField.linkTo!);
        for (const row of rows) {
          const value = row.data[childField.name];
          if (value === undefined || value === null || value === "") continue;
          const linked = await this.repository.get(tenant, linkedDocType, String(value));
          if (!linked) {
            throw new FramekitError("LINK_NOT_FOUND", `${doctype.name}.${field.name}.${childField.name} references missing ${linkedDocType.name} "${String(value)}"`, 422, {
              doctype: doctype.name,
              field: `${field.name}.${childField.name}`,
              linkTo: linkedDocType.name,
              value
            });
          }
        }
      }
    }
  }

  private async assertUniqueFields(tenant: TenantContext, doctype: DocTypeDefinition, data: DocumentData, currentId?: string): Promise<void> {
    for (const field of doctype.fields.filter((candidate) => candidate.unique)) {
      const value = data[field.name];
      if (value === undefined || value === null || value === "") {
        continue;
      }
      const matches = await this.repository.list(tenant, doctype, {
        filters: { [field.name]: { eq: filterPrimitive(value) } },
        limit: 2
      });
      const conflict = matches.find((record) => record.id !== currentId);
      if (conflict) {
        throw new FramekitError("UNIQUE_CONSTRAINT_FAILED", `${doctype.name}.${field.name} must be unique`, 409, {
          doctype: doctype.name,
          field: field.name,
          value
        });
      }
    }
  }

  private async getEffectiveDocType(tenant: TenantContext, doctypeName: string): Promise<DocTypeDefinition> {
    const base = getDocType(this.app, doctypeName);
    const customFields = (await this.customization.listCustomFields(tenant)).filter((field) => field.doctype === base.name);
    const views = (await this.customization.listViews(tenant)).filter((view) => view.doctype === base.name);
    if (customFields.length === 0) {
      return { ...base, views: views.map(({ tenantId: _tenantId, ...view }) => view) };
    }
    return {
      ...base,
      fields: [...base.fields, ...customFields.map((field) => field.field)],
      views: views.map(({ tenantId: _tenantId, ...view }) => view)
    };
  }

  private async modulesWithCustomFields(tenant: TenantContext): Promise<AppDefinition["modules"]> {
    const customFields = await this.customization.listCustomFields(tenant);
    const views = await this.customization.listViews(tenant);
    return this.app.modules.map((module) => ({
      ...module,
      doctypes: module.doctypes.map((doctype) => ({
        ...doctype,
        fields: [
          ...doctype.fields,
          ...customFields.filter((field) => field.doctype === doctype.name).map((field) => field.field)
        ],
        views: views.filter((view) => view.doctype === doctype.name).map(({ tenantId: _tenantId, ...view }) => view)
      }))
    }));
  }

  private async createDocumentId(tenant: TenantContext, doctype: DocTypeDefinition, data: DocumentData): Promise<string> {
    if (doctype.naming.field && typeof data[doctype.naming.field] === "string" && data[doctype.naming.field] !== "") {
      return String(data[doctype.naming.field]).toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
    }
    const prefix = doctype.naming.prefix ?? doctype.name;
    if (doctype.naming.series) {
      return this.namingSeries.next(tenant, doctype, prefix, doctype.naming.digits);
    }
    return `${prefix}-${this.idGenerator().slice(0, 8)}`;
  }

  private async runHooks(name: HookName, tenant: TenantContext, doctype: DocTypeDefinition, document: DocumentRecord | undefined, input: DocumentData): Promise<void> {
    for (const module of this.app.modules) {
      const hooks = module.hooks?.[name]?.[doctype.name] ?? [];
      for (const hook of hooks) {
        await hook({ app: this.app, doctype, tenant, document, input });
      }
    }
  }

  private async runImmutableHooks(name: "beforeOwnerTransfer" | "afterOwnerTransfer", tenant: TenantContext, doctype: DocTypeDefinition, document: DocumentRecord): Promise<void> {
    for (const module of this.app.modules) {
      for (const hook of module.hooks?.[name]?.[doctype.name] ?? []) {
        const snapshot = structuredClone(document);
        await hook({ app: this.app, doctype, tenant, document: snapshot, input: structuredClone(snapshot.data) });
      }
    }
  }

  private async runCommandAfterHook(name: "afterInsert" | "afterUpdate" | "afterDelete", tenant: TenantContext, doctype: DocTypeDefinition, persisted: DocumentRecord): Promise<void> {
    for (const module of this.app.modules) {
      for (const hook of module.hooks?.[name]?.[doctype.name] ?? []) {
        const snapshot = structuredClone(persisted);
        await hook({ app: this.app, doctype, tenant, document: snapshot, input: structuredClone(snapshot.data) });
      }
    }
  }

  private createAuditEvent(tenant: TenantContext, action: string, document: DocumentRecord): AuditEvent {
    return {
      id: this.idGenerator(),
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      action,
      doctype: document.doctype,
      documentId: document.id,
      createdAt: this.now().toISOString()
    };
  }

  private createOutboxEvent(tenant: TenantContext, action: string, document: DocumentRecord): OutboxEvent {
    const createdAt = this.now().toISOString();
    return {
      id: this.idGenerator(),
      tenantId: tenant.tenantId,
      type: `${document.doctype}.${action}`,
      topic: document.doctype,
      payload: {
        id: document.id,
        doctype: document.doctype,
        revision: document.revision,
        documentStatus: document.documentStatus,
        ownerId: document.ownerId,
        state: document.state,
        data: document.data
      },
      status: "pending",
      attempts: 0,
      createdAt
    };
  }

  private createOwnerTransferOutboxEvent(tenant: TenantContext, document: DocumentRecord): OutboxEvent {
    return {
      id: this.idGenerator(), tenantId: tenant.tenantId, type: `${document.doctype}.owner.transferred`, topic: document.doctype,
      payload: { doctype: document.doctype, ...ownerTransferReceipt(document) }, status: "pending", attempts: 0, createdAt: this.now().toISOString()
    };
  }

  private async createWithoutUnitOfWork(
    tenant: TenantContext,
    doctype: DocTypeDefinition,
    document: DocumentRecord,
    data: DocumentData,
    audit: AuditEvent,
    outbox: OutboxEvent
  ): Promise<DocumentRecord> {
    const created = await this.repository.create(tenant, doctype, document);
    await this.runHooks("afterInsert", tenant, doctype, created, data);
    await this.audit.record(audit);
    await this.outbox.record(outbox);
    return created;
  }

  private async updateWithoutUnitOfWork(
    tenant: TenantContext,
    doctype: DocTypeDefinition,
    document: DocumentRecord,
    data: DocumentData,
    expectedRevision: number,
    audit: AuditEvent,
    outbox: OutboxEvent,
    hook: "afterUpdate" | "afterTransition" | "afterSubmit" | "afterCancel" = "afterUpdate"
  ): Promise<DocumentRecord> {
    const saved = await this.repository.update(tenant, doctype, document, { expectedRevision });
    await this.runHooks(hook, tenant, doctype, saved, data);
    await this.audit.record(audit);
    await this.outbox.record(outbox);
    return saved;
  }

  private async transferOwnerWithoutUnitOfWork(tenant: TenantContext, doctype: DocTypeDefinition, document: DocumentRecord, expectedRevision: number): Promise<DocumentRecord> {
    const saved = await this.repository.transferOwner(tenant, doctype, document.id, document.ownerId!, { expectedRevision, updatedAt: document.updatedAt });
    await this.runImmutableHooks("afterOwnerTransfer", tenant, doctype, saved);
    await this.audit.record(this.createAuditEvent(tenant, "transfer_owner", saved));
    await this.outbox.record(this.createOwnerTransferOutboxEvent(tenant, saved));
    return saved;
  }

  private async deleteWithoutUnitOfWork(
    tenant: TenantContext,
    doctype: DocTypeDefinition,
    document: DocumentRecord,
    expectedRevision: number,
    audit: AuditEvent,
    outbox: OutboxEvent
  ): Promise<void> {
    await this.repository.delete(tenant, doctype, document.id, { expectedRevision });
    await this.runHooks("afterDelete", tenant, doctype, document, document.data);
    await this.audit.record(audit);
    await this.outbox.record(outbox);
  }

  private async replayMutation(
    tenant: TenantContext,
    idempotencyKey: string | undefined,
    fingerprint: string
  ): Promise<DocumentRecord | null | undefined> {
    if (!idempotencyKey || !this.mutations?.replay) return undefined;
    const replay = await this.mutations.replay(tenant, idempotencyKey, fingerprint);
    if (!replay.found) return undefined;
    return replay.result ?? null;
  }

  private async publishDocumentEvent(tenant: TenantContext, action: string, document: DocumentRecord): Promise<void> {
    await this.realtime.publish({
      channel: `tenant:${tenant.tenantId}:documents`,
      type: `${document.doctype}.${action}`,
      payload: {
        id: document.id,
        doctype: document.doctype,
        tenantId: tenant.tenantId,
        revision: document.revision,
        state: document.state,
        data: document.data
      }
    });
  }

  private async publishOwnerTransferEvent(tenant: TenantContext, document: DocumentRecord): Promise<void> {
    await this.realtime.publish({
      channel: `tenant:${tenant.tenantId}:documents`, type: `${document.doctype}.owner.transferred`,
      payload: { doctype: document.doctype, ...ownerTransferReceipt(document) }
    });
  }
}

const inMemoryRepositoryCheckpoint = Symbol("inMemoryRepositoryCheckpoint");
const inMemoryRepositoryRestore = Symbol("inMemoryRepositoryRestore");

function fieldStorageContract(field: FieldDefinition): string {
  const exact = field.type === "decimal" || field.type === "currency"
    ? `${field.type}(${decimalPrecision(field)},${decimalScale(field)})`
    : field.type;
  return field.computed ? `${exact}:computed:${JSON.stringify(field.computed)}` : exact;
}

export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly records = new Map<string, DocumentRecord>();

  [inMemoryRepositoryCheckpoint](): Map<string, DocumentRecord> {
    return new Map([...this.records].map(([key, record]) => [key, cloneRecord(record)]));
  }

  [inMemoryRepositoryRestore](snapshot: Map<string, DocumentRecord>): void {
    this.records.clear();
    for (const [key, record] of snapshot) this.records.set(key, cloneRecord(record));
  }

  checkpoint(): Map<string, DocumentRecord> {
    return new Map([...this.records].map(([key, record]) => [key, cloneRecord(record)]));
  }

  rollback(checkpoint: Map<string, DocumentRecord>): void {
    this.records.clear();
    for (const [key, record] of checkpoint) this.records.set(key, cloneRecord(record));
  }

  describe(): RepositoryDiagnostics {
    return {
      kind: "memory",
      durable: false,
      features: ["crud", "search"]
    };
  }

  async list(tenant: TenantContext, doctype: DocTypeDefinition, options: ListOptions = {}): Promise<DocumentRecord[]> {
    return (await this.listPage(tenant, doctype, options)).items;
  }

  async listPage(tenant: TenantContext, doctype: DocTypeDefinition, options: ListOptions = {}): Promise<DocumentPage> {
    validateListOptions(doctype, options);
    const records = [...this.records.values()].filter((record) =>
      record.tenantId === tenant.tenantId && record.doctype === doctype.name && hasRowAccess(tenant, doctype, "read", record.ownerId)
    );
    return applyListOptionsPage(records, options, doctype);
  }

  async listForMaintenance(tenant: TenantContext, doctype: DocTypeDefinition, options: ListOptions = {}): Promise<DocumentPage> {
    validateListOptions(doctype, options);
    const records = [...this.records.values()].filter((record) => record.tenantId === tenant.tenantId && record.doctype === doctype.name);
    return applyListOptionsPage(records, options, doctype);
  }

  async get(tenant: TenantContext, doctype: DocTypeDefinition, id: string, options: { access?: "read" | "write" } = {}): Promise<DocumentRecord | undefined> {
    const record = this.records.get(keyFor(tenant.tenantId, doctype.name, id));
    if (record && !hasRowAccess(tenant, doctype, options.access ?? "read", record.ownerId)) return undefined;
    return record ? { ...record, data: { ...record.data } } : undefined;
  }

  async getForOwnerTransfer(tenant: TenantContext, doctype: DocTypeDefinition, id: string): Promise<DocumentRecord | undefined> {
    if (!canTransferOwnership(tenant, doctype)) return undefined;
    const record = this.records.get(keyFor(tenant.tenantId, doctype.name, id));
    return record ? cloneRecord(record) : undefined;
  }

  async create(tenant: TenantContext, doctype: DocTypeDefinition, record: DocumentRecord): Promise<DocumentRecord> {
    if ((doctype.ownership && record.ownerId !== tenant.userId) || (!doctype.ownership && record.ownerId !== undefined)) {
      throw new FramekitError("INVALID_OWNER", "Document owner must be assigned by enabled ownership metadata", 403);
    }
    const key = keyFor(tenant.tenantId, doctype.name, record.id);
    if (this.records.has(key)) {
      throw new FramekitError("DOCUMENT_EXISTS", `${doctype.name} "${record.id}" already exists`, 409);
    }
    this.assertUnique(tenant, doctype, record);
    this.records.set(key, { ...record, data: { ...record.data } });
    return record;
  }

  async update(tenant: TenantContext, doctype: DocTypeDefinition, record: DocumentRecord, options: { expectedRevision?: number } = {}): Promise<DocumentRecord> {
    const key = keyFor(tenant.tenantId, doctype.name, record.id);
    const existing = this.records.get(key);
    if (!existing) {
      throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${record.id}" does not exist`, 404);
    }
    if (!hasRowAccess(tenant, doctype, "write", existing.ownerId)) throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${record.id}" does not exist`, 404);
    if (record.ownerId !== existing.ownerId) throw new FramekitError("OWNER_IMMUTABLE", "Owner changes require transferOwner", 403);
    if (options.expectedRevision !== undefined && existing.revision !== options.expectedRevision) {
      throw revisionConflict(doctype.name, record.id, options.expectedRevision, existing.revision);
    }
    this.assertUnique(tenant, doctype, record);
    this.records.set(key, { ...record, data: { ...record.data } });
    return record;
  }

  async transferOwner(tenant: TenantContext, doctype: DocTypeDefinition, id: string, ownerId: string, options: { expectedRevision: number; updatedAt: string }): Promise<DocumentRecord> {
    if (!canTransferOwnership(tenant, doctype)) throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${id}" does not exist`, 404);
    const key = keyFor(tenant.tenantId, doctype.name, id);
    const existing = this.records.get(key);
    if (!existing) throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${id}" does not exist`, 404);
    if (existing.revision !== options.expectedRevision) throw revisionConflict(doctype.name, id, options.expectedRevision, existing.revision);
    const transferred = { ...existing, ownerId, revision: existing.revision + 1, updatedAt: options.updatedAt, data: { ...existing.data } };
    this.records.set(key, transferred);
    return cloneRecord(transferred);
  }

  async delete(tenant: TenantContext, doctype: DocTypeDefinition, id: string, options: { expectedRevision?: number } = {}): Promise<void> {
    const key = keyFor(tenant.tenantId, doctype.name, id);
    const existing = this.records.get(key);
    if (!existing) {
      throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${id}" does not exist`, 404);
    }
    if (!hasRowAccess(tenant, doctype, "write", existing.ownerId)) throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${id}" does not exist`, 404);
    if (options.expectedRevision !== undefined && existing.revision !== options.expectedRevision) {
      throw revisionConflict(doctype.name, id, options.expectedRevision, existing.revision);
    }
    this.records.delete(key);
  }

  private assertUnique(tenant: TenantContext, doctype: DocTypeDefinition, record: DocumentRecord): void {
    for (const field of doctype.fields.filter((candidate) => candidate.unique)) {
      const value = record.data[field.name];
      if (value === undefined || value === null || value === "") continue;
      const conflict = [...this.records.values()].find((candidate) =>
        candidate.tenantId === tenant.tenantId &&
        candidate.doctype === doctype.name &&
        candidate.id !== record.id &&
        candidate.data[field.name] === value
      );
      if (conflict) {
        throw new FramekitError("UNIQUE_CONSTRAINT_FAILED", `${doctype.name}.${field.name} must be unique`, 409, {
          doctype: doctype.name,
          field: field.name,
          value
        });
      }
    }
  }
}

export class InMemoryAttachmentStorage implements AttachmentStorage {
  private readonly objects = new Map<string, Uint8Array>();

  describe(): RepositoryDiagnostics {
    return { kind: "memory-attachments", durable: false, features: ["put", "get", "delete", "list"] };
  }

  async put(key: string, bytes: Uint8Array, _metadata: { contentType: string }): Promise<void> {
    this.objects.set(key, new Uint8Array(bytes));
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const bytes = this.objects.get(key);
    return bytes ? new Uint8Array(bytes) : undefined;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}

export class InMemoryAuditStore implements AuditStore {
  private readonly events: AuditEvent[] = [];

  describe(): RepositoryDiagnostics {
    return {
      kind: "memory",
      durable: false,
      features: ["audit"]
    };
  }

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  async list(tenant: TenantContext, options: { limit?: number } = {}): Promise<AuditEvent[]> {
    return this.events
      .filter((event) => event.tenantId === tenant.tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, options.limit ?? 100);
  }

  checkpoint(): number {
    return this.events.length;
  }

  rollback(checkpoint: number): void {
    this.events.length = checkpoint;
  }
}

export class InMemoryOutboxStore implements OutboxStore {
  private readonly events: OutboxEvent[] = [];

  describe(): RepositoryDiagnostics {
    return {
      kind: "memory",
      durable: false,
      features: ["outbox"]
    };
  }

  async record(event: OutboxEvent): Promise<void> {
    this.events.push({ ...event, payload: { ...event.payload } });
  }

  async list(tenant: TenantContext, options: { limit?: number; status?: OutboxEvent["status"] } = {}): Promise<OutboxEvent[]> {
    return this.events
      .filter((event) => event.tenantId === tenant.tenantId && (!options.status || event.status === options.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, options.limit ?? 100)
      .map(cloneOutboxEvent);
  }

  async markDispatched(tenant: TenantContext, id: string): Promise<OutboxEvent> {
    return this.updateStatus(tenant, id, "dispatched");
  }

  async markFailed(tenant: TenantContext, id: string, error: string): Promise<OutboxEvent> {
    return this.updateStatus(tenant, id, "failed", error);
  }

  async claim(tenant: TenantContext, options: OutboxClaimOptions): Promise<OutboxEvent[]> {
    const now = new Date(options.now ?? new Date().toISOString());
    const maxAttempts = options.maxAttempts ?? 5;
    for (const event of this.events) {
      const exhaustedFailure = event.status === "failed" && event.attempts >= maxAttempts;
      const exhaustedLease = event.status === "leased" && event.leaseExpiresAt && new Date(event.leaseExpiresAt) <= now && event.attempts >= maxAttempts;
      if (event.tenantId === tenant.tenantId && (exhaustedFailure || exhaustedLease)) {
        event.status = "dead_letter";
        event.processedAt = now.toISOString();
        event.error ??= exhaustedLease ? "Lease expired after maximum delivery attempts" : "Maximum delivery attempts exhausted";
        event.leaseOwner = undefined;
        event.leaseExpiresAt = undefined;
      }
    }
    const events = this.events
      .filter((event) => event.tenantId === tenant.tenantId && event.attempts < maxAttempts && (
        event.status === "pending" ||
        (event.status === "failed" && (!event.nextAttemptAt || new Date(event.nextAttemptAt) <= now)) ||
        (event.status === "leased" && Boolean(event.leaseExpiresAt) && new Date(event.leaseExpiresAt!) <= now)
      ))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, options.limit ?? 100);
    for (const event of events) {
      event.status = "leased";
      event.attempts += 1;
      event.leaseOwner = options.ownerId;
      event.leaseExpiresAt = new Date(now.getTime() + (options.leaseMs ?? 30_000)).toISOString();
      event.nextAttemptAt = undefined;
    }
    return events.map(cloneOutboxEvent);
  }

  async acknowledge(tenant: TenantContext, id: string, ownerId: string): Promise<OutboxEvent> {
    const event = this.assertLease(tenant, id, ownerId);
    event.status = "dispatched";
    event.processedAt = new Date().toISOString();
    event.error = undefined;
    event.leaseOwner = undefined;
    event.leaseExpiresAt = undefined;
    return cloneOutboxEvent(event);
  }

  async reject(tenant: TenantContext, id: string, ownerId: string, error: string, options: { backoffMs?: number; maxAttempts?: number; now?: string } = {}): Promise<OutboxEvent> {
    const event = this.assertLease(tenant, id, ownerId);
    const now = new Date(options.now ?? new Date().toISOString());
    event.status = event.attempts >= (options.maxAttempts ?? 5) ? "dead_letter" : "failed";
    event.error = error;
    event.processedAt = now.toISOString();
    event.nextAttemptAt = event.status === "failed" ? new Date(now.getTime() + (options.backoffMs ?? 0)).toISOString() : undefined;
    event.leaseOwner = undefined;
    event.leaseExpiresAt = undefined;
    return cloneOutboxEvent(event);
  }

  private assertLease(tenant: TenantContext, id: string, ownerId: string): OutboxEvent {
    const event = this.events.find((candidate) => candidate.tenantId === tenant.tenantId && candidate.id === id);
    if (!event) throw new FramekitError("OUTBOX_EVENT_NOT_FOUND", `No outbox event with id "${id}"`, 404);
    if (event.status !== "leased" || event.leaseOwner !== ownerId) {
      throw new FramekitError("OUTBOX_LEASE_LOST", `Outbox event "${id}" is not leased by "${ownerId}"`, 409);
    }
    return event;
  }

  private updateStatus(tenant: TenantContext, id: string, status: OutboxEvent["status"], error?: string): OutboxEvent {
    const event = this.events.find((candidate) => candidate.tenantId === tenant.tenantId && candidate.id === id);
    if (!event) {
      throw new FramekitError("OUTBOX_EVENT_NOT_FOUND", `No outbox event with id "${id}"`, 404);
    }
    event.status = status;
    event.attempts += 1;
    event.processedAt = new Date().toISOString();
    event.error = error;
    event.leaseOwner = undefined;
    event.leaseExpiresAt = undefined;
    return cloneOutboxEvent(event);
  }

  checkpoint(): number {
    return this.events.length;
  }

  rollback(checkpoint: number): void {
    this.events.length = checkpoint;
  }
}

function cloneOutboxEvent(event: OutboxEvent): OutboxEvent {
  return { ...event, payload: { ...event.payload } };
}

export class InMemoryMutationUnitOfWork implements MutationUnitOfWork {
  private readonly idempotency = new Map<string, { fingerprint: string; result?: DocumentRecord }>();
  private readonly batchIdempotency = new Map<string, { fingerprint: string; documents: Array<DocumentRecord | undefined> }>();
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: InMemoryDocumentRepository,
    private readonly audit: InMemoryAuditStore,
    private readonly outbox: InMemoryOutboxStore
  ) {}

  describe(): RepositoryDiagnostics {
    return {
      kind: "memory",
      durable: false,
      features: ["atomic-mutations", "optimistic-concurrency", "uniqueness", "idempotency"]
    };
  }

  async replay(tenant: TenantContext, idempotencyKey: string, fingerprint: string): Promise<{ found: boolean; result?: DocumentRecord }> {
    const batch = this.batchIdempotency.get(`${tenant.tenantId}:${idempotencyKey}`);
    if (batch) assertMemoryIdempotencyFingerprint(idempotencyKey, fingerprint, batch.fingerprint);
    const replay = this.idempotency.get(`${tenant.tenantId}:${idempotencyKey}`);
    if (!replay) return { found: false };
    assertMemoryIdempotencyFingerprint(idempotencyKey, fingerprint, replay.fingerprint);
    return replay.result ? { found: true, result: cloneRecord(replay.result) } : { found: true };
  }

  async replayBatch(tenant: TenantContext, idempotencyKey: string, fingerprint: string): Promise<MutationBatchResult | undefined> {
    const single = this.idempotency.get(`${tenant.tenantId}:${idempotencyKey}`);
    if (single) assertMemoryIdempotencyFingerprint(idempotencyKey, fingerprint, single.fingerprint);
    const replay = this.batchIdempotency.get(`${tenant.tenantId}:${idempotencyKey}`);
    if (!replay) return undefined;
    assertMemoryIdempotencyFingerprint(idempotencyKey, fingerprint, replay.fingerprint);
    return { documents: replay.documents.map((document) => document ? cloneRecord(document) : undefined), replayed: true };
  }

  async execute(command: MutationCommand): Promise<{ document?: DocumentRecord; replayed: boolean }> {
    const idempotencyKey = command.idempotencyKey ? `${command.tenant.tenantId}:${command.idempotencyKey}` : undefined;
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous.catch(() => undefined);
    try {
      return await this.executeUnlocked(command, idempotencyKey);
    } finally {
      release();
    }
  }

  async executeBatch(commands: MutationCommand[], options: { tenant: TenantContext; idempotencyKey?: string; idempotencyFingerprint: string }): Promise<MutationBatchResult> {
    const key = options.idempotencyKey ? `${options.tenant.tenantId}:${options.idempotencyKey}` : undefined;
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous.catch(() => undefined);
    try {
      if (key) {
        const singleReplay = this.idempotency.get(key);
        if (singleReplay) assertMemoryIdempotencyFingerprint(options.idempotencyKey!, options.idempotencyFingerprint, singleReplay.fingerprint);
        const replay = this.batchIdempotency.get(key);
        if (replay) {
          assertMemoryIdempotencyFingerprint(options.idempotencyKey!, options.idempotencyFingerprint, replay.fingerprint);
          return { documents: replay.documents.map((document) => document ? cloneRecord(document) : undefined), replayed: true };
        }
      }
      const repositoryCheckpoint = this.repository.checkpoint();
      const auditCheckpoint = this.audit.checkpoint();
      const outboxCheckpoint = this.outbox.checkpoint();
      try {
        const documents: Array<DocumentRecord | undefined> = [];
        for (const command of commands) documents.push((await this.executeUnlocked(command)).document);
        if (key) this.batchIdempotency.set(key, {
          fingerprint: options.idempotencyFingerprint,
          documents: documents.map((document) => document ? cloneRecord(document) : undefined)
        });
        return { documents, replayed: false };
      } catch (error) {
        this.repository.rollback(repositoryCheckpoint);
        this.audit.rollback(auditCheckpoint);
        this.outbox.rollback(outboxCheckpoint);
        throw error;
      }
    } finally {
      release();
    }
  }

  private async executeUnlocked(command: MutationCommand, idempotencyKey?: string): Promise<{ document?: DocumentRecord; replayed: boolean }> {
    if (idempotencyKey) {
      const batchReplay = this.batchIdempotency.get(idempotencyKey);
      if (batchReplay) assertMemoryIdempotencyFingerprint(command.idempotencyKey!, command.idempotencyFingerprint, batchReplay.fingerprint);
      const replay = this.idempotency.get(idempotencyKey);
      if (replay) {
        assertMemoryIdempotencyFingerprint(command.idempotencyKey!, command.idempotencyFingerprint, replay.fingerprint);
        return { document: replay.result ? cloneRecord(replay.result) : undefined, replayed: true };
      }
    }
    const repositoryState = this.repository[inMemoryRepositoryCheckpoint]();
    const auditCheckpoint = this.audit.checkpoint();
    const outboxCheckpoint = this.outbox.checkpoint();
    let wrote = false;
    try {
      let result: DocumentRecord | undefined;
      if (command.operation === "create") {
        result = await this.repository.create(command.tenant, command.doctype, command.document);
      } else if (command.operation === "update") {
        result = await this.repository.update(command.tenant, command.doctype, command.document, { expectedRevision: command.expectedRevision });
      } else if (command.operation === "transfer_owner") {
        result = await this.repository.transferOwner(command.tenant, command.doctype, command.document.id, command.document.ownerId!, { expectedRevision: command.expectedRevision!, updatedAt: command.document.updatedAt });
      } else {
        await this.repository.delete(command.tenant, command.doctype, command.document.id, { expectedRevision: command.expectedRevision });
        result = cloneRecord(command.document);
      }
      wrote = true;
      await command.afterWrite(result);
      const sideEffects = typeof command.sideEffects === "function" ? command.sideEffects(result!) : command.sideEffects;
      await this.audit.record(sideEffects.audit);
      await this.outbox.record(sideEffects.outbox);
      if (idempotencyKey) this.idempotency.set(idempotencyKey, { fingerprint: command.idempotencyFingerprint, result: result && cloneRecord(result) });
      return { document: result, replayed: false };
    } catch (error) {
      this.audit.rollback(auditCheckpoint);
      this.outbox.rollback(outboxCheckpoint);
      if (wrote) this.repository[inMemoryRepositoryRestore](repositoryState);
      throw error;
    }
  }
}

export class InMemoryCustomizationStore implements CustomizationStore {
  private readonly fields: CustomFieldDefinition[] = [];
  private readonly views: ViewDefinition[] = [];

  describe(): RepositoryDiagnostics {
    return {
      kind: "memory",
      durable: false,
      features: ["custom-fields", "views"]
    };
  }

  async listCustomFields(tenant: TenantContext): Promise<CustomFieldDefinition[]> {
    return this.fields.filter((field) => field.tenantId === tenant.tenantId).map((field) => ({ ...field, field: { ...field.field } }));
  }

  async addCustomField(_tenant: TenantContext, field: CustomFieldDefinition): Promise<CustomFieldDefinition> {
    if (this.fields.some((candidate) => candidate.tenantId === field.tenantId && candidate.id === field.id)) {
      throw new FramekitError("CUSTOM_FIELD_EXISTS", `Custom field "${field.id}" already exists`, 409);
    }
    this.fields.push({ ...field, field: { ...field.field } });
    return field;
  }

  async listViews(tenant: TenantContext): Promise<ViewDefinition[]> {
    return this.views.filter((view) => view.tenantId === tenant.tenantId).map((view) => ({ ...view, fields: [...view.fields] }));
  }

  async upsertView(_tenant: TenantContext, view: ViewDefinition): Promise<ViewDefinition> {
    const index = this.views.findIndex((candidate) => candidate.tenantId === view.tenantId && candidate.id === view.id);
    if (index >= 0) {
      this.views[index] = { ...view, fields: [...view.fields] };
    } else {
      this.views.push({ ...view, fields: [...view.fields] });
    }
    return view;
  }
}

export class InMemoryNamingSeriesStore implements NamingSeriesStore {
  private readonly counters = new Map<string, number>();

  describe(): RepositoryDiagnostics {
    return {
      kind: "memory",
      durable: false,
      features: ["naming-series"]
    };
  }

  async next(tenant: TenantContext, _doctype: DocTypeDefinition, prefix: string, digits: number): Promise<string> {
    const key = `${tenant.tenantId}:${prefix}`;
    const nextValue = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, nextValue);
    return `${prefix}-${String(nextValue).padStart(digits, "0")}`;
  }
}

export class InMemoryMigrationStore implements MigrationStore {
  private readonly records: MigrationRecord[] = [];
  private applyTail: Promise<void> = Promise.resolve();

  describe(): RepositoryDiagnostics {
    return {
      kind: "memory",
      durable: false,
      features: ["migration-history"]
    };
  }

  async list(tenant: TenantContext, options: { appName?: string } = {}): Promise<MigrationRecord[]> {
    return this.records
      .filter((record) => record.tenantId === tenant.tenantId && (!options.appName || record.appName === options.appName))
      .map(cloneMigrationRecord);
  }

  async record(tenant: TenantContext, migration: MigrationRecord): Promise<MigrationRecord> {
    assertMigrationIdentity(tenant, migration.appName, migration);
    const saved = { ...migration, tenantId: tenant.tenantId, changes: migration.changes.map((change) => ({ ...change })) };
    this.records.push(saved);
    return cloneMigrationRecord(saved);
  }

  async applyPlan(tenant: TenantContext, plan: MigrationPlan, options: { allowDestructive?: boolean; appliedAt?: string } = {}): Promise<MigrationRecord> {
    const previous = this.applyTail;
    let release!: () => void;
    this.applyTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      await validateMigrationPlan(plan);
      assertMigrationIdentity(tenant, plan.appName, plan);
      assertDestructiveMigration(plan, options);
      assertSupportedMigration(plan);
      const existing = this.records.find((record) => record.tenantId === tenant.tenantId && record.appName === plan.appName && record.id === plan.id);
      if (existing) {
        if (existing.checksum === plan.checksum) return cloneMigrationRecord(existing);
        throw new FramekitError("MIGRATION_ID_CONFLICT", `Migration ID "${plan.id}" was already applied with a different checksum.`, 409);
      }
      const latest = this.records.filter((record) => record.tenantId === tenant.tenantId && record.appName === plan.appName).at(-1);
      assertMigrationDrift(latest, plan);
      const record: MigrationRecord = { ...plan, appliedAt: options.appliedAt ?? new Date().toISOString() };
      return this.record(tenant, record);
    } finally {
      release();
    }
  }

  async rollback(tenant: TenantContext, migration: MigrationRecord, options: { allowDestructive?: boolean; id?: string; appliedAt?: string } = {}): Promise<MigrationRecord> {
    const plan = await createRollbackMigrationPlan(migration, { id: options.id, createdAt: options.appliedAt });
    return this.applyPlan(tenant, plan, options);
  }
}

export class NoopRealtimePublisher implements RealtimePublisher {
  describe(): RepositoryDiagnostics {
    return {
      kind: "none",
      durable: false,
      features: []
    };
  }

  publish(): void {
    return undefined;
  }

  list(): RuntimeRealtimeEvent[] {
    return [];
  }
}

export function createRuntime(app: AppDefinition, options?: RuntimeOptions): FramekitRuntime {
  return new FramekitRuntime(app, options);
}

function ownerTransferReceipt(document: DocumentRecord): OwnerTransferReceipt {
  return { id: document.id, ownerId: document.ownerId!, revision: document.revision, updatedAt: document.updatedAt };
}

function keyFor(tenantId: string, doctype: string, id: string): string {
  return `${tenantId}:${doctype}:${id}`;
}

function revisionConflict(doctype: string, id: string, expectedRevision: number, actualRevision: number): FramekitError {
  return new FramekitError("REVISION_CONFLICT", `${doctype} "${id}" changed since it was read`, 409, {
    doctype,
    id,
    expectedRevision,
    actualRevision
  });
}

function mutationFingerprint(operation: string, doctype: string, value: unknown): string {
  return JSON.stringify({ operation, doctype, value }, (_key, candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    return Object.fromEntries(Object.entries(candidate).sort(([left], [right]) => left.localeCompare(right)));
  });
}

function commandFingerprint(tenant: TenantContext, commandId: string, operations: DocumentCommandOperation[]): string {
  return mutationFingerprint(`command:${commandId}`, commandId, {
    principal: commandPrincipal(tenant),
    operations
  });
}

function commandMutationFingerprint(tenant: TenantContext, commandId: string, operation: NonNullable<DocumentCommandOperation["compensation"]> | DocumentCommandOperation): string {
  return mutationFingerprint(`command:${commandId}:${operation.operation}`, operation.doctype, {
    principal: commandPrincipal(tenant),
    operation
  });
}

function commandPrincipal(tenant: TenantContext): Record<string, unknown> {
  return {
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    roles: [...tenant.roles].sort(),
    permissions: [...tenant.permissions].sort()
  };
}

function assertDraftDocument(document: DocumentRecord, action: string): void {
  if (document.documentStatus !== "draft") {
    throw new FramekitError("DOCUMENT_NOT_DRAFT", `Cannot ${action} ${document.doctype} "${document.id}" after submission`, 409);
  }
}

function attachmentField(doctype: DocTypeDefinition, fieldName: string): DocTypeDefinition["fields"][number] {
  const field = doctype.fields.find((candidate) => candidate.name === fieldName && candidate.type === "attachments");
  if (!field) throw new FramekitError("ATTACHMENT_FIELD_NOT_FOUND", `${doctype.name}.${fieldName} is not an attachment field`, 404);
  return field;
}

function attachmentList(value: unknown): AttachmentMetadata[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is AttachmentMetadata => Boolean(
    candidate && typeof candidate === "object" && typeof (candidate as AttachmentMetadata).id === "string" &&
    typeof (candidate as AttachmentMetadata).storageKey === "string"
  ));
}

function requireExpectedRevisionForRetry(options: MutationOptions): void {
  if (options.idempotencyKey && options.expectedRevision === undefined) {
    throw new FramekitError(
      "IDEMPOTENCY_REQUIRES_REVISION",
      "Retried update, delete, and transition commands require expectedRevision.",
      422
    );
  }
}

function cloneRecord(record: DocumentRecord): DocumentRecord {
  return { ...record, data: { ...record.data } };
}

function assertMemoryIdempotencyFingerprint(key: string, expected: string, actual: string): void {
  if (expected !== actual) {
    throw new FramekitError("IDEMPOTENCY_KEY_REUSED", `Idempotency key "${key}" was already used for another command`, 409, { key });
  }
}

function migrationChange(change: Omit<MigrationChange, "rollback">): MigrationChange {
  if (change.kind === "remove_doctype" || change.kind === "remove_field") return { ...change };
  return { ...change, rollback: rollbackFor(change) };
}

function rollbackFor(change: Omit<MigrationChange, "rollback">): MigrationRollback {
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
    case "change_collection_schema":
      return { kind: "change_collection_schema", doctype: change.doctype, field: change.field, destructive: true, from: change.to, to: change.from };
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

export async function migrationChecksum(plan: Pick<MigrationPlan, "tenantId" | "appName" | "fromSchemaChecksum" | "toSchemaChecksum" | "fromUniqueConstraints" | "toUniqueConstraints" | "changes" | "conversions">): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson({
    tenantId: plan.tenantId,
    appName: plan.appName,
    fromSchemaChecksum: plan.fromSchemaChecksum,
    toSchemaChecksum: plan.toSchemaChecksum,
    fromUniqueConstraints: plan.fromUniqueConstraints,
    toUniqueConstraints: plan.toUniqueConstraints,
    changes: plan.changes,
    ...(plan.conversions ? { conversions: plan.conversions } : {})
  })));
  return base64Url(new Uint8Array(digest));
}

export async function validateMigrationPlan(plan: MigrationPlan): Promise<void> {
  if (!plan.id || !plan.tenantId || !plan.appName || !plan.fromSchemaChecksum || !plan.toSchemaChecksum ||
      !Array.isArray(plan.fromUniqueConstraints) || !Array.isArray(plan.toUniqueConstraints) || !Array.isArray(plan.changes)) {
    throw new FramekitError("INVALID_MIGRATION_PLAN", "Migration plan identity, schema checksums, uniqueness metadata, and changes are required.", 422);
  }
  const identifier = /^[a-z][a-z0-9_]*$/;
  const changeKinds = new Set(["add_doctype", "remove_doctype", "add_field", "remove_field", "change_field_type", "change_collection_schema", "add_index", "remove_index", "add_unique_constraint", "remove_unique_constraint", "change_row_policy"]);
  const constraints = [...plan.fromUniqueConstraints, ...plan.toUniqueConstraints];
  if (constraints.some((constraint) => !constraint || !identifier.test(constraint.doctype) || !identifier.test(constraint.field))) {
    throw new FramekitError("INVALID_MIGRATION_PLAN", "Migration uniqueness metadata contains an invalid DocType or field identifier.", 422);
  }
  for (const change of plan.changes) {
    if (!change || !changeKinds.has(change.kind) || !identifier.test(change.doctype) || typeof change.field !== "string") {
      throw new FramekitError("INVALID_MIGRATION_PLAN", "Migration changes contain an invalid DocType or field identifier.", 422);
    }
    const fields = change.field === "*" ? ["*"] : change.field.split(",");
    if (fields.some((field) => field !== "*" && !identifier.test(field))) {
      throw new FramekitError("INVALID_MIGRATION_PLAN", `Migration change ${change.kind} contains an invalid field identifier.`, 422);
    }
    if (change.destructive !== migrationChangeIsDestructive(change)) {
      throw new FramekitError("INVALID_MIGRATION_PLAN", `Migration change ${change.kind} has an invalid destructive classification.`, 422);
    }
    if (change.rollback && change.rollback.destructive !== migrationChangeIsDestructive(change.rollback)) {
      throw new FramekitError("INVALID_MIGRATION_PLAN", `Rollback for ${change.kind} has an invalid destructive classification.`, 422);
    }
  }
  if (plan.conversions) {
    const conversionKeys = new Set<string>();
    for (const conversion of plan.conversions) {
      const key = `${conversion.doctype}.${conversion.field}`;
      if (!conversion.id || !Number.isSafeInteger(conversion.version) || conversion.version < 1 ||
          !identifier.test(conversion.doctype) || !identifier.test(conversion.field) ||
          !conversion.fromType || !conversion.toType || !/^sha256:[A-Za-z0-9_-]{43}$/.test(conversion.artifactDigest) || conversionKeys.has(key)) {
        throw new FramekitError("INVALID_MIGRATION_CONVERSION", "Migration conversion metadata must be versioned, uniquely target a field, and include a SHA-256 artifact digest.", 422);
      }
      assertMigrationConversionParameters(conversion.parameters, conversion.id);
      conversionKeys.add(key);
      const change = plan.changes.find((candidate) => candidate.kind === "change_field_type" && candidate.doctype === conversion.doctype && candidate.field === conversion.field);
      if (!change || change.from !== conversion.fromType || change.to !== conversion.toType) {
        throw new FramekitError("INVALID_MIGRATION_CONVERSION", `Conversion ${conversion.id} does not match its field type change.`, 422);
      }
    }
  }
  const expectedChecksum = await migrationChecksum(plan);
  if (plan.checksum !== expectedChecksum) {
    throw new FramekitError("MIGRATION_CHECKSUM_MISMATCH", "Migration checksum does not match the planned changes.", 409, {
      expected: expectedChecksum,
      actual: plan.checksum
    });
  }
}

function assertMigrationConversionParameters(value: unknown, conversionId: string, path = "parameters", ancestors = new WeakSet<object>()): asserts value is MigrationConversionParameters {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object") throw new FramekitError("INVALID_MIGRATION_CONVERSION", `Conversion ${conversionId} ${path} must be canonical JSON.`, 422);
  if (ancestors.has(value)) throw new FramekitError("INVALID_MIGRATION_CONVERSION", `Conversion ${conversionId} ${path} must not be circular.`, 422);
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) {
      throw new FramekitError("INVALID_MIGRATION_CONVERSION", `Conversion ${conversionId} ${path} must be a dense plain JSON array.`, 422);
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new FramekitError("INVALID_MIGRATION_CONVERSION", `Conversion ${conversionId} ${path} must contain only enumerable plain data.`, 422);
      assertMigrationConversionParameters(descriptor.value, conversionId, `${path}[${index}]`, ancestors);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null || Object.getOwnPropertySymbols(value).length > 0) {
      throw new FramekitError("INVALID_MIGRATION_CONVERSION", `Conversion ${conversionId} ${path} must be a plain JSON object.`, 422);
    }
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable || !("value" in descriptor)) throw new FramekitError("INVALID_MIGRATION_CONVERSION", `Conversion ${conversionId} ${path}.${key} must be enumerable plain data.`, 422);
      assertMigrationConversionParameters(descriptor.value, conversionId, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

export function createExecutableMigrationArtifact(plan: MigrationPlan): ExecutableMigrationArtifact {
  const irreversible = plan.changes.filter((change) => !change.rollback);
  return {
    ...plan,
    changes: plan.changes.map(cloneMigrationChange),
    up: plan.changes.map(cloneMigrationChange),
    down: irreversible.length === 0
      ? plan.changes.slice().reverse().map((change) => ({ ...change.rollback! }))
      : []
  };
}

export async function createRollbackMigrationPlan(
  migration: MigrationRecord,
  options: { id?: string; createdAt?: string } = {}
): Promise<MigrationPlan> {
  await validateMigrationPlan(migration);
  const irreversible = migration.changes.filter((change) => !change.rollback);
  if (irreversible.length > 0) {
    throw new FramekitError("IRREVERSIBLE_MIGRATION", "Migration contains changes that cannot be rolled back automatically.", 409, irreversible);
  }
  const plan = {
    id: options.id ?? `${migration.id}-rollback`,
    tenantId: migration.tenantId,
    appName: migration.appName,
    fromSchemaChecksum: migration.toSchemaChecksum,
    toSchemaChecksum: migration.fromSchemaChecksum,
    fromUniqueConstraints: migration.toUniqueConstraints.map((constraint) => ({ ...constraint })),
    toUniqueConstraints: migration.fromUniqueConstraints.map((constraint) => ({ ...constraint })),
    createdAt: options.createdAt ?? new Date().toISOString(),
    changes: migration.changes.slice().reverse().map((change) => ({
      ...change.rollback!,
      rollback: withoutRollback(change)
    }))
  };
  return { ...plan, checksum: await migrationChecksum(plan) };
}

export async function appSchemaChecksum(app: AppDefinition): Promise<string> {
  const metadata = {
    name: app.name,
    version: app.version,
    modules: app.modules.map(({ hooks: _hooks, ...module }) => module)
  };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(metadata)));
  return base64Url(new Uint8Array(digest));
}

function appUniqueConstraints(app: AppDefinition): Array<{ doctype: string; field: string }> {
  return app.modules.flatMap((module) => module.doctypes.flatMap((doctype) =>
    doctype.fields.filter((field) => field.unique).map((field) => ({ doctype: doctype.name, field: field.name }))
  )).sort((left, right) => `${left.doctype}.${left.field}`.localeCompare(`${right.doctype}.${right.field}`));
}

function assertMigrationMetadata(app: AppDefinition): void {
  const doctypes = new Map(app.modules.flatMap((module) => module.doctypes).map((doctype) => [doctype.name, doctype]));
  for (const doctype of doctypes.values()) {
    const fields = new Set(doctype.fields.map((field) => field.name));
    for (const index of doctype.indexes) {
      const unknown = index.filter((field) => !fields.has(field));
      if (unknown.length > 0) throw new FramekitError("INVALID_MIGRATION_METADATA", `Index on ${doctype.name} references unknown fields: ${unknown.join(", ")}`, 422);
    }
    if (doctype.naming.field && !fields.has(doctype.naming.field)) {
      throw new FramekitError("INVALID_MIGRATION_METADATA", `Naming field "${doctype.naming.field}" does not exist on ${doctype.name}.`, 422);
    }
    if (doctype.workflow && !fields.has(doctype.workflow.field)) {
      throw new FramekitError("INVALID_MIGRATION_METADATA", `Workflow field "${doctype.workflow.field}" does not exist on ${doctype.name}.`, 422);
    }
    for (const field of doctype.fields.filter((candidate) => candidate.type === "link")) {
      if (!field.linkTo || !doctypes.has(field.linkTo)) {
        throw new FramekitError("INVALID_MIGRATION_METADATA", `Link field ${doctype.name}.${field.name} references unknown DocType "${field.linkTo ?? ""}".`, 422);
      }
    }
    const unsupportedUnique = doctype.fields.find((field) => field.unique && field.type === "json");
    if (unsupportedUnique) {
      throw new FramekitError("INVALID_MIGRATION_METADATA", `JSON field ${doctype.name}.${unsupportedUnique.name} cannot use a normalized unique constraint.`, 422);
    }
    for (const view of doctype.views) {
      if (view.doctype !== doctype.name) {
        throw new FramekitError("INVALID_MIGRATION_METADATA", `View "${view.id}" belongs to ${view.doctype}, not ${doctype.name}.`, 422);
      }
      const unknown = view.fields.filter((field) => !fields.has(field));
      if (unknown.length > 0) {
        throw new FramekitError("INVALID_MIGRATION_METADATA", `View "${view.id}" on ${doctype.name} references unknown fields: ${unknown.join(", ")}`, 422);
      }
    }
  }
}

export function assertMigrationIdentity(tenant: TenantContext, appName: string, plan: MigrationPlan): void {
  if (plan.tenantId !== tenant.tenantId) {
    throw new FramekitError("MIGRATION_TENANT_MISMATCH", `Migration tenant "${plan.tenantId}" does not match request tenant "${tenant.tenantId}".`, 409);
  }
  if (plan.appName !== appName) {
    throw new FramekitError("MIGRATION_APP_MISMATCH", `Migration app "${plan.appName}" does not match "${appName}".`, 409);
  }
}

export function assertMigrationDrift(latest: MigrationRecord | undefined, plan: MigrationPlan): void {
  if (!latest) return;
  if (latest.appName !== plan.appName) {
    throw new FramekitError("MIGRATION_APP_MISMATCH", `Latest migration belongs to app "${latest.appName}".`, 409);
  }
  // Records created before schema fingerprints were introduced have an empty target.
  // The first hardened apply establishes the chain after all other validation succeeds.
  if (latest.toSchemaChecksum && latest.toSchemaChecksum !== plan.fromSchemaChecksum) {
    throw new FramekitError("MIGRATION_SCHEMA_DRIFT", "Migration baseline does not match the latest applied schema.", 409, {
      expected: latest.toSchemaChecksum,
      actual: plan.fromSchemaChecksum
    });
  }
}

export function assertDestructiveMigration(plan: MigrationPlan, options: { allowDestructive?: boolean }): void {
  const destructive = plan.changes.filter(migrationChangeIsDestructive);
  if (destructive.length > 0 && !options.allowDestructive) {
    throw new FramekitError("DESTRUCTIVE_MIGRATION", "Migration contains destructive changes.", 409, destructive);
  }
}

export function migrationChangeIsDestructive(change: Pick<MigrationChange, "kind"> | MigrationRollback): boolean {
  return change.kind === "remove_doctype" || change.kind === "remove_field" || change.kind === "change_field_type" || change.kind === "change_collection_schema" || change.kind === "change_row_policy";
}

export function assertSupportedMigration(plan: MigrationPlan): void {
  const unsupported = plan.changes.filter((change) => change.kind === "change_field_type");
  if (unsupported.length > 0) {
    throw new FramekitError("UNSUPPORTED_MIGRATION_CONVERSION", "Automatic field type conversion is not supported; provide an operator-reviewed data migration.", 422, unsupported);
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function indexKey(fields: string[]): string {
  return fields.join(",");
}

function cloneMigrationRecord(record: MigrationRecord): MigrationRecord {
  return {
    ...record,
    fromUniqueConstraints: record.fromUniqueConstraints.map((constraint) => ({ ...constraint })),
    toUniqueConstraints: record.toUniqueConstraints.map((constraint) => ({ ...constraint })),
    changes: record.changes.map(cloneMigrationChange)
  };
}

function cloneMigrationChange(change: MigrationChange): MigrationChange {
  if (!change.rollback) {
    const { rollback: _rollback, ...rest } = change;
    return rest;
  }
  return { ...change, rollback: { ...change.rollback } };
}

function withoutRollback(change: MigrationChange): MigrationRollback {
  const { rollback: _rollback, ...rest } = change;
  return rest;
}

function coerceFieldValue(doctype: string, field: FieldDefinition, value: unknown): unknown {
  if (value === null) {
    return value;
  }
  switch (field.type) {
    case "number": {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        throw new FramekitError("VALIDATION_FAILED", `${doctype}.${field.name} must be a number`, 422);
      }
      return number;
    }
    case "decimal":
    case "currency":
      return normalizeExactDecimal(value, decimalPrecision(field), decimalScale(field), `${doctype}.${field.name}`);
    case "boolean":
      return Boolean(value);
    case "select":
      if (field.options && !field.options.includes(String(value))) {
        throw new FramekitError("VALIDATION_FAILED", `${doctype}.${field.name} must be one of ${field.options.join(", ")}`, 422);
      }
      return String(value);
    case "json":
      return value;
    default:
      return String(value);
  }
}

type ParsedDecimal = { coefficient: bigint; scale: number };

export function normalizeExactDecimal(value: unknown, precision: number, scale: number, field = "decimal"): string {
  if (typeof value !== "string") throw decimalError(field, "decimal_string_required", "Decimal value must be a canonical base-10 string.");
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match) throw decimalError(field, "decimal_format", "Decimal value is not in canonical base-10 notation.");
  const fraction = match[3] ?? "";
  if (fraction.length > scale) throw decimalError(field, "decimal_scale", `Decimal value exceeds scale ${scale}.`);
  const whole = match[2]!;
  const integerDigits = whole === "0" ? 0 : whole.length;
  if (integerDigits + scale > precision) throw decimalError(field, "decimal_precision", `Decimal value exceeds precision ${precision}.`);
  const padded = fraction.padEnd(scale, "0");
  const zero = whole === "0" && [...padded].every((digit) => digit === "0");
  const sign = match[1] === "-" && !zero ? "-" : "";
  return scale === 0 ? `${sign}${whole}` : `${sign}${whole}.${padded}`;
}

export function addExactDecimals(values: string[], precision: number, scale: number): string {
  const parsed = values.map(parseDecimal);
  const commonScale = Math.max(0, ...parsed.map((value) => value.scale));
  const coefficient = parsed.reduce((total, value) => total + rescaleCoefficient(value, commonScale), 0n);
  const exact = { coefficient: rescaleCoefficient({ coefficient, scale: commonScale }, scale), scale };
  return normalizeExactDecimal(formatDecimal(exact), precision, scale);
}

function decimalError(field: string, code: string, message: string): FramekitError {
  return new FramekitError("DECIMAL_VALIDATION_FAILED", `${field}: ${message}`, 422, { field, code });
}

function parseDecimal(value: string): ParsedDecimal {
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  return { coefficient: BigInt(`${negative ? "-" : ""}${whole}${fraction}`), scale: fraction.length };
}

function rescaleCoefficient(value: ParsedDecimal, scale: number): bigint {
  if (value.scale === scale) return value.coefficient;
  if (value.scale < scale) return value.coefficient * (10n ** BigInt(scale - value.scale));
  const divisor = 10n ** BigInt(value.scale - scale);
  if (value.coefficient % divisor !== 0n) throw decimalError("computed", "decimal_scale", "Computed result cannot be represented at the target scale.");
  return value.coefficient / divisor;
}

function formatDecimal(value: ParsedDecimal): string {
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient).toString().padStart(value.scale + 1, "0");
  const body = value.scale === 0 ? digits : `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`;
  return negative ? `-${body}` : body;
}

function computeFieldValue(doctype: string, field: FieldDefinition, data: DocumentData): unknown {
  const computed = field.computed!;
  const values = computed.dependencies.map((dependency) => data[dependency]);
  if (values.some((value) => value === undefined || value === null)) return null;
  if (computed.operation === "concat") return values.map(String).join(computed.separator ?? "");
  const decimals = values.map((value) => String(value)).map(parseDecimal);
  let result: ParsedDecimal;
  if (computed.operation === "sum") {
    const scale = Math.max(...decimals.map((value) => value.scale));
    result = { coefficient: decimals.reduce((total, value) => total + rescaleCoefficient(value, scale), 0n), scale };
  } else if (computed.operation === "subtract") {
    const scale = Math.max(...decimals.map((value) => value.scale));
    result = { coefficient: rescaleCoefficient(decimals[0]!, scale) - rescaleCoefficient(decimals[1]!, scale), scale };
  } else {
    result = decimals.reduce<ParsedDecimal>((product, value) => ({ coefficient: product.coefficient * value.coefficient, scale: product.scale + value.scale }), { coefficient: 1n, scale: 0 });
  }
  const targetScale = decimalScale(field);
  const exact = { coefficient: rescaleCoefficient(result, targetScale), scale: targetScale };
  return normalizeExactDecimal(formatDecimal(exact), decimalPrecision(field), targetScale, `${doctype}.${field.name}`);
}

type FieldViolation = { field: string; rule: string; code: string; params?: Record<string, unknown> };

function validateFieldValue(doctype: string, field: FieldDefinition, value: unknown): FieldViolation[] {
  const violations: FieldViolation[] = [];
  if (field.required && (value === undefined || value === null || value === "")) {
    violations.push({ field: field.name, rule: "required", code: "required" });
    return violations;
  }
  if (value === undefined || value === null) return violations;
  for (const validator of field.validators) {
    if (validator.kind === "length") {
      const length = [...String(value)].length;
      if (validator.min !== undefined && length < validator.min) violations.push({ field: field.name, rule: "length", code: "length_min", params: { min: validator.min, actual: length } });
      if (validator.max !== undefined && length > validator.max) violations.push({ field: field.name, rule: "length", code: "length_max", params: { max: validator.max, actual: length } });
    } else if (validator.kind === "range") {
      const exact = field.type === "decimal" || field.type === "currency";
      const compare = (bound: string | number) => exact
        ? compareDecimalStrings(String(value), normalizeExactDecimal(bound, decimalPrecision(field), decimalScale(field)))
        : Number(value) - Number(bound);
      if (validator.min !== undefined && compare(validator.min) < 0) violations.push({ field: field.name, rule: "range", code: "range_min", params: { min: validator.min } });
      if (validator.max !== undefined && compare(validator.max) > 0) violations.push({ field: field.name, rule: "range", code: "range_max", params: { max: validator.max } });
    } else if (validator.kind === "pattern" && !matchesPattern(validator.pattern, String(value))) {
      violations.push({ field: field.name, rule: "pattern", code: `pattern_${validator.pattern}`, params: { pattern: validator.pattern } });
    } else if (validator.kind === "domain" && !validator.values.some((candidate) => String(candidate) === String(value))) {
      violations.push({ field: field.name, rule: "domain", code: "domain", params: { values: validator.values } });
    }
  }
  return violations;
}

function compareDecimalStrings(left: string, right: string): number {
  const leftParsed = parseDecimal(left);
  const rightParsed = parseDecimal(right);
  const scale = Math.max(leftParsed.scale, rightParsed.scale);
  const difference = rescaleCoefficient(leftParsed, scale) - rescaleCoefficient(rightParsed, scale);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function matchesPattern(pattern: "email" | "uuid" | "slug" | "alphanumeric", value: string): boolean {
  if (pattern === "email") {
    const at = value.indexOf("@");
    return at > 0 && at === value.lastIndexOf("@") && value.indexOf(".", at + 2) > at + 1 && !value.includes(" ");
  }
  if (pattern === "uuid") return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (pattern === "slug") return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  return /^[a-z0-9]+$/i.test(value);
}

export function validateListOptions(doctype: DocTypeDefinition, options: ListOptions = {}): void {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new FramekitError("INVALID_QUERY", "Document query options must be an object", 422);
  }
  if (options.search !== undefined && typeof options.search !== "string") {
    throw new FramekitError("INVALID_QUERY", "search must be a string", 422);
  }
  if (options.filters !== undefined && (!options.filters || typeof options.filters !== "object" || Array.isArray(options.filters))) {
    throw new FramekitError("INVALID_QUERY", "filters must be an object", 422);
  }
  if (options.sort !== undefined && (
    !options.sort || typeof options.sort !== "object" || Array.isArray(options.sort) ||
    typeof options.sort.field !== "string" || ![undefined, "asc", "desc"].includes(options.sort.direction)
  )) {
    throw new FramekitError("INVALID_QUERY", "sort must contain a field and an asc or desc direction", 422);
  }
  if (options.cursor !== undefined && typeof options.cursor !== "string") {
    throw new FramekitError("INVALID_QUERY", "cursor must be a string", 422);
  }
  if (options.fields !== undefined && (!Array.isArray(options.fields) || !options.fields.every((field) => typeof field === "string"))) {
    throw new FramekitError("INVALID_QUERY", "fields must be an array of field names", 422);
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1_000)) {
    throw new FramekitError("INVALID_LIMIT", "limit must be an integer between 1 and 1000", 422);
  }
  if (options.offset !== undefined && (!Number.isInteger(options.offset) || options.offset < 0)) {
    throw new FramekitError("INVALID_OFFSET", "offset must be a non-negative integer", 422);
  }
  const validFields = new Set(doctype.fields.map((field) => field.name));
  for (const [field, filter] of Object.entries(options.filters ?? {})) {
    if (!validFields.has(field)) {
      throw new FramekitError("UNKNOWN_FILTER_FIELD", `Unknown filter field "${field}" for ${doctype.name}`, 422);
    }
    const fieldDefinition = doctype.fields.find((candidate) => candidate.name === field);
    assertFilterShape(doctype.name, field, filter, fieldDefinition);
    if (fieldDefinition?.type === "json" && !isJsonNullFilter(filter)) {
      throw new FramekitError("UNSUPPORTED_QUERY_SHAPE", `JSON field "${field}" only supports isNull filtering`, 422);
    }
  }
  if (options.sort && options.sort.field !== "id" && options.sort.field !== "createdAt" && options.sort.field !== "updatedAt" && !validFields.has(options.sort.field)) {
    throw new FramekitError("UNKNOWN_SORT_FIELD", `Unknown sort field "${options.sort.field}" for ${doctype.name}`, 422);
  }
  const sortField = doctype.fields.find((field) => field.name === options.sort?.field);
  if (sortField?.type === "json") {
    throw new FramekitError("UNSUPPORTED_QUERY_SHAPE", `Sorting JSON field "${sortField.name}" is not supported`, 422);
  }
  if (options.cursor) decodeDocumentCursor(options.cursor, options.sort, doctype);
  const unknownProjectionFields = (options.fields ?? []).filter((field) => !validFields.has(field));
  if (unknownProjectionFields.length > 0) {
    throw new FramekitError("UNKNOWN_PROJECTION_FIELD", `Unknown projection fields for ${doctype.name}: ${unknownProjectionFields.join(", ")}`, 422);
  }
}

export function applyFilters(records: DocumentRecord[], filters: Record<string, FilterValue> = {}, doctype?: DocTypeDefinition): DocumentRecord[] {
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined && value !== "");
  if (entries.length === 0) {
    return records;
  }
  return records.filter((record) =>
    entries.every(([field, expected]) => {
      const actual = record.data[field];
      return matchesFilter(actual, expected, doctype?.fields.find((candidate) => candidate.name === field)?.type);
    })
  );
}

export function applyListOptions(records: DocumentRecord[], options: ListOptions = {}): DocumentRecord[] {
  return applyListOptionsPage(records, options).items;
}

export function applyListOptionsPage(records: DocumentRecord[], options: ListOptions = {}, doctype?: DocTypeDefinition): DocumentPage {
  const searchableFields = new Set(doctype?.fields.filter((field) => field.type !== "json").map((field) => field.name));
  const searched = options.search
    ? records.filter((record) => Object.entries(record.data).some(([field, value]) =>
        (!doctype || searchableFields.has(field)) && String(value ?? "").toLowerCase().includes(options.search!.toLowerCase())
      ))
    : records;
  const sorted = sortRecords(applyFilters(searched, options.filters, doctype), options.sort, doctype);
  const cursor = options.cursor ? decodeDocumentCursor(options.cursor, options.sort, doctype) : undefined;
  const afterCursor = cursor ? sorted.filter((record) => recordAfterCursor(record, cursor, doctype)) : sorted;
  const limit = options.limit ?? 100;
  const candidates = afterCursor.slice(options.offset ?? 0, (options.offset ?? 0) + limit + 1);
  const hasMore = candidates.length > limit;
  const page = candidates.slice(0, limit);
  return {
    items: projectRecords(page, options.fields),
    nextCursor: hasMore && page.length > 0 ? encodeDocumentCursor(page.at(-1)!, options.sort, doctype) : undefined
  };
}

function projectRecords(records: DocumentRecord[], fields?: string[]): DocumentRecord[] {
  if (!fields) {
    return records.map((record) => ({ ...record, data: { ...record.data } }));
  }
  return records.map((record) => {
    const data: DocumentData = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(record.data, field)) {
        data[field] = record.data[field];
      }
    }
    return { ...record, data };
  });
}

function matchesFilter(actual: unknown, expected: FilterValue, fieldType?: string): boolean {
  if (isFilterOperator(expected)) {
    if ("isNull" in expected && expected.isNull !== undefined) {
      const isNull = actual === undefined || actual === null || actual === "";
      if (isNull !== expected.isNull) {
        return false;
      }
    }
    if ("eq" in expected && !sameValue(actual, expected.eq, fieldType)) {
      return false;
    }
    if ("ne" in expected && sameValue(actual, expected.ne, fieldType)) {
      return false;
    }
    if ("in" in expected && expected.in && !expected.in.some((item) => sameValue(actual, item, fieldType))) {
      return false;
    }
    if ("contains" in expected && expected.contains !== undefined && !String(actual ?? "").toLowerCase().includes(expected.contains.toLowerCase())) {
      return false;
    }
    const missingNumericValue = ["number", "decimal", "currency"].includes(fieldType ?? "") && (actual === undefined || actual === null || actual === "");
    if ("gt" in expected && expected.gt !== undefined && (missingNumericValue || !(compareValues(actual, expected.gt, fieldType) > 0))) {
      return false;
    }
    if ("gte" in expected && expected.gte !== undefined && (missingNumericValue || !(compareValues(actual, expected.gte, fieldType) >= 0))) {
      return false;
    }
    if ("lt" in expected && expected.lt !== undefined && (missingNumericValue || !(compareValues(actual, expected.lt, fieldType) < 0))) {
      return false;
    }
    if ("lte" in expected && expected.lte !== undefined && (missingNumericValue || !(compareValues(actual, expected.lte, fieldType) <= 0))) {
      return false;
    }
    return true;
  }
  if (Array.isArray(expected)) {
    return expected.some((item) => sameValue(actual, item, fieldType));
  }
  return sameValue(actual, expected, fieldType);
}

function assertFilterShape(doctype: string, field: string, filter: FilterValue, fieldDefinition?: FieldDefinition): void {
  const fieldType = fieldDefinition?.type;
  const invalid = (message: string): never => {
    throw new FramekitError("INVALID_QUERY", `${doctype}.${field} ${message}`, 422);
  };
  const validateExact = (value: unknown) => {
    if ((fieldType === "decimal" || fieldType === "currency") && value !== null && value !== undefined) {
      normalizeExactDecimal(value, decimalPrecision(fieldDefinition!), decimalScale(fieldDefinition!), `${doctype}.${field}`);
    }
  };
  if (Array.isArray(filter)) {
    if (!filter.every(isFilterPrimitive)) invalid("array filters must contain only scalar values");
    filter.forEach(validateExact);
    return;
  }
  if (!isFilterOperator(filter)) {
    validateExact(filter);
    return;
  }
  const allowed = new Set(["eq", "ne", "in", "contains", "gt", "gte", "lt", "lte", "isNull"]);
  const unknown = Object.keys(filter).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    invalid(`contains unknown filter operators: ${unknown.join(", ")}`);
  }
  if (Object.keys(filter).length === 0) invalid("filter operator object must not be empty");
  if (filter.in !== undefined && !Array.isArray(filter.in)) {
    invalid("in filter must be an array");
  }
  if (filter.in?.some((value) => !isFilterPrimitive(value))) invalid("in filter must contain only scalar values");
  filter.in?.forEach(validateExact);
  if (filter.contains !== undefined && typeof filter.contains !== "string") invalid("contains filter must be a string");
  if (filter.isNull !== undefined && typeof filter.isNull !== "boolean") invalid("isNull filter must be a boolean");
  for (const operator of ["eq", "ne", "gt", "gte", "lt", "lte"] as const) {
    const value = filter[operator];
    if (value !== undefined && !isFilterPrimitive(value)) invalid(`${operator} filter must be a scalar value`);
    if (value !== undefined) validateExact(value);
  }
  for (const operator of ["gt", "gte", "lt", "lte"] as const) {
    const value = filter[operator];
    if (value !== undefined && typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) {
      invalid(`${operator} filter must be a string or finite number`);
    }
  }
  if (fieldType === "number") {
    for (const operator of ["gt", "gte", "lt", "lte"] as const) {
      const value = filter[operator];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
        invalid(`${operator} filter must be a finite number`);
      }
    }
  }
}

function isFilterPrimitive(value: unknown): value is FilterPrimitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isFilterOperator(value: unknown): value is FilterOperator {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonNullFilter(value: FilterValue): boolean {
  return isFilterOperator(value) && Object.keys(value).length === 1 && value.isNull !== undefined;
}

function sameValue(left: unknown, right: unknown, fieldType?: string): boolean {
  if (left === undefined) return false;
  if (left === null || right === null) return left === right;
  if (fieldType === "decimal" || fieldType === "currency") return compareDecimalStrings(String(left), String(right)) === 0;
  return String(left) === String(right);
}

function compareValues(left: unknown, right: unknown, fieldType?: string): number {
  if (fieldType === "number") return Number(left) - Number(right);
  if (fieldType === "decimal" || fieldType === "currency") return compareDecimalStrings(String(left || "0"), String(right || "0"));
  return compareCodePoints(String(left ?? ""), String(right ?? ""));
}

/** Matches PostgreSQL UTF-8 byte ordering under the C collation. */
function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!;
  }
  return leftPoints.length - rightPoints.length;
}

function filterPrimitive(value: unknown): FilterPrimitive {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  return String(value);
}

export function sortRecords(records: DocumentRecord[], sort: ListOptions["sort"] = { field: "updatedAt", direction: "desc" }, doctype?: DocTypeDefinition): DocumentRecord[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  const fieldType = doctype?.fields.find((field) => field.name === sort.field)?.type;
  return [...records].sort((left, right) => {
    const primary = compareValues(sortableValue(left, sort.field), sortableValue(right, sort.field), fieldType);
    if (primary !== 0) return direction * primary;
    return compareCodePoints(left.id, right.id);
  });
}

function sortableValue(record: DocumentRecord, field: string): unknown {
  if (field === "id") {
    return record.id;
  }
  if (field === "createdAt") {
    return record.createdAt;
  }
  if (field === "updatedAt") {
    return record.updatedAt;
  }
  const value = record.data[field];
  return value === undefined || value === null ? "" : value;
}

type DocumentCursor = {
  v: 1;
  field: string;
  direction: "asc" | "desc";
  value: string | number | boolean;
  id: string;
};

export function encodeDocumentCursor(record: DocumentRecord, sort: ListOptions["sort"], doctype?: DocTypeDefinition): string {
  const normalized = normalizeSort(sort);
  const fieldType = doctype?.fields.find((field) => field.name === normalized.field)?.type;
  const rawValue = sortableValue(record, normalized.field);
  const value = fieldType === "number" ? Number(rawValue) : String(rawValue);
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new FramekitError("UNSUPPORTED_QUERY_SHAPE", `Cannot create a cursor for ${normalized.field}`, 422);
  }
  const payload: DocumentCursor = { v: 1, ...normalized, value, id: record.id };
  return base64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeDocumentCursor(cursor: string, sort: ListOptions["sort"], doctype?: DocTypeDefinition): DocumentCursor {
  let payload: unknown;
  try {
    const base64 = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
  } catch {
    throw new FramekitError("INVALID_CURSOR", "Cursor is not a valid Framekit document cursor", 422);
  }
  const expected = normalizeSort(sort);
  const candidate = payload as Partial<DocumentCursor>;
  if (
    candidate.v !== 1 || candidate.field !== expected.field || candidate.direction !== expected.direction ||
    typeof candidate.id !== "string" || !["string", "number", "boolean"].includes(typeof candidate.value)
  ) {
    throw new FramekitError("INVALID_CURSOR", "Cursor does not match the requested sort order", 422);
  }
  const field = doctype?.fields.find((item) => item.name === expected.field);
  if (field?.type === "json") {
    throw new FramekitError("UNSUPPORTED_QUERY_SHAPE", `Sorting JSON field "${field.name}" is not supported`, 422);
  }
  const expectedValueType = field?.type === "number"
    ? "number"
    : "string";
  if (typeof candidate.value !== expectedValueType || (expectedValueType === "number" && !Number.isFinite(candidate.value))) {
    throw new FramekitError("INVALID_CURSOR", "Cursor value does not match the requested sort field", 422);
  }
  if ((field?.type === "decimal" || field?.type === "currency") && normalizeExactDecimal(candidate.value, decimalPrecision(field), decimalScale(field)) !== candidate.value) {
    throw new FramekitError("INVALID_CURSOR", "Cursor value is not a canonical exact decimal", 422);
  }
  return candidate as DocumentCursor;
}

function recordAfterCursor(record: DocumentRecord, cursor: DocumentCursor, doctype?: DocTypeDefinition): boolean {
  const fieldType = doctype?.fields.find((field) => field.name === cursor.field)?.type;
  const primary = compareValues(sortableValue(record, cursor.field), cursor.value, fieldType);
  const directed = cursor.direction === "asc" ? primary : -primary;
  return directed > 0 || (directed === 0 && compareCodePoints(record.id, cursor.id) > 0);
}

function normalizeSort(sort: ListOptions["sort"]): { field: string; direction: "asc" | "desc" } {
  return {
    field: sort?.field ?? "updatedAt",
    direction: sort?.direction === "asc" ? "asc" : "desc"
  };
}

function createRuntimeWarnings(
  repository: RepositoryDiagnostics,
  audit: RepositoryDiagnostics,
  outbox: RepositoryDiagnostics,
  customization: RepositoryDiagnostics,
  namingSeries: RepositoryDiagnostics,
  mutations: RepositoryDiagnostics,
  doctypes: DocTypeDefinition[]
): string[] {
  const warnings: string[] = [];
  if (!repository.durable) {
    warnings.push("Repository is not durable; use @framekit/db PostgresDocumentRepository for production data.");
  }
  if (!audit.durable) {
    warnings.push("Audit store is not durable; use @framekit/db PostgresAuditStore for production audit trails.");
  }
  if (!outbox.durable) {
    warnings.push("Outbox store is not durable; use @framekit/db PostgresOutboxStore for production events.");
  }
  if (!customization.durable) {
    warnings.push("Customization store is not durable; use @framekit/db PostgresCustomizationStore for production metadata.");
  }
  if (!namingSeries.durable) {
    warnings.push("Naming series store is not durable; use @framekit/db PostgresNamingSeriesStore for production IDs.");
  }
  if (repository.durable && !mutations.features.includes("atomic-mutations")) {
    warnings.push("Durable document mutations are not atomic; configure a backend MutationUnitOfWork.");
  }
  for (const doctype of doctypes) {
    if (doctype.permissions.length === 0) {
      warnings.push(`DocType "${doctype.name}" has no permission rules.`);
    }
  }
  return warnings;
}

function uniqueLifecycleResources(resources: unknown[]): LifecycleResource[] {
  return [...new Set(resources.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const resource = candidate as LifecycleResource;
    return resource.start || resource.close || resource.dispose ? [resource] : [];
  }))];
}

async function closeLifecycleResources(resources: LifecycleResource[]): Promise<void> {
  const failures: unknown[] = [];
  for (const resource of resources) {
    try {
      if (resource.close) await resource.close();
      else await resource.dispose?.();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "One or more runtime resources failed to close.");
}

function aggregateErrorCauses(error: unknown): unknown[] {
  return error instanceof AggregateError ? [...error.errors] : [error];
}

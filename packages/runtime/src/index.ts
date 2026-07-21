import {
  assertPermission,
  canTransferOwnership,
  CustomFieldSchema,
  defineApp,
  defineDocType,
  FramekitError,
  getDocType,
  hasRowAccess,
  hasAccess,
  ViewSchema,
  type AppDefinition,
  type CustomFieldDefinition,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentRecord,
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

export type MutationUnitOfWork = LifecycleResource & {
  execute(command: MutationCommand): Promise<{ document?: DocumentRecord; replayed: boolean }>;
  replay?(tenant: TenantContext, idempotencyKey: string, fingerprint: string): Promise<{ found: boolean; result?: DocumentRecord }>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

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
  kind: "add_doctype" | "remove_doctype" | "add_field" | "remove_field" | "change_field_type" | "add_index" | "remove_index" | "add_unique_constraint" | "remove_unique_constraint" | "change_row_policy";
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
  checksum: string;
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
  resources?: LifecycleResource[];
  idGenerator?: () => string;
  now?: () => Date;
};

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
    this.mutations = options.mutations ?? (
      repository instanceof InMemoryDocumentRepository && audit instanceof InMemoryAuditStore && outbox instanceof InMemoryOutboxStore
        ? new InMemoryMutationUnitOfWork(repository, audit, outbox)
        : undefined
    );
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
    this.resources = uniqueLifecycleResources([
      repository, audit, outbox, this.customization, this.namingSeries, this.migrations, this.realtime,
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
        } else if (currentField.type !== field.type) {
          changes.push(migrationChange({ kind: "change_field_type", doctype: nextDocType.name, field: field.name, destructive: true, from: currentField.type, to: field.type }));
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
    defineDocType({ ...effective, fields: [...effective.fields, parsedField] });
    if (parsedField.type === "link") getDocType(this.app, parsedField.linkTo!);
    return this.customization.addCustomField(tenant, {
      id: `${base.name}.${parsedField.name}`,
      tenantId: tenant.tenantId,
      doctype: base.name,
      field: parsedField
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
    const data = this.prepareInput(doctype, candidate, true);
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
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "update");
    if (doctype.ownership && Object.hasOwn(input, "ownerId")) throw new FramekitError("OWNER_IMMUTABLE", "Owner changes require transferOwner", 403);
    requireExpectedRevisionForRetry(options);
    const fingerprint = mutationFingerprint("update", doctype.name, { id, input, expectedRevision: options.expectedRevision });
    const replay = await this.replayMutation(tenant, options.idempotencyKey, fingerprint);
    if (replay) return replay;
    const existing = await this.getForWrite(tenant, doctype, id);
    assertDraftDocument(existing, "update");
    const candidate = { ...existing.data, ...input };
    await this.runHooks("beforeValidate", tenant, doctype, existing, candidate);
    const data = this.prepareInput(doctype, candidate, false, existing.data);
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
    const data = this.prepareInput(doctype, candidate, false, candidate);
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
    const data = this.prepareInput(doctype, candidate, false, candidate);
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

  private prepareInput(doctype: DocTypeDefinition, input: DocumentData, inserting: boolean, protectedData: DocumentData = {}): DocumentData {
    const output: DocumentData = {};
    for (const field of doctype.fields) {
      const value = input[field.name] ?? field.default;
      if (field.required && (value === undefined || value === null || value === "")) {
        throw new FramekitError("VALIDATION_FAILED", `Field "${field.label}" is required`, 422);
      }
      if (field.readOnly && !inserting) {
        if (protectedData[field.name] !== undefined) output[field.name] = protectedData[field.name];
        continue;
      }
      if (value !== undefined) {
        output[field.name] = coerceFieldValue(doctype.name, field.name, field.type, value, field.options);
      }
    }
    for (const [key, value] of Object.entries(input)) {
      if (!(key in output) && !doctype.fields.some((field) => field.name === key)) {
        output[key] = value;
      }
    }
    return output;
  }

  private async getForWrite(tenant: TenantContext, doctype: DocTypeDefinition, id: string): Promise<DocumentRecord> {
    const document = await this.repository.get(tenant, doctype, id, { access: "write" });
    if (!document) throw new FramekitError("DOCUMENT_NOT_FOUND", `No ${doctype.name} document with id "${id}"`, 404);
    return document;
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

export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly records = new Map<string, DocumentRecord>();

  [inMemoryRepositoryCheckpoint](): Map<string, DocumentRecord> {
    return new Map([...this.records].map(([key, record]) => [key, cloneRecord(record)]));
  }

  [inMemoryRepositoryRestore](snapshot: Map<string, DocumentRecord>): void {
    this.records.clear();
    for (const [key, record] of snapshot) this.records.set(key, cloneRecord(record));
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
    const replay = this.idempotency.get(`${tenant.tenantId}:${idempotencyKey}`);
    if (!replay) return { found: false };
    assertMemoryIdempotencyFingerprint(idempotencyKey, fingerprint, replay.fingerprint);
    return replay.result ? { found: true, result: cloneRecord(replay.result) } : { found: true };
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

  private async executeUnlocked(command: MutationCommand, idempotencyKey?: string): Promise<{ document?: DocumentRecord; replayed: boolean }> {
    if (idempotencyKey) {
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

function assertDraftDocument(document: DocumentRecord, action: string): void {
  if (document.documentStatus !== "draft") {
    throw new FramekitError("DOCUMENT_NOT_DRAFT", `Cannot ${action} ${document.doctype} "${document.id}" after submission`, 409);
  }
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

export async function migrationChecksum(plan: Pick<MigrationPlan, "tenantId" | "appName" | "fromSchemaChecksum" | "toSchemaChecksum" | "fromUniqueConstraints" | "toUniqueConstraints" | "changes">): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson({
    tenantId: plan.tenantId,
    appName: plan.appName,
    fromSchemaChecksum: plan.fromSchemaChecksum,
    toSchemaChecksum: plan.toSchemaChecksum,
    fromUniqueConstraints: plan.fromUniqueConstraints,
    toUniqueConstraints: plan.toUniqueConstraints,
    changes: plan.changes
  })));
  return base64Url(new Uint8Array(digest));
}

export async function validateMigrationPlan(plan: MigrationPlan): Promise<void> {
  if (!plan.id || !plan.tenantId || !plan.appName || !plan.fromSchemaChecksum || !plan.toSchemaChecksum ||
      !Array.isArray(plan.fromUniqueConstraints) || !Array.isArray(plan.toUniqueConstraints) || !Array.isArray(plan.changes)) {
    throw new FramekitError("INVALID_MIGRATION_PLAN", "Migration plan identity, schema checksums, uniqueness metadata, and changes are required.", 422);
  }
  const identifier = /^[a-z][a-z0-9_]*$/;
  const changeKinds = new Set(["add_doctype", "remove_doctype", "add_field", "remove_field", "change_field_type", "add_index", "remove_index", "add_unique_constraint", "remove_unique_constraint", "change_row_policy"]);
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
  const expectedChecksum = await migrationChecksum(plan);
  if (plan.checksum !== expectedChecksum) {
    throw new FramekitError("MIGRATION_CHECKSUM_MISMATCH", "Migration checksum does not match the planned changes.", 409, {
      expected: expectedChecksum,
      actual: plan.checksum
    });
  }
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
  return change.kind === "remove_doctype" || change.kind === "remove_field" || change.kind === "change_field_type" || change.kind === "change_row_policy";
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

function coerceFieldValue(doctype: string, field: string, type: string, value: unknown, options?: string[]): unknown {
  if (value === null) {
    return value;
  }
  switch (type) {
    case "number":
    case "currency": {
      const number = Number(value);
      if (Number.isNaN(number)) {
        throw new FramekitError("VALIDATION_FAILED", `${doctype}.${field} must be a number`, 422);
      }
      return number;
    }
    case "boolean":
      return Boolean(value);
    case "select":
      if (options && !options.includes(String(value))) {
        throw new FramekitError("VALIDATION_FAILED", `${doctype}.${field} must be one of ${options.join(", ")}`, 422);
      }
      return String(value);
    case "json":
      return value;
    default:
      return String(value);
  }
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
    assertFilterShape(doctype.name, field, filter, fieldDefinition?.type);
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
    if ("eq" in expected && !sameValue(actual, expected.eq)) {
      return false;
    }
    if ("ne" in expected && sameValue(actual, expected.ne)) {
      return false;
    }
    if ("in" in expected && expected.in && !expected.in.some((item) => sameValue(actual, item))) {
      return false;
    }
    if ("contains" in expected && expected.contains !== undefined && !String(actual ?? "").toLowerCase().includes(expected.contains.toLowerCase())) {
      return false;
    }
    const missingNumericValue = (fieldType === "number" || fieldType === "currency") && (actual === undefined || actual === null || actual === "");
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
    return expected.some((item) => sameValue(actual, item));
  }
  return sameValue(actual, expected);
}

function assertFilterShape(doctype: string, field: string, filter: FilterValue, fieldType?: string): void {
  const invalid = (message: string): never => {
    throw new FramekitError("INVALID_QUERY", `${doctype}.${field} ${message}`, 422);
  };
  if (Array.isArray(filter)) {
    if (!filter.every(isFilterPrimitive)) invalid("array filters must contain only scalar values");
    return;
  }
  if (!isFilterOperator(filter)) return;
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
  if (filter.contains !== undefined && typeof filter.contains !== "string") invalid("contains filter must be a string");
  if (filter.isNull !== undefined && typeof filter.isNull !== "boolean") invalid("isNull filter must be a boolean");
  for (const operator of ["eq", "ne", "gt", "gte", "lt", "lte"] as const) {
    const value = filter[operator];
    if (value !== undefined && !isFilterPrimitive(value)) invalid(`${operator} filter must be a scalar value`);
  }
  for (const operator of ["gt", "gte", "lt", "lte"] as const) {
    const value = filter[operator];
    if (value !== undefined && typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) {
      invalid(`${operator} filter must be a string or finite number`);
    }
  }
  if (fieldType === "number" || fieldType === "currency") {
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

function sameValue(left: unknown, right: unknown): boolean {
  if (left === undefined) return false;
  if (left === null || right === null) return left === right;
  return String(left) === String(right);
}

function compareValues(left: unknown, right: unknown, fieldType?: string): number {
  if (fieldType === "number" || fieldType === "currency") return Number(left) - Number(right);
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
  const value = fieldType === "number" || fieldType === "currency" ? Number(rawValue) : String(rawValue);
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
  const expectedValueType = field?.type === "number" || field?.type === "currency"
    ? "number"
    : "string";
  if (typeof candidate.value !== expectedValueType || (expectedValueType === "number" && !Number.isFinite(candidate.value))) {
    throw new FramekitError("INVALID_CURSOR", "Cursor value does not match the requested sort field", 422);
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

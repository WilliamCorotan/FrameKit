import {
  assertPermission,
  CustomFieldSchema,
  defineApp,
  FramekitError,
  getDocType,
  hasAccess,
  ViewSchema,
  type AppDefinition,
  type CustomFieldDefinition,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentRecord,
  type HookName,
  type TenantContext,
  type ViewDefinition
} from "@framekit/core";

export type ListOptions = {
  limit?: number;
  search?: string;
};

export type DocumentRepository = {
  list(tenant: TenantContext, doctype: DocTypeDefinition, options?: ListOptions): Promise<DocumentRecord[]>;
  get(tenant: TenantContext, doctype: DocTypeDefinition, id: string): Promise<DocumentRecord | undefined>;
  create(tenant: TenantContext, doctype: DocTypeDefinition, record: DocumentRecord): Promise<DocumentRecord>;
  update(tenant: TenantContext, doctype: DocTypeDefinition, record: DocumentRecord): Promise<DocumentRecord>;
  delete(tenant: TenantContext, doctype: DocTypeDefinition, id: string): Promise<void>;
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

export type AuditStore = AuditSink & {
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
  status: "pending" | "dispatched" | "failed";
  attempts: number;
  createdAt: string;
  processedAt?: string;
  error?: string;
};

export type OutboxStore = {
  record(event: OutboxEvent): Promise<void> | void;
  list(tenant: TenantContext, options?: { limit?: number; status?: OutboxEvent["status"] }): Promise<OutboxEvent[]>;
  markDispatched(tenant: TenantContext, id: string): Promise<OutboxEvent>;
  markFailed(tenant: TenantContext, id: string, error: string): Promise<OutboxEvent>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type CustomizationStore = {
  listCustomFields(tenant: TenantContext): Promise<CustomFieldDefinition[]>;
  addCustomField(tenant: TenantContext, field: CustomFieldDefinition): Promise<CustomFieldDefinition>;
  listViews(tenant: TenantContext): Promise<ViewDefinition[]>;
  upsertView(tenant: TenantContext, view: ViewDefinition): Promise<ViewDefinition>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type NamingSeriesStore = {
  next(tenant: TenantContext, doctype: DocTypeDefinition, prefix: string, digits: number): Promise<string>;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type RuntimeRealtimeEvent = {
  channel: string;
  type: string;
  payload: Record<string, unknown>;
};

export type RealtimePublisher = {
  publish(event: RuntimeRealtimeEvent): Promise<void> | void;
  describe?(): RepositoryDiagnostics | Promise<RepositoryDiagnostics>;
};

export type RuntimeOptions = {
  repository?: DocumentRepository;
  audit?: AuditStore;
  outbox?: OutboxStore;
  customization?: CustomizationStore;
  namingSeries?: NamingSeriesStore;
  realtime?: RealtimePublisher;
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
  private readonly realtime: RealtimePublisher;
  private readonly idGenerator: () => string;
  private readonly now: () => Date;

  constructor(app: AppDefinition, options: RuntimeOptions = {}) {
    this.app = defineApp(app);
    this.repository = options.repository ?? new InMemoryDocumentRepository();
    this.audit = options.audit ?? new InMemoryAuditStore();
    this.outbox = options.outbox ?? new InMemoryOutboxStore();
    this.customization = options.customization ?? new InMemoryCustomizationStore();
    this.namingSeries = options.namingSeries ?? new InMemoryNamingSeriesStore();
    this.realtime = options.realtime ?? new NoopRealtimePublisher();
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
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
    const realtime = this.realtime.describe ? await this.realtime.describe() : { kind: "unknown", durable: false, features: [] };
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
      realtime,
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
      warnings: createRuntimeWarnings(repository, audit, outbox, customization, namingSeries, doctypes)
    };
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

  async list(tenant: TenantContext, doctypeName: string, options?: ListOptions): Promise<DocumentRecord[]> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "read");
    return this.repository.list(tenant, doctype, options);
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

  async create(tenant: TenantContext, doctypeName: string, input: DocumentData): Promise<DocumentRecord> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "create");
    const data = this.prepareInput(doctype, input, true);
    await this.runHooks("beforeValidate", tenant, doctype, undefined, data);
    const state = doctype.workflow?.initialState;
    const timestamp = this.now().toISOString();
    const document: DocumentRecord = {
      id: await this.createDocumentId(tenant, doctype, data),
      doctype: doctype.name,
      tenantId: tenant.tenantId,
      data,
      state,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.runHooks("beforeInsert", tenant, doctype, document, data);
    const created = await this.repository.create(tenant, doctype, document);
    await this.runHooks("afterInsert", tenant, doctype, created, data);
    await this.recordAudit(tenant, "create", created);
    await this.recordOutbox(tenant, "created", created);
    await this.publishDocumentEvent(tenant, "created", created);
    return created;
  }

  async update(tenant: TenantContext, doctypeName: string, id: string, input: DocumentData): Promise<DocumentRecord> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "update");
    const existing = await this.get(tenant, doctypeName, id);
    const data = this.prepareInput(doctype, { ...existing.data, ...input }, false);
    const updated: DocumentRecord = { ...existing, data, updatedAt: this.now().toISOString() };
    await this.runHooks("beforeUpdate", tenant, doctype, updated, data);
    const saved = await this.repository.update(tenant, doctype, updated);
    await this.runHooks("afterUpdate", tenant, doctype, saved, data);
    await this.recordAudit(tenant, "update", saved);
    await this.recordOutbox(tenant, "updated", saved);
    await this.publishDocumentEvent(tenant, "updated", saved);
    return saved;
  }

  async delete(tenant: TenantContext, doctypeName: string, id: string): Promise<void> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "delete");
    const existing = await this.get(tenant, doctypeName, id);
    await this.runHooks("beforeDelete", tenant, doctype, existing, existing.data);
    await this.repository.delete(tenant, doctype, id);
    await this.runHooks("afterDelete", tenant, doctype, existing, existing.data);
    await this.recordAudit(tenant, "delete", existing);
    await this.recordOutbox(tenant, "deleted", existing);
    await this.publishDocumentEvent(tenant, "deleted", existing);
  }

  async transition(tenant: TenantContext, doctypeName: string, id: string, action: string): Promise<DocumentRecord> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "transition");
    const workflow = doctype.workflow;
    if (!workflow) {
      throw new FramekitError("WORKFLOW_NOT_DEFINED", `${doctype.name} does not define a workflow`, 400);
    }
    const existing = await this.get(tenant, doctypeName, id);
    const currentState = existing.state ?? workflow.initialState;
    const transition = workflow.transitions.find((candidate) => candidate.action === action && candidate.from.includes(currentState));
    if (!transition) {
      throw new FramekitError("INVALID_TRANSITION", `Cannot run "${action}" from "${currentState}"`, 409);
    }
    if (!hasAccess(tenant, transition)) {
      throw new FramekitError("FORBIDDEN", `Missing permission to run transition "${action}"`, 403);
    }
    const data = { ...existing.data, [workflow.field]: transition.to };
    const updated: DocumentRecord = {
      ...existing,
      data,
      state: transition.to,
      updatedAt: this.now().toISOString()
    };
    await this.runHooks("beforeTransition", tenant, doctype, updated, data);
    const saved = await this.repository.update(tenant, doctype, updated);
    await this.runHooks("afterTransition", tenant, doctype, saved, data);
    await this.recordAudit(tenant, `transition:${action}`, saved);
    await this.recordOutbox(tenant, `transition.${action}`, saved);
    await this.publishDocumentEvent(tenant, `transition.${action}`, saved);
    return saved;
  }

  private prepareInput(doctype: DocTypeDefinition, input: DocumentData, inserting: boolean): DocumentData {
    const output: DocumentData = {};
    for (const field of doctype.fields) {
      const value = input[field.name] ?? field.default;
      if (field.required && (value === undefined || value === null || value === "")) {
        throw new FramekitError("VALIDATION_FAILED", `Field "${field.label}" is required`, 422);
      }
      if (field.readOnly && !inserting) {
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

  private async recordAudit(tenant: TenantContext, action: string, document: DocumentRecord): Promise<void> {
    await this.audit.record({
      id: this.idGenerator(),
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      action,
      doctype: document.doctype,
      documentId: document.id,
      createdAt: this.now().toISOString()
    });
  }

  private async recordOutbox(tenant: TenantContext, action: string, document: DocumentRecord): Promise<void> {
    const createdAt = this.now().toISOString();
    await this.outbox.record({
      id: this.idGenerator(),
      tenantId: tenant.tenantId,
      type: `${document.doctype}.${action}`,
      topic: document.doctype,
      payload: {
        id: document.id,
        doctype: document.doctype,
        state: document.state,
        data: document.data
      },
      status: "pending",
      attempts: 0,
      createdAt
    });
  }

  private async publishDocumentEvent(tenant: TenantContext, action: string, document: DocumentRecord): Promise<void> {
    await this.realtime.publish({
      channel: `tenant:${tenant.tenantId}:documents`,
      type: `${document.doctype}.${action}`,
      payload: {
        id: document.id,
        doctype: document.doctype,
        tenantId: tenant.tenantId,
        state: document.state,
        data: document.data
      }
    });
  }
}

export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly records = new Map<string, DocumentRecord>();

  describe(): RepositoryDiagnostics {
    return {
      kind: "memory",
      durable: false,
      features: ["crud", "search"]
    };
  }

  async list(tenant: TenantContext, doctype: DocTypeDefinition, options: ListOptions = {}): Promise<DocumentRecord[]> {
    const records = [...this.records.values()].filter((record) => record.tenantId === tenant.tenantId && record.doctype === doctype.name);
    const searched = options.search ? records.filter((record) => JSON.stringify(record.data).toLowerCase().includes(options.search!.toLowerCase())) : records;
    return searched.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, options.limit ?? 100);
  }

  async get(tenant: TenantContext, doctype: DocTypeDefinition, id: string): Promise<DocumentRecord | undefined> {
    const record = this.records.get(keyFor(tenant.tenantId, doctype.name, id));
    return record ? { ...record, data: { ...record.data } } : undefined;
  }

  async create(tenant: TenantContext, doctype: DocTypeDefinition, record: DocumentRecord): Promise<DocumentRecord> {
    const key = keyFor(tenant.tenantId, doctype.name, record.id);
    if (this.records.has(key)) {
      throw new FramekitError("DOCUMENT_EXISTS", `${doctype.name} "${record.id}" already exists`, 409);
    }
    this.records.set(key, { ...record, data: { ...record.data } });
    return record;
  }

  async update(tenant: TenantContext, doctype: DocTypeDefinition, record: DocumentRecord): Promise<DocumentRecord> {
    const key = keyFor(tenant.tenantId, doctype.name, record.id);
    if (!this.records.has(key)) {
      throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${record.id}" does not exist`, 404);
    }
    this.records.set(key, { ...record, data: { ...record.data } });
    return record;
  }

  async delete(tenant: TenantContext, doctype: DocTypeDefinition, id: string): Promise<void> {
    this.records.delete(keyFor(tenant.tenantId, doctype.name, id));
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
      .map((event) => ({ ...event, payload: { ...event.payload } }));
  }

  async markDispatched(tenant: TenantContext, id: string): Promise<OutboxEvent> {
    return this.updateStatus(tenant, id, "dispatched");
  }

  async markFailed(tenant: TenantContext, id: string, error: string): Promise<OutboxEvent> {
    return this.updateStatus(tenant, id, "failed", error);
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
    return { ...event, payload: { ...event.payload } };
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
}

export function createRuntime(app: AppDefinition, options?: RuntimeOptions): FramekitRuntime {
  return new FramekitRuntime(app, options);
}

function keyFor(tenantId: string, doctype: string, id: string): string {
  return `${tenantId}:${doctype}:${id}`;
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

function createRuntimeWarnings(
  repository: RepositoryDiagnostics,
  audit: RepositoryDiagnostics,
  outbox: RepositoryDiagnostics,
  customization: RepositoryDiagnostics,
  namingSeries: RepositoryDiagnostics,
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
  for (const doctype of doctypes) {
    if (doctype.permissions.length === 0) {
      warnings.push(`DocType "${doctype.name}" has no permission rules.`);
    }
  }
  return warnings;
}

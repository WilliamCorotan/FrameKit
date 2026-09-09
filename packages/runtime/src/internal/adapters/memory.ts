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

import type { AttachmentStorage, AuditEvent, AuditStore, CustomizationStore, DocumentPage, DocumentRepository, LifecycleResource, ListOptions, MigrationPlan, MigrationRecord, MigrationStore, MutationBatchResult, MutationCommand, MutationUnitOfWork, NamingSeriesStore, OutboxClaimOptions, OutboxEvent, OutboxStore, RealtimePublisher, RepositoryDiagnostics, RuntimeRealtimeEvent, StoredSettingValue } from "../types.js";
import { applyListOptionsPage, validateListOptions } from "../query.js";
import { assertDestructiveMigration, assertMigrationDrift, assertMigrationIdentity, assertSupportedMigration, cloneMigrationRecord, createRollbackMigrationPlan, validateMigrationPlan } from "../migrations.js";
const inMemoryRepositoryCheckpoint = Symbol("inMemoryRepositoryCheckpoint");
const inMemoryRepositoryRestore = Symbol("inMemoryRepositoryRestore");

function fieldStorageContract(field: FieldDefinition): string {
  const exact = field.type === "decimal" || field.type === "currency"
    ? `${field.type}(${decimalPrecision(field)},${decimalScale(field)})`
    : field.type;
  return field.computed ? `${exact}:computed:${JSON.stringify(field.computed)}` : exact;
}

function settingStorageContract(setting: SettingDefinition): Pick<SettingDefinition, "type" | "scope" | "required" | "default" | "options"> {
  return {
    type: setting.type,
    scope: setting.scope,
    required: setting.required,
    ...(setting.default === undefined ? {} : { default: setting.default }),
    ...(setting.options === undefined ? {} : { options: setting.options })
  };
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
  private readonly objects = new Map<string, { bytes: Uint8Array; createdAt: number; revision: string; leaseOwner?: string; leaseUntil?: number }>();

  constructor(private readonly currentTime: () => number = Date.now) {}

  describe(): RepositoryDiagnostics {
    return { kind: "memory-attachments", durable: false, features: ["put", "get", "delete", "list", "leases", "conditional-delete"] };
  }

  async put(key: string, bytes: Uint8Array, metadata: { contentType: string; lease?: { owner: string; durationMs: number } }): Promise<void> {
    const now = this.currentTime();
    this.objects.set(key, {
      bytes: new Uint8Array(bytes), createdAt: now, revision: crypto.randomUUID(),
      ...(metadata.lease ? { leaseOwner: metadata.lease.owner, leaseUntil: now + metadata.lease.durationMs } : {})
    });
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const object = this.objects.get(key);
    return object ? new Uint8Array(object.bytes) : undefined;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  async releaseLease(key: string, owner: string): Promise<void> {
    const object = this.objects.get(key);
    if (object?.leaseOwner === owner) {
      delete object.leaseOwner;
      delete object.leaseUntil;
      object.revision = crypto.randomUUID();
    }
  }

  async listCleanupCandidates(prefix: string): Promise<Array<{ key: string; revision: string }>> {
    return [...this.objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, object]) => ({ key, revision: object.revision }));
  }

  async deleteIfUnleased(key: string, options: { minimumAgeMs: number; expectedRevision: string }): Promise<boolean> {
    const object = this.objects.get(key);
    if (!object || object.revision !== options.expectedRevision) return false;
    const now = this.currentTime();
    if (now - object.createdAt < options.minimumAgeMs || object.leaseOwner !== undefined) return false;
    this.objects.delete(key);
    return true;
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
    if (command.sagaFence) throw new FramekitError("COMMAND_SAGA_FENCING_UNAVAILABLE", "This memory unit of work does not provide saga fencing.", 501);
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
    if (commands.some((command) => command.sagaFence)) throw new FramekitError("COMMAND_SAGA_FENCING_UNAVAILABLE", "This memory unit of work does not provide saga fencing.", 501);
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
  private readonly settings = new Map<string, StoredSettingValue>();

  describe(): RepositoryDiagnostics {
    return {
      kind: "memory",
      durable: false,
      features: ["custom-fields", "views", "settings"]
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

  async listSettingValues(tenant: TenantContext, appName: string): Promise<StoredSettingValue[]> {
    const tenantScope = `tenant:${tenant.tenantId}`;
    const appScope = `app:${appName}`;
    return [...this.settings.values()].filter((item) => item.appName === appName && (item.scopeId === tenantScope || item.scopeId === appScope)).map((item) => ({ ...item }));
  }

  async upsertSettingValue(tenant: TenantContext, value: StoredSettingValue): Promise<StoredSettingValue> {
    assertSettingValueScope(tenant, value);
    this.settings.set(`${value.appName}\0${value.scopeId}\0${value.key}`, { ...value });
    return { ...value };
  }
}

function settingScopeId(definition: SettingDefinition, tenant: TenantContext, appName: string): string {
  return definition.scope === "app" ? `app:${appName}` : `tenant:${tenant.tenantId}`;
}

function assertSettingValueScope(tenant: TenantContext, value: StoredSettingValue): void {
  if (value.scopeId !== `tenant:${tenant.tenantId}` && value.scopeId !== `app:${value.appName}`) {
    throw new FramekitError("FORBIDDEN", "Setting value scope does not match the authenticated tenant or application.", 403);
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

function keyFor(tenantId: string, doctype: string, id: string): string { return `${tenantId}:${doctype}:${id}`; }
function cloneRecord(record: DocumentRecord): DocumentRecord { return { ...record, data: { ...record.data } }; }
function revisionConflict(doctype: string, id: string, expectedRevision: number, actualRevision: number): FramekitError { return new FramekitError("REVISION_CONFLICT", `${doctype} "${id}" changed since it was read`, 409, { doctype, id, expectedRevision, actualRevision }); }
function assertMemoryIdempotencyFingerprint(key: string, expected: string, actual: string): void { if (expected !== actual) throw new FramekitError("IDEMPOTENCY_KEY_REUSED", `Idempotency key "${key}" was already used for another command`, 409, { key }); }

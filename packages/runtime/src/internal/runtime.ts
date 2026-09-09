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

import type { SagaRecord, SagaProgress, SagaStore, AttachmentStorage, AttachmentUpload, AuditEvent, AuditStore, CommandRowPolicy, CustomizationStore, DocumentCommandResult, DocumentPage, DocumentRepository, LifecycleResource, ListOptions, MigrationChange, MigrationPlan, MigrationRecord, MigrationStore, MutationCommand, MutationOptions, MutationUnitOfWork, NamingSeriesStore, OutboxClaimOptions, OutboxEvent, OutboxStore, PublicSetting, RealtimePublisher, RepositoryDiagnostics, RuntimeOptions, RuntimeRealtimeEvent, SettingsSecretPort, StoredSettingValue } from "./types.js";
import { InMemoryAttachmentStorage, InMemoryAuditStore, InMemoryCustomizationStore, InMemoryDocumentRepository, InMemoryMigrationStore, InMemoryMutationUnitOfWork, InMemoryNamingSeriesStore, InMemoryOutboxStore, NoopRealtimePublisher } from "./adapters/memory.js";
import { appSchemaChecksum, appUniqueConstraints, assertMigrationIdentity, assertMigrationMetadata, createRollbackMigrationPlan, indexKey, migrationChange, migrationChecksum, secretStorageFailure, stableJson, validateMigrationPlan } from "./migrations.js";
import { encodeDocumentCursor, filterPrimitive, validateListOptions } from "./query.js";
import { coerceFieldValue, computeFieldValue, validateFieldValue } from "./validation.js";
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
  private readonly sagas?: SagaStore;
  private readonly sagaLeaseMs: number;
  private readonly attachmentStorage: AttachmentStorage;
  private readonly idGenerator: () => string;
  private readonly now: () => Date;
  private readonly activeAttachmentKeys = new Set<string>();
  private readonly settingsSecrets?: SettingsSecretPort;
  private readonly resources: LifecycleResource[];
  private readonly deployment: "development" | "production";
  private lifecycleState: "created" | "started" | "closing" | "closed" = "created";
  private startPromise?: Promise<void>;
  private closePromise?: Promise<void>;

  constructor(app: AppDefinition, options: RuntimeOptions = {}) {
    this.deployment = options.deployment ?? "development";
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
    this.sagas = options.sagas;
    this.sagaLeaseMs = options.sagaLeaseMs ?? 30_000;
    if (!Number.isSafeInteger(this.sagaLeaseMs) || this.sagaLeaseMs < 1 || this.sagaLeaseMs > 900_000) throw new TypeError("Saga lease must be 1 to 900000 milliseconds.");
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
    this.settingsSecrets = options.settingsSecrets;
    this.resources = uniqueLifecycleResources([
      repository, audit, outbox, this.customization, this.namingSeries, this.migrations, this.realtime, this.attachmentStorage,
      ...(this.mutations ? [this.mutations] : []), ...(this.sagas ? [this.sagas] : []), ...(options.resources ?? [])
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
    let validated = this.deployment !== "production";
    try {
      if (this.deployment === "production") await this.assertProductionReady();
      validated = true;
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
        await closeLifecycleResources(validated ? [...(starting ? [starting] : []), ...started.reverse()] : [...this.resources].reverse());
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

  async metadata(tenant?: TenantContext, options: { locale?: string } = {}) {
    const modules = tenant ? await this.modulesWithCustomFields(tenant) : this.app.modules;
    const chain = localeFallbackChain(this.app.localization, options.locale);
    const localizedModules = modules.map((module) => ({
      ...module,
      name: resolveTranslation(this.app, module.nameKey, module.name, options.locale)!,
      description: resolveTranslation(this.app, module.descriptionKey, module.description, options.locale),
      navigation: module.navigation.map((item) => ({ ...item, label: resolveTranslation(this.app, item.labelKey, item.label, options.locale)! })),
      settings: module.settings.map((setting) => ({ ...setting, label: resolveTranslation(this.app, setting.labelKey, setting.label, options.locale)!, description: resolveTranslation(this.app, setting.descriptionKey, setting.description, options.locale) })),
      doctypes: module.doctypes.map((doctype) => ({
        ...doctype,
        label: resolveTranslation(this.app, doctype.labelKey, doctype.label, options.locale)!,
        description: resolveTranslation(this.app, doctype.descriptionKey, doctype.description, options.locale),
        fields: doctype.fields.map((field) => ({ ...field, label: resolveTranslation(this.app, field.labelKey, field.label, options.locale)!, description: resolveTranslation(this.app, field.descriptionKey, field.description, options.locale) }))
      }))
    }));
    const messages: Record<string, string> = {};
    for (const locale of [...chain].reverse()) Object.assign(messages, this.app.localization.translations[locale] ?? {});
    return {
      name: resolveTranslation(this.app, this.app.nameKey, this.app.name, options.locale)!,
      version: this.app.version,
      locale: chain[0] ?? this.app.localization.defaultLocale,
      supportedLocales: this.app.localization.supportedLocales,
      messages,
      modules: localizedModules.map(({ hooks: _hooks, ...module }) => module)
    };
  }

  async settings(tenant: TenantContext, options: { locale?: string } = {}): Promise<PublicSetting[]> {
    this.assertSettingsPermission(tenant, "framekit.settings.read");
    const definitions = this.app.modules.flatMap((module) => module.settings);
    const stored = await this.listStoredSettings(tenant);
    return definitions.map((definition) => {
      const scopeId = settingScopeId(definition, tenant, this.app.name);
      const persisted = stored.find((item) => item.key === definition.key && item.scopeId === scopeId);
      return this.publicSetting(definition, persisted, options.locale);
    });
  }

  async upsertSetting(tenant: TenantContext, key: string, input: unknown): Promise<PublicSetting> {
    this.assertSettingsPermission(tenant, "framekit.settings.manage");
    const definition = this.settingDefinition(key);
    if (definition.scope === "app") this.assertSettingsPermission(tenant, "framekit.settings.app.manage");
    if (!this.customization.upsertSettingValue) throw new FramekitError("SETTINGS_STORE_UNAVAILABLE", "The configured customization store cannot persist settings.", 501);
    const value = validateSettingValue(definition, input);
    const scopeId = settingScopeId(definition, tenant, this.app.name);
    let persisted: unknown = value;
    if (definition.type === "secret") {
      if (!this.settingsSecrets) throw new FramekitError("SECRET_STORAGE_UNAVAILABLE", "Secret settings require an explicit secret storage port.", 503, { key });
      try {
        persisted = await this.settingsSecrets.seal(String(value), { appName: this.app.name, scopeId, key });
      } catch {
        throw secretStorageFailure();
      }
      if (typeof persisted !== "string" || !persisted) throw secretStorageFailure();
    }
    const stored = await this.customization.upsertSettingValue(tenant, { scopeId, appName: this.app.name, key, value: persisted, protected: definition.type === "secret", updatedAt: this.now().toISOString() });
    return this.publicSetting(definition, stored);
  }

  async resolveSettingValue(tenant: TenantContext, key: string): Promise<unknown> {
    const definition = this.settingDefinition(key);
    const scopeId = settingScopeId(definition, tenant, this.app.name);
    const persisted = (await this.listStoredSettings(tenant)).find((item) => item.key === key && item.scopeId === scopeId);
    if (!persisted) return definition.default;
    if (persisted.protected !== (definition.type === "secret")) throw secretStorageFailure();
    if (definition.type !== "secret") return validateSettingValue(definition, persisted.value);
    if (!this.settingsSecrets || typeof persisted.value !== "string") throw new FramekitError("SECRET_STORAGE_UNAVAILABLE", "Secret setting cannot be resolved without its secret storage port.", 503, { key });
    try {
      return validateSettingValue(definition, await this.settingsSecrets.unseal(persisted.value, { appName: this.app.name, scopeId, key }));
    } catch {
      throw secretStorageFailure();
    }
  }

  private async listStoredSettings(tenant: TenantContext): Promise<StoredSettingValue[]> {
    return this.customization.listSettingValues ? this.customization.listSettingValues(tenant, this.app.name) : [];
  }

  private settingDefinition(key: string): SettingDefinition {
    const definition = this.app.modules.flatMap((module) => module.settings).find((setting) => setting.key === key);
    if (!definition) throw new FramekitError("SETTING_NOT_FOUND", `Unknown setting "${key}"`, 404);
    return definition;
  }

  private publicSetting(definition: SettingDefinition, persisted?: StoredSettingValue, locale?: string): PublicSetting {
    const { default: defaultValue, ...publicDefinition } = definition;
    const secret = definition.type === "secret";
    if (persisted && persisted.protected !== secret) throw secretStorageFailure();
    const value = persisted
      ? (secret ? undefined : validateSettingValue(definition, persisted.value))
      : (defaultValue === undefined ? undefined : validateSettingValue(definition, defaultValue));
    return {
      ...publicDefinition,
      label: resolveTranslation(this.app, definition.labelKey, definition.label, locale)!,
      description: resolveTranslation(this.app, definition.descriptionKey, definition.description, locale),
      ...(value === undefined ? {} : { value }),
      configured: Boolean(persisted) || (!secret && defaultValue !== undefined),
      redacted: secret
    };
  }

  private assertSettingsPermission(tenant: TenantContext, permission: string): void {
    if (!tenant.permissions.includes("*") && !tenant.permissions.includes(permission)) throw new FramekitError("FORBIDDEN", `Missing permission ${permission}`, 403);
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
    const attachmentStorage = this.attachmentStorage.describe ? await this.attachmentStorage.describe() : { kind: "unknown", durable: false, features: [] };
    const sagas = this.sagas ? await this.sagas.describe() : { kind: "none", durable: false, features: [] };
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
      attachmentStorage,
      sagas,
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

  private async assertProductionReady(): Promise<void> {
    if (!this.settingsSecrets) throw new FramekitError("RUNTIME_PRODUCTION_UNSAFE", "Production runtime requires a secret settings port.", 503);
    const diagnostics = await this.diagnostics();
    const resources = ["repository", "audit", "outbox", "customization", "namingSeries", "migrations", "realtime", "mutations", "attachmentStorage"] as const;
    if (this.app.modules.some((module) => module.commands.some((command) => command.mode === "saga"))
      && (!diagnostics.sagas.durable || !diagnostics.mutations.features.includes("saga-fencing"))) {
      throw new FramekitError("RUNTIME_PRODUCTION_UNSAFE", "Production saga commands require a durable journal and fenced mutation unit of work.", 503);
    }
    const unsafe = resources.filter((name) => diagnostics[name].durable !== true);
    if (unsafe.length) throw new FramekitError("RUNTIME_PRODUCTION_UNSAFE", `Production runtime requires durable resources: ${unsafe.join(", ")}.`, 503);
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
    const currentSettings = this.app.modules.flatMap((module) => module.settings);
    const nextSettings = parsed.modules.flatMap((module) => module.settings);
    for (const nextSetting of nextSettings) {
      const currentSetting = currentSettings.find((setting) => setting.key === nextSetting.key);
      if (!currentSetting) {
        changes.push(migrationChange({ kind: "add_setting", doctype: "settings", field: nextSetting.key, destructive: false, to: nextSetting }));
      } else if (stableJson(settingStorageContract(currentSetting)) !== stableJson(settingStorageContract(nextSetting))) {
        changes.push(migrationChange({ kind: "change_setting", doctype: "settings", field: nextSetting.key, destructive: true, from: currentSetting, to: nextSetting }));
      }
    }
    for (const currentSetting of currentSettings) {
      if (!nextSettings.some((setting) => setting.key === currentSetting.key)) {
        changes.push(migrationChange({ kind: "remove_setting", doctype: "settings", field: currentSetting.key, destructive: true, from: currentSetting }));
      }
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

  private async updateDocument(
    tenant: TenantContext,
    doctypeName: string,
    id: string,
    input: DocumentData,
    options: MutationOptions = {},
    managedFields = new Set<string>(),
    fingerprintOverride?: string
  ): Promise<DocumentRecord> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "update");
    if (doctype.ownership && Object.hasOwn(input, "ownerId")) throw new FramekitError("OWNER_IMMUTABLE", "Owner changes require transferOwner", 403);
    requireExpectedRevisionForRetry(options);
    const fingerprint = fingerprintOverride ?? mutationFingerprint("update", doctype.name, { id, input, expectedRevision: options.expectedRevision });
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

    if (this.sagas) return this.executeJournaledSaga(tenant, commandId, request);
    if (this.deployment === "production") throw new FramekitError("COMMAND_SAGA_JOURNAL_REQUIRED", "Production sagas require a durable journal.", 503);

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

  private async executeJournaledSaga(tenant: TenantContext, commandId: string, request: DocumentCommandRequest): Promise<DocumentCommandResult> {
    tenant = structuredClone(tenant);
    request = structuredClone(request);
    if (!request.idempotencyKey) throw new FramekitError("COMMAND_SAGA_KEY_REQUIRED", "A journaled saga requires an idempotency key.", 422);
    const diagnostics = await this.mutations!.describe?.();
    if (!this.mutations?.replay || !diagnostics?.features.includes("saga-fencing")) {
      throw new FramekitError("COMMAND_SAGA_FENCING_UNAVAILABLE", "Journaled sagas require receipt replay and transactional mutation fencing.", 501);
    }
    if (this.deployment === "production" && !(await this.sagas!.describe()).durable) {
      throw new FramekitError("COMMAND_SAGA_JOURNAL_REQUIRED", "Production sagas require a durable journal.", 503);
    }
    // Authority may change between attempts; it is checked afresh, not frozen in the fingerprint.
    for (const operation of request.operations) {
      assertPermission(tenant, await this.getEffectiveDocType(tenant, operation.doctype), operation.operation);
      const compensation = operation.compensation!;
      assertPermission(tenant, await this.getEffectiveDocType(tenant, compensation.doctype), compensation.operation);
    }
    const owner = crypto.randomUUID();
    const key = request.idempotencyKey;
    let journal = await this.sagas!.claim({
      tenantId: tenant.tenantId, key, command: commandId,
      fingerprint: sagaFingerprint(tenant, commandId, request.operations), operations: request.operations,
      owner, leaseMs: this.sagaLeaseMs
    });
    if (journal.phase === "completed") return {
      command: commandId, mode: "saga", replayed: true,
      documents: await this.authorizeSagaReceipt(tenant, commandId, request.operations, journal.documents.map((document) => document ?? undefined))
    };
    if (journal.phase === "compensated") throw new FramekitError("COMMAND_SAGA_TERMINAL", "This saga was compensated. Use a new key for a new command.", 409);

    const save = async (changes: Partial<SagaProgress>, release = false) => {
      journal = await this.sagas!.save({
        tenantId: tenant.tenantId, key, owner, expectedRevision: journal.revision,
        progress: { ...sagaProgress(journal), ...changes }, leaseMs: this.sagaLeaseMs, release
      });
    };
    const publications: Array<{ type: string; document: DocumentRecord }> = [];
    let allReplayed = true;
    let completed = false;
    if (journal.phase === "running") {
      try {
        for (let index = journal.nextStep; index < request.operations.length; index++) {
          const operation = request.operations[index]!;
          // This checkpoint precedes preparation and mutation, including user hooks.
          await save({ activeStep: index });
          const stepKey = sagaStepKey(key, "running", index);
          const fingerprint = sagaStepFingerprint(tenant, commandId, "running", operation);
          const prior = await this.mutations.replay(tenant, stepKey, fingerprint);
          let document: DocumentRecord | undefined;
          if (prior.found) {
            [document] = await this.authorizeSagaReceipt(tenant, commandId, [operation], [prior.result]);
          } else {
            const command = await this.prepareDocumentCommandMutation(tenant, commandId, operation, stepKey);
            command.idempotencyFingerprint = fingerprint;
            command.sagaFence = { key, owner, phase: "running", step: index };
            const execution = await this.mutations.execute(command);
            document = execution.document;
            if (!execution.replayed) {
              allReplayed = false;
              publications.push({ type: command.operation === "create" ? "created" : command.operation === "update" ? "updated" : "deleted", document: document ?? command.document });
            }
          }
          const documents = [...journal.documents];
          documents[index] = document ?? null;
          await save({ documents, nextStep: index + 1, activeStep: undefined });
        }
        await save({ phase: "completed" });
        completed = true;
      } catch (cause) {
        if (isSagaLeaseLost(cause)) throw cause;
        // save locks the journal row, draining any uncertain mutation commit before
        // compensation can inspect receipts or make an absence decision.
        await save({
          phase: "compensating", compensationIndex: journal.activeStep ?? journal.nextStep - 1,
          activeStep: undefined, failure: sagaFailure(cause)
        });
      }
      if (completed) {
        // Publishing cannot change a committed terminal saga into compensation.
        for (const publication of publications) await this.publishDocumentEvent(tenant, publication.type, publication.document);
        return {
          command: commandId, mode: "saga", replayed: allReplayed,
          documents: await this.authorizeSagaReceipt(tenant, commandId, request.operations, journal.documents.map((document) => document ?? undefined))
        };
      }
    }

    const compensationPublications: Array<{ type: string; document: DocumentRecord }> = [];
    for (let index = journal.compensationIndex!; index >= 0; index--) {
      try {
        await save({ compensationIndex: index });
        const operation = request.operations[index]!;
        const forward = await this.mutations.replay(tenant, sagaStepKey(key, "running", index), sagaStepFingerprint(tenant, commandId, "running", operation));
        if (forward.found) {
          const compensation = operation.compensation!;
          const compensationKey = sagaStepKey(key, "compensating", index);
          const fingerprint = sagaStepFingerprint(tenant, commandId, "compensating", compensation);
          const prior = await this.mutations.replay(tenant, compensationKey, fingerprint);
          if (prior.found) {
            await this.authorizeCommandReplay(tenant, commandId, [compensation], [prior.result]);
          } else {
            const command = await this.prepareDocumentCommandMutation(tenant, commandId, compensation, compensationKey);
            command.idempotencyFingerprint = fingerprint;
            command.sagaFence = { key, owner, phase: "compensating", step: index };
            const execution = await this.mutations.execute(command);
            if (!execution.replayed) compensationPublications.push({ type: `compensated.${command.operation}`, document: execution.document ?? command.document });
          }
        }
        await save({ compensationIndex: index - 1, compensationFailure: undefined });
      } catch (error) {
        if (isSagaLeaseLost(error)) throw error;
        await save({ compensationFailure: { index, ...sagaFailure(error) } }, true);
        throw sagaFailed(commandId, journal);
      }
    }
    await save({ phase: "compensated", compensationFailure: undefined });
    for (const publication of compensationPublications) await this.publishDocumentEvent(tenant, publication.type, publication.document);
    throw sagaFailed(commandId, journal);
  }

  private async authorizeSagaReceipt(
    tenant: TenantContext, commandId: string, operations: DocumentCommandOperation[], stored: Array<DocumentRecord | undefined>
  ): Promise<Array<DocumentRecord | undefined>> {
    const documents = await this.authorizeCommandReplay(tenant, commandId, operations, stored);
    for (const [index, operation] of operations.entries()) {
      if (operation.operation === "delete") continue;
      const doctype = await this.getEffectiveDocType(tenant, operation.doctype);
      const prior = documents[index]!;
      const current = await this.repository.get(tenant, doctype, prior.id, { access: operation.operation === "create" ? "read" : "write" });
      if (!current || !(await this.commandRowPolicy?.({ tenant, command: commandId, operation, document: current }) ?? true)) {
        throw new FramekitError("DOCUMENT_NOT_FOUND", `${doctype.name} "${prior.id}" does not exist`, 404);
      }
    }
    return documents;
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
    requireExpectedRevisionForRetry(options);
    const sha256 = await sha256Digest(upload.bytes);
    const fingerprint = mutationFingerprint("attachment:upload", doctype.name, {
      actor: { tenantId: tenant.tenantId, userId: tenant.userId }, id, field: field.name,
      name: upload.name, contentType: upload.contentType, size: upload.bytes.length, sha256,
      expectedRevision: options.expectedRevision
    });
    const existing = await this.getForWrite(tenant, doctype, id);
    const attachmentId = options.idempotencyKey
      ? `att_${(await sha256Digest(new TextEncoder().encode(`${options.idempotencyKey}\0${fingerprint}`))).slice(7, 31)}`
      : this.idGenerator();
    const replay = await this.replayMutation(tenant, options.idempotencyKey, fingerprint);
    if (replay) {
      const receipt = attachmentList(replay.data[field.name]).find((attachment) => attachment.id === attachmentId);
      if (!receipt) throw new FramekitError("IDEMPOTENCY_RESULT_INVALID", "Stored attachment upload receipt is invalid.", 409);
      return receipt;
    }
    assertDraftDocument(existing, "upload attachments to");
    const storageKey = [tenant.tenantId, this.app.name, doctype.name, id, field.name, attachmentId, crypto.randomUUID()].map(encodeURIComponent).join("/");
    const metadata: AttachmentMetadata = {
      id: attachmentId, name: upload.name, contentType: upload.contentType, size: upload.bytes.length,
      sha256, storageKey, createdAt: this.now().toISOString(), createdBy: tenant.userId
    };
    const leaseOwner = `upload:${crypto.randomUUID()}`;
    this.activeAttachmentKeys.add(storageKey);
    let committed = false;
    let putSucceeded = false;
    try {
      await this.attachmentStorage.put(storageKey, upload.bytes, { contentType: upload.contentType, lease: { owner: leaseOwner, durationMs: 5 * 60_000 } });
      putSucceeded = true;
      const attachments = attachmentList(existing.data[field.name]);
      const saved = await this.updateDocument(
        tenant, doctypeName, id, { [field.name]: [...attachments, metadata] },
        { ...options, expectedRevision: options.expectedRevision ?? existing.revision }, new Set([field.name]), fingerprint
      );
      const receipt = attachmentList(saved.data[field.name]).find((attachment) => attachment.id === attachmentId);
      if (!receipt) throw new FramekitError("IDEMPOTENCY_RESULT_INVALID", "Stored attachment upload receipt is invalid.", 409);
      committed = receipt.storageKey === storageKey;
      if (!committed) await this.attachmentStorage.delete(storageKey);
      return receipt;
    } catch (error) {
      if (putSucceeded) {
        try {
          const current = await this.repository.get(tenant, doctype, id, { access: "write" });
          committed = attachmentList(current?.data[field.name]).some((attachment) => attachment.storageKey === storageKey);
          if (!committed && error instanceof FramekitError && ["REVISION_CONFLICT", "VALIDATION_FAILED", "FORBIDDEN", "IDEMPOTENCY_KEY_REUSED"].includes(error.code)) {
            await this.attachmentStorage.delete(storageKey);
          }
        } catch {
          // Preserve the lease when the durable commit outcome cannot be established.
        }
      }
      throw error;
    } finally {
      if (committed) await this.attachmentStorage.releaseLease?.(storageKey, leaseOwner).catch(() => undefined);
      this.activeAttachmentKeys.delete(storageKey);
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
    const sha256 = await sha256Digest(bytes);
    if (bytes.length !== metadata.size || sha256 !== metadata.sha256) {
      throw new FramekitError("ATTACHMENT_INTEGRITY_FAILED", `Attachment "${attachmentId}" bytes do not match their metadata`, 409, {
        expectedSize: metadata.size, actualSize: bytes.length, expectedSha256: metadata.sha256, actualSha256: sha256
      });
    }
    return { metadata, bytes };
  }

  async deleteAttachment(tenant: TenantContext, doctypeName: string, id: string, fieldName: string, attachmentId: string, options: MutationOptions = {}): Promise<void> {
    const doctype = await this.getEffectiveDocType(tenant, doctypeName);
    assertPermission(tenant, doctype, "update");
    const field = attachmentField(doctype, fieldName);
    requireExpectedRevisionForRetry(options);
    const fingerprint = mutationFingerprint("attachment:delete", doctype.name, {
      actor: { tenantId: tenant.tenantId, userId: tenant.userId }, id, field: field.name, attachmentId,
      expectedRevision: options.expectedRevision
    });
    const document = await this.getForWrite(tenant, doctype, id);
    if ((await this.replayMutation(tenant, options.idempotencyKey, fingerprint)) !== undefined) return;
    assertDraftDocument(document, "delete attachments from");
    let workingDocument = document;
    let attachments = attachmentList(document.data[field.name]);
    let metadata = attachments.find((attachment) => attachment.id === attachmentId);
    if (!metadata) throw new FramekitError("ATTACHMENT_NOT_FOUND", `Attachment "${attachmentId}" does not exist`, 404);
    if (metadata.pendingDelete && metadata.pendingDelete.fingerprint !== fingerprint) {
      throw new FramekitError("ATTACHMENT_DELETE_PENDING", `Attachment "${attachmentId}" already has a different delete operation pending`, 409);
    }
    if (!metadata.pendingDelete) {
      const bytes = await this.attachmentStorage.get(metadata.storageKey);
      if (!bytes) throw new FramekitError("ATTACHMENT_BYTES_MISSING", `Attachment "${attachmentId}" bytes are unavailable`, 410);
      const pendingMetadata: AttachmentMetadata = {
        ...metadata,
        pendingDelete: { fingerprint, requestedAt: this.now().toISOString(), requestedBy: tenant.userId }
      };
      workingDocument = await this.updateDocument(
        tenant, doctypeName, id,
        { [field.name]: attachments.map((attachment) => attachment.id === attachmentId ? pendingMetadata : attachment) },
        { expectedRevision: options.expectedRevision ?? document.revision }, new Set([field.name])
      );
      attachments = attachmentList(workingDocument.data[field.name]);
      metadata = attachments.find((attachment) => attachment.id === attachmentId)!;
    }
    this.activeAttachmentKeys.add(metadata.storageKey);
    try {
      await this.attachmentStorage.delete(metadata.storageKey);
      await this.updateDocument(
        tenant, doctypeName, id, { [field.name]: attachments.filter((attachment) => attachment.id !== attachmentId) },
        { expectedRevision: workingDocument.revision, idempotencyKey: options.idempotencyKey }, new Set([field.name]), fingerprint
      );
    } finally {
      this.activeAttachmentKeys.delete(metadata.storageKey);
    }
  }

  async cleanupOrphanAttachments(tenant: TenantContext): Promise<string[]> {
    if (!tenant.permissions.includes("*") && !tenant.permissions.includes("framekit.attachments.cleanup")) {
      throw new FramekitError("FORBIDDEN", "Missing framekit.attachments.cleanup permission", 403);
    }
    if (!this.attachmentStorage.listCleanupCandidates || !this.attachmentStorage.deleteIfUnleased) {
      throw new FramekitError("ATTACHMENT_CLEANUP_UNSUPPORTED", "Attachment storage must support revision snapshots and atomic conditional deletion for safe cleanup.", 501);
    }
    const prefix = `${encodeURIComponent(tenant.tenantId)}/${encodeURIComponent(this.app.name)}/`;
    const snapshot = await this.attachmentStorage.listCleanupCandidates(prefix);
    const referenced = new Set<string>();
    for (const baseDoctype of this.app.modules.flatMap((module) => module.doctypes)) {
      const doctype = await this.getEffectiveDocType(tenant, baseDoctype.name);
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
    const candidates = snapshot.filter(({ key }) => key.startsWith(prefix) && !referenced.has(key) && !this.activeAttachmentKeys.has(key));
    const orphaned: string[] = [];
    for (const { key, revision } of candidates) {
      if (await this.attachmentStorage.deleteIfUnleased(key, { minimumAgeMs: 60_000, expectedRevision: revision })) orphaned.push(key);
    }
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
      if (Object.hasOwn(supplied, "data")) {
        const unknownEnvelopeFields = Object.keys(supplied).filter((key) => !["id", "position", "data"].includes(key));
        if (unknownEnvelopeFields.length > 0) {
          throw new FramekitError("FIELD_VALIDATION_FAILED", "One or more child fields failed validation.", 422, {
            violations: unknownEnvelopeFields.map((name) => ({ field: `${field.name}.${name}`, rule: "schema", code: "unknown_field" }))
          });
        }
      }
      if (Object.hasOwn(supplied, "id") && typeof supplied.id !== "string") {
        throw new FramekitError("VALIDATION_FAILED", `${doctype.name}.${field.name}[${position}].id must be a string`, 422);
      }
      if (Object.hasOwn(supplied, "position") && (!Number.isInteger(supplied.position) || Number(supplied.position) < 0)) {
        throw new FramekitError("VALIDATION_FAILED", `${doctype.name}.${field.name}[${position}].position must be a non-negative integer`, 422);
      }
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
    return `${prefix}-${this.idGenerator()}`;
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

async function sha256Digest(bytes: Uint8Array): Promise<string> {
  return `sha256:${base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))))}`;
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

export function createRuntime(app: AppDefinition, options?: RuntimeOptions): FramekitRuntime { return new FramekitRuntime(app, options); }

function fieldStorageContract(field: FieldDefinition): string {
  const exact = field.type === "decimal" || field.type === "currency"
    ? `${field.type}(${decimalPrecision(field)},${decimalScale(field)})`
    : field.type;
  return field.computed ? `${exact}:computed:${JSON.stringify(field.computed)}` : exact;
}

function settingStorageContract(setting: SettingDefinition): Pick<SettingDefinition, "type" | "scope" | "required" | "default" | "options"> {
  return { type: setting.type, scope: setting.scope, required: setting.required, ...(setting.default === undefined ? {} : { default: setting.default }), ...(setting.options === undefined ? {} : { options: setting.options }) };
}

function settingScopeId(definition: SettingDefinition, tenant: TenantContext, appName: string): string {
  return definition.scope === "app" ? `app:${appName}` : `tenant:${tenant.tenantId}`;
}

function base64Url(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }

function sagaProgress(record: SagaRecord): SagaProgress {
  return {
    phase: record.phase, nextStep: record.nextStep, activeStep: record.activeStep,
    compensationIndex: record.compensationIndex, documents: record.documents,
    failure: record.failure, compensationFailure: record.compensationFailure
  };
}

function sagaStepKey(key: string, phase: "running" | "compensating", index: number): string {
  return `framekit:saga:${JSON.stringify([key, phase, index])}`;
}

function sagaFingerprint(tenant: TenantContext, command: string, operations: DocumentCommandOperation[]): string {
  return mutationFingerprint(`saga:${command}`, command, { principal: { tenantId: tenant.tenantId, userId: tenant.userId }, operations });
}

function sagaStepFingerprint(tenant: TenantContext, command: string, phase: string, operation: DocumentCommandOperation): string {
  return mutationFingerprint(`saga:${command}:${phase}`, operation.doctype, { principal: { tenantId: tenant.tenantId, userId: tenant.userId }, operation });
}

function sagaFailure(error: unknown): { code?: string; message: string } {
  return { code: error instanceof FramekitError ? error.code : undefined, message: error instanceof Error ? error.message : String(error) };
}

function isSagaLeaseLost(error: unknown): boolean {
  return error instanceof FramekitError && error.code === "COMMAND_SAGA_LEASE_LOST";
}

function sagaFailed(command: string, journal: SagaRecord): FramekitError {
  return new FramekitError("COMMAND_SAGA_FAILED", `Command "${command}" failed and compensation ${journal.phase === "compensated" ? "completed" : "must be resumed"}.`, 409, {
    cause: journal.failure?.message, causeCode: journal.failure?.code,
    compensationFailures: journal.compensationFailure ? [journal.compensationFailure] : []
  });
}

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

import type { MigrationChange, MigrationRollback, MigrationPlan, MigrationConversionParameters, MigrationRecord, ExecutableMigrationArtifact } from "./types.js";
export function migrationChange(change: Omit<MigrationChange, "rollback">): MigrationChange {
  if (change.kind === "remove_doctype" || change.kind === "remove_field" || change.kind === "add_setting" || change.kind === "remove_setting") return { ...change };
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
    case "add_setting":
      return { kind: "remove_setting", doctype: "settings", field: change.field, destructive: true, from: change.to };
    case "remove_setting":
      throw new FramekitError("IRREVERSIBLE_MIGRATION", `Removing setting ${change.field} cannot restore prior values automatically.`, 409);
    case "change_setting":
      return { kind: "change_setting", doctype: "settings", field: change.field, destructive: true, from: change.to, to: change.from };
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
  const changeKinds = new Set(["add_doctype", "remove_doctype", "add_field", "remove_field", "change_field_type", "change_collection_schema", "add_index", "remove_index", "add_unique_constraint", "remove_unique_constraint", "change_row_policy", "add_setting", "remove_setting", "change_setting"]);
  const constraints = [...plan.fromUniqueConstraints, ...plan.toUniqueConstraints];
  if (constraints.some((constraint) => !constraint || !identifier.test(constraint.doctype) || !identifier.test(constraint.field))) {
    throw new FramekitError("INVALID_MIGRATION_PLAN", "Migration uniqueness metadata contains an invalid DocType or field identifier.", 422);
  }
  for (const change of plan.changes) {
    const settingChange = change && (change.kind === "add_setting" || change.kind === "remove_setting" || change.kind === "change_setting");
    if (!change || !changeKinds.has(change.kind) || !identifier.test(change.doctype) || typeof change.field !== "string" || (settingChange && (change.doctype !== "settings" || !/^[a-z][a-z0-9_.-]*$/.test(change.field)))) {
      throw new FramekitError("INVALID_MIGRATION_PLAN", "Migration changes contain an invalid DocType or field identifier.", 422);
    }
    const fields = change.field === "*" ? ["*"] : change.field.split(",");
    if (!settingChange && fields.some((field) => field !== "*" && !identifier.test(field))) {
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

export function secretStorageFailure(): FramekitError {
  return new FramekitError("SECRET_STORAGE_FAILED", "Secret storage operation failed.", 503);
}

export function appUniqueConstraints(app: AppDefinition): Array<{ doctype: string; field: string }> {
  return app.modules.flatMap((module) => module.doctypes.flatMap((doctype) =>
    doctype.fields.filter((field) => field.unique).map((field) => ({ doctype: doctype.name, field: field.name }))
  )).sort((left, right) => `${left.doctype}.${left.field}`.localeCompare(`${right.doctype}.${right.field}`));
}

export function assertMigrationMetadata(app: AppDefinition): void {
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
  return change.kind === "remove_doctype" || change.kind === "remove_field" || change.kind === "change_field_type" || change.kind === "change_collection_schema" || change.kind === "change_row_policy" || change.kind === "remove_setting" || change.kind === "change_setting";
}

export function assertSupportedMigration(plan: MigrationPlan): void {
  const unsupported = plan.changes.filter((change) => change.kind === "change_field_type" || change.kind === "change_collection_schema" || change.kind === "remove_setting" || change.kind === "change_setting");
  if (unsupported.length > 0) {
    throw new FramekitError("UNSUPPORTED_MIGRATION_CONVERSION", "Automatic field or collection-schema conversion is not supported; provide an operator-reviewed data migration.", 422, unsupported);
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function indexKey(fields: string[]): string {
  return fields.join(",");
}

export function cloneMigrationRecord(record: MigrationRecord): MigrationRecord {
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

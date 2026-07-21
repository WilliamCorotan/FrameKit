import { z } from "zod";

export const fieldTypes = [
  "text",
  "long_text",
  "number",
  "decimal",
  "currency",
  "boolean",
  "date",
  "datetime",
  "select",
  "link",
  "json"
] as const;

export type FieldType = (typeof fieldTypes)[number];
export type DocumentAction = "create" | "read" | "update" | "delete" | "submit" | "cancel" | "transition" | "transfer_owner";
export type DocumentStatus = "draft" | "submitted" | "cancelled";

export const FieldValidatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("length"), min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() }).strict(),
  z.object({ kind: z.literal("range"), min: z.union([z.string(), z.number()]).optional(), max: z.union([z.string(), z.number()]).optional() }).strict(),
  z.object({ kind: z.literal("pattern"), pattern: z.enum(["email", "uuid", "slug", "alphanumeric"]) }).strict(),
  z.object({ kind: z.literal("domain"), values: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1) }).strict()
]);

const ComputedDependenciesSchema = z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1);
export const ComputedFieldSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("sum"), dependencies: ComputedDependenciesSchema }).strict(),
  z.object({ operation: z.literal("subtract"), dependencies: ComputedDependenciesSchema }).strict(),
  z.object({ operation: z.literal("multiply"), dependencies: ComputedDependenciesSchema }).strict(),
  z.object({ operation: z.literal("concat"), dependencies: ComputedDependenciesSchema, separator: z.string().optional() }).strict()
]);

export const FieldSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  type: z.enum(fieldTypes),
  precision: z.number().int().min(1).max(100).optional(),
  scale: z.number().int().min(0).max(50).optional(),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  linkTo: z.string().optional(),
  default: z.unknown().optional(),
  readOnly: z.boolean().default(false),
  inList: z.boolean().default(false),
  description: z.string().optional(),
  validators: z.array(FieldValidatorSchema).default([]),
  computed: ComputedFieldSchema.optional()
});

export type FieldDefinition = z.infer<typeof FieldSchema>;

export function decimalPrecision(field: Pick<FieldDefinition, "type" | "precision">): number {
  return field.precision ?? 18;
}

export function decimalScale(field: Pick<FieldDefinition, "type" | "scale">): number {
  return field.scale ?? (field.type === "currency" ? 2 : 6);
}

export const CustomFieldSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  doctype: z.string().min(1),
  field: FieldSchema
});

export type CustomFieldDefinition = z.infer<typeof CustomFieldSchema>;

export const ViewSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  doctype: z.string().min(1),
  type: z.enum(["list", "form"]),
  fields: z.array(z.string().min(1)).default([])
});

export type ViewDefinition = z.infer<typeof ViewSchema>;

export const PermissionRuleSchema = z.object({
  action: z.enum(["create", "read", "update", "delete", "submit", "cancel", "transition", "transfer_owner"]),
  roles: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([])
});

export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

export const WorkflowTransitionSchema = z.object({
  action: z.string().min(1),
  from: z.array(z.string()).min(1),
  to: z.string().min(1),
  roles: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([])
});

export type WorkflowTransition = z.infer<typeof WorkflowTransitionSchema>;

export const WorkflowSchema = z.object({
  field: z.string().default("status"),
  initialState: z.string().min(1),
  states: z.array(z.string()).min(1),
  transitions: z.array(WorkflowTransitionSchema).default([])
});

export type WorkflowDefinition = z.infer<typeof WorkflowSchema>;

export const RowPolicyRuleSchema = z.object({
  owner: z.enum(["any", "self"]).default("any"),
  roles: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([])
}).strict();

export type RowPolicyRule = z.infer<typeof RowPolicyRuleSchema>;

export const RowPolicySchema = z.object({
  read: z.array(RowPolicyRuleSchema).min(1),
  write: z.array(RowPolicyRuleSchema).min(1)
}).strict();

export type RowPolicy = z.infer<typeof RowPolicySchema>;

export const DocTypeSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(FieldSchema).default([]),
  permissions: z.array(PermissionRuleSchema).default([]),
  ownership: z.object({
    transferRoles: z.array(z.string()).default([]),
    transferPermissions: z.array(z.string()).default([])
  }).strict().optional(),
  rowPolicy: RowPolicySchema.optional(),
  workflow: WorkflowSchema.optional(),
  naming: z
    .object({
      prefix: z.string().optional(),
      field: z.string().optional(),
      series: z.boolean().default(false),
      digits: z.number().int().min(1).max(12).default(5)
    })
    .default({ series: false, digits: 5 }),
  indexes: z.array(z.array(z.string()).min(1)).default([]),
  views: z.array(ViewSchema.omit({ tenantId: true })).default([])
});

export type DocTypeDefinition = z.infer<typeof DocTypeSchema>;

export const HookNames = [
  "beforeValidate",
  "beforeInsert",
  "afterInsert",
  "beforeUpdate",
  "afterUpdate",
  "beforeDelete",
  "afterDelete",
  "beforeTransition",
  "afterTransition",
  "beforeSubmit",
  "afterSubmit",
  "beforeCancel",
  "afterCancel",
  "beforeOwnerTransfer",
  "afterOwnerTransfer"
] as const;

export type HookName = (typeof HookNames)[number];

export type TenantContext = {
  tenantId: string;
  userId: string;
  roles: string[];
  permissions: string[];
};

export type DocumentData = Record<string, unknown>;

export type DocumentRecord<TData extends DocumentData = DocumentData> = {
  id: string;
  doctype: string;
  tenantId: string;
  revision: number;
  documentStatus: DocumentStatus;
  ownerId?: string;
  data: TData;
  state?: string;
  createdAt: string;
  updatedAt: string;
};

export type OwnerTransferReceipt = {
  id: string;
  ownerId: string;
  revision: number;
  updatedAt: string;
};

export type HookContext<TData extends DocumentData = DocumentData> = {
  app: AppDefinition;
  doctype: DocTypeDefinition;
  tenant: TenantContext;
  document?: DocumentRecord<TData>;
  input?: TData;
};

export type DocumentHook = (context: HookContext) => void | Promise<void>;

export type ModuleHooks = Partial<Record<HookName, Record<string, DocumentHook[]>>>;

const DocumentHookSchema = z.custom<DocumentHook>((value) => typeof value === "function", "Hook must be a function");
const HookTargetSchema = z.record(z.string().min(1), z.array(DocumentHookSchema).min(1));
const ModuleHooksSchema: z.ZodType<ModuleHooks> = z.object(
  Object.fromEntries(HookNames.map((name) => [name, HookTargetSchema.optional()])) as Record<HookName, z.ZodOptional<typeof HookTargetSchema>>
).strict();

const SemVerSchema = z.string().regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  "Version must be valid SemVer"
);

export const NavigationItemSchema = z.object({
  label: z.string().min(1),
  path: z.string().min(1),
  icon: z.string().optional(),
  permission: z.string().optional(),
  order: z.number().default(100)
});

export type NavigationItem = z.infer<typeof NavigationItemSchema>;

export const CommandDefinitionSchema = z.object({
  id: z.string().min(1).regex(/^[a-z][a-z0-9_-]*$/),
  label: z.string().min(1),
  permission: z.string().min(1),
  mode: z.enum(["atomic", "saga"]).default("atomic"),
  doctypes: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1),
  operations: z.array(z.enum(["create", "update", "delete"])).min(1).default(["create", "update"]),
  maxOperations: z.number().int().min(1).max(1000).default(100)
}).strict();

export type CommandDefinition = z.infer<typeof CommandDefinitionSchema>;

const CommandDocumentDataSchema = z.record(z.string(), z.unknown());
const CommandRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const CommandCreateSchema = z.object({
  operation: z.literal("create"), doctype: z.string().regex(/^[a-z][a-z0-9_]*$/), id: z.string().min(1).optional(), data: CommandDocumentDataSchema
}).strict();
const CommandUpdateSchema = z.object({
  operation: z.literal("update"), doctype: z.string().regex(/^[a-z][a-z0-9_]*$/), id: z.string().min(1), data: CommandDocumentDataSchema,
  expectedRevision: CommandRevisionSchema
}).strict();
const CommandDeleteSchema = z.object({
  operation: z.literal("delete"), doctype: z.string().regex(/^[a-z][a-z0-9_]*$/), id: z.string().min(1), expectedRevision: CommandRevisionSchema
}).strict();

export const DocumentCommandCompensationSchema = z.discriminatedUnion("operation", [CommandCreateSchema, CommandUpdateSchema, CommandDeleteSchema]);
export const DocumentCommandOperationSchema = z.discriminatedUnion("operation", [
  CommandCreateSchema.extend({ compensation: DocumentCommandCompensationSchema.optional() }).strict(),
  CommandUpdateSchema.extend({ compensation: DocumentCommandCompensationSchema.optional() }).strict(),
  CommandDeleteSchema.extend({ compensation: DocumentCommandCompensationSchema.optional() }).strict()
]);
export const DocumentCommandRequestSchema = z.object({
  operations: z.array(DocumentCommandOperationSchema).min(1),
  idempotencyKey: z.string().min(1).optional()
}).strict();

export type DocumentCommandOperation = z.infer<typeof DocumentCommandOperationSchema>;
export type DocumentCommandRequest = z.infer<typeof DocumentCommandRequestSchema>;

export const ModuleSchema: z.ZodType<ModuleDefinition> = z.object({
  id: z.string().min(1).regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().min(1),
  version: SemVerSchema,
  description: z.string().optional(),
  dependencies: z.array(z.string()).default([]),
  doctypes: z.array(DocTypeSchema).default([]),
  permissions: z.array(z.string()).default([]),
  navigation: z.array(NavigationItemSchema).default([]),
  commands: z.array(CommandDefinitionSchema).default([]),
  hooks: ModuleHooksSchema.optional(),
  jobs: z.array(z.string()).default([]),
  settings: z.array(z.string()).default([])
});

export type ModuleDefinition = {
  id: string;
  name: string;
  version: string;
  description?: string;
  dependencies: string[];
  doctypes: DocTypeDefinition[];
  permissions: string[];
  navigation: NavigationItem[];
  commands: CommandDefinition[];
  hooks?: ModuleHooks;
  jobs: string[];
  settings: string[];
};

export const AppSchema = z.object({
  name: z.string().min(1),
  version: SemVerSchema,
  modules: z.array(ModuleSchema).default([])
});

export type AppDefinition = {
  name: string;
  version: string;
  modules: ModuleDefinition[];
};

export function defineDocType(definition: z.input<typeof DocTypeSchema>): DocTypeDefinition {
  const parsed = DocTypeSchema.parse(definition);
  const fieldNames = new Set<string>();
  for (const field of parsed.fields) {
    if (fieldNames.has(field.name)) {
      throw new Error(`Duplicate field "${field.name}" in DocType "${parsed.name}"`);
    }
    fieldNames.add(field.name);
  }
  assertDocTypeInvariants(parsed);
  return parsed;
}

export function defineModule(
  definition: Omit<Partial<ModuleDefinition>, "doctypes" | "commands"> & Pick<ModuleDefinition, "id" | "name"> & {
    doctypes?: z.input<typeof DocTypeSchema>[];
    commands?: z.input<typeof CommandDefinitionSchema>[];
  }
): ModuleDefinition {
  const doctypes = (definition.doctypes ?? []).map((doctype) => defineDocType(doctype));
  return ModuleSchema.parse({
    version: "0.1.0",
    dependencies: [],
    permissions: [],
    navigation: [],
    commands: [],
    jobs: [],
    settings: [],
    ...definition,
    doctypes
  });
}

export function defineApp(definition: Omit<Partial<AppDefinition>, "modules"> & Pick<AppDefinition, "name"> & { modules?: ModuleDefinition[] }): AppDefinition {
  const app = AppSchema.parse({
    version: "0.1.0",
    modules: [],
    ...definition
  });
  assertNoDuplicateDoctypes(app.modules);
  assertModuleDependencies(app.modules);
  assertAppReferences(app);
  return app;
}

export function getDocType(app: AppDefinition, name: string): DocTypeDefinition {
  const doctype = app.modules.flatMap((module) => module.doctypes).find((candidate) => candidate.name === name);
  if (!doctype) {
    throw new FramekitError("DOCTYPE_NOT_FOUND", `Unknown DocType "${name}"`, 404);
  }
  return doctype;
}

export function listDocTypes(app: AppDefinition): DocTypeDefinition[] {
  return app.modules.flatMap((module) => module.doctypes).sort((a, b) => a.label.localeCompare(b.label));
}

export function listNavigation(app: AppDefinition): NavigationItem[] {
  return app.modules.flatMap((module) => module.navigation).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export function hasAccess(context: TenantContext, rule: PermissionRule | WorkflowTransition | RowPolicyRule): boolean {
  const roleAllowed = context.roles.includes("*") || rule.roles.length === 0 || rule.roles.some((role) => context.roles.includes(role));
  const permissionAllowed = context.permissions.includes("*") || rule.permissions.length === 0 || rule.permissions.some((permission) => context.permissions.includes(permission));
  return roleAllowed && permissionAllowed;
}

export type RowPolicyScope = "all" | "self" | "none";

export function rowPolicyScope(context: TenantContext, doctype: DocTypeDefinition, operation: "read" | "write"): RowPolicyScope {
  if (!doctype.rowPolicy || context.roles.includes("*") || context.permissions.includes("*")) return "all";
  const matched = doctype.rowPolicy[operation].filter((rule) => hasAccess(context, rule));
  if (matched.some((rule) => rule.owner === "any")) return "all";
  return matched.some((rule) => rule.owner === "self") ? "self" : "none";
}

export function hasRowAccess(context: TenantContext, doctype: DocTypeDefinition, operation: "read" | "write", ownerId?: string): boolean {
  const scope = rowPolicyScope(context, doctype, operation);
  return scope === "all" || (scope === "self" && ownerId === context.userId);
}

export function canTransferOwnership(context: TenantContext, doctype: DocTypeDefinition): boolean {
  if (!doctype.ownership) return false;
  if (context.roles.includes("*") || context.permissions.includes("*")) return true;
  const rule = { owner: "any" as const, roles: doctype.ownership.transferRoles, permissions: doctype.ownership.transferPermissions };
  return rule.roles.length + rule.permissions.length > 0 && hasAccess(context, rule);
}

export function assertPermission(context: TenantContext, doctype: DocTypeDefinition, action: DocumentAction): void {
  const rules = doctype.permissions.filter((rule) => rule.action === action);
  if (rules.length === 0) {
    return;
  }
  if (!rules.some((rule) => hasAccess(context, rule))) {
    throw new FramekitError("FORBIDDEN", `Missing permission to ${action} ${doctype.name}`, 403);
  }
}

export class FramekitError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "FramekitError";
  }
}

function assertNoDuplicateDoctypes(modules: ModuleDefinition[]): void {
  const names = new Set<string>();
  for (const doctype of modules.flatMap((module) => module.doctypes)) {
    if (names.has(doctype.name)) {
      throw new Error(`Duplicate DocType "${doctype.name}"`);
    }
    names.add(doctype.name);
  }
}

function assertModuleDependencies(modules: ModuleDefinition[]): void {
  const ids = new Set<string>();
  for (const module of modules) {
    if (ids.has(module.id)) throw new Error(`Duplicate module id "${module.id}"`);
    ids.add(module.id);
  }
  for (const module of modules) {
    const dependencies = new Set<string>();
    for (const dependency of module.dependencies) {
      if (dependencies.has(dependency)) throw new Error(`Module "${module.id}" declares duplicate dependency "${dependency}"`);
      dependencies.add(dependency);
      if (!ids.has(dependency)) {
        throw new Error(`Module "${module.id}" requires missing dependency "${dependency}"`);
      }
      if (dependency === module.id) throw new Error(`Module "${module.id}" cannot depend on itself`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (visiting.has(id)) throw new Error(`Module dependency cycle: ${[...path, id].join(" -> ")}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const module = modules.find((candidate) => candidate.id === id)!;
    for (const dependency of module.dependencies) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const module of modules) visit(module.id, []);
}

function assertDocTypeInvariants(doctype: DocTypeDefinition): void {
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
  if (doctype.rowPolicy && !doctype.ownership && [...doctype.rowPolicy.read, ...doctype.rowPolicy.write].some((rule) => rule.owner === "self")) {
    throw new Error(`DocType "${doctype.name}" uses owner policies without ownership metadata`);
  }
  for (const field of doctype.fields) {
    const exactDecimal = field.type === "decimal" || field.type === "currency";
    if (exactDecimal) {
      if (decimalScale(field) > decimalPrecision(field)) throw new Error(`Scale for "${doctype.name}.${field.name}" cannot exceed precision`);
      if (field.default !== undefined) field.default = canonicalExactValue(field.default, field, `${doctype.name}.${field.name} default`);
    } else if (field.precision !== undefined || field.scale !== undefined) {
      throw new Error(`Only decimal and currency fields may declare precision or scale: "${doctype.name}.${field.name}"`);
    }
    if (field.type === "select") {
      if (!field.options?.length) throw new Error(`Select field "${doctype.name}.${field.name}" requires options`);
      if (new Set(field.options).size !== field.options.length) throw new Error(`Select field "${doctype.name}.${field.name}" has duplicate options`);
      if (field.default !== undefined && !field.options.includes(String(field.default))) {
        throw new Error(`Default for "${doctype.name}.${field.name}" is not a select option`);
      }
    } else if (field.options) {
      throw new Error(`Only select fields may define options: "${doctype.name}.${field.name}"`);
    }
    if (field.type === "link" && !field.linkTo) throw new Error(`Link field "${doctype.name}.${field.name}" requires linkTo`);
    if (field.type !== "link" && field.linkTo) throw new Error(`Only link fields may define linkTo: "${doctype.name}.${field.name}"`);
    if (field.unique && field.type === "json") throw new Error(`JSON field "${doctype.name}.${field.name}" cannot be unique`);
    if (field.computed) {
      if (field.computed.dependencies.includes(field.name)) throw new Error(`Computed field "${doctype.name}.${field.name}" cannot depend on itself`);
      for (const dependency of field.computed.dependencies) {
        if (!fields.has(dependency)) throw new Error(`Computed field "${doctype.name}.${field.name}" references unknown dependency "${dependency}"`);
      }
      if (["sum", "subtract", "multiply"].includes(field.computed.operation) && !exactDecimal) {
        throw new Error(`Computed ${field.computed.operation} field "${doctype.name}.${field.name}" must be decimal or currency`);
      }
      if (field.computed.operation === "concat" && !["text", "long_text"].includes(field.type)) {
        throw new Error(`Computed concat field "${doctype.name}.${field.name}" must be text or long_text`);
      }
      if (field.computed.operation === "subtract" && field.computed.dependencies.length !== 2) throw new Error(`Computed subtract field "${doctype.name}.${field.name}" requires exactly two dependencies`);
      if (field.computed.operation === "multiply" && field.computed.dependencies.length < 2) throw new Error(`Computed multiply field "${doctype.name}.${field.name}" requires at least two dependencies`);
      for (const dependency of field.computed.dependencies) {
        const dependencyType = fields.get(dependency)!.type;
        if (["sum", "subtract", "multiply"].includes(field.computed.operation) && !["decimal", "currency"].includes(dependencyType)) {
          throw new Error(`Computed ${field.computed.operation} field "${doctype.name}.${field.name}" requires decimal dependencies`);
        }
        if (field.computed.operation === "concat" && dependencyType === "json") throw new Error(`Computed concat field "${doctype.name}.${field.name}" cannot depend on JSON`);
      }
    }
    for (const validator of field.validators) {
      if (validator.kind === "length") {
        if (!["text", "long_text", "select", "link"].includes(field.type)) throw new Error(`Length validator on "${doctype.name}.${field.name}" requires a string field`);
        if (validator.min === undefined && validator.max === undefined) throw new Error(`Length validator on "${doctype.name}.${field.name}" requires min or max`);
        if (validator.min !== undefined && validator.max !== undefined && validator.min > validator.max) throw new Error(`Length validator on "${doctype.name}.${field.name}" has min greater than max`);
      }
      if (validator.kind === "range") {
        if (!["number", "decimal", "currency"].includes(field.type)) throw new Error(`Range validator on "${doctype.name}.${field.name}" requires a numeric field`);
        if (validator.min === undefined && validator.max === undefined) throw new Error(`Range validator on "${doctype.name}.${field.name}" requires min or max`);
        if (exactDecimal) {
          const min = validator.min === undefined ? undefined : exactDecimalCoefficient(validator.min, field, `${doctype.name}.${field.name} minimum`);
          const max = validator.max === undefined ? undefined : exactDecimalCoefficient(validator.max, field, `${doctype.name}.${field.name} maximum`);
          if (min !== undefined && max !== undefined && min > max) throw new Error(`Range validator on "${doctype.name}.${field.name}" has min greater than max`);
          if (validator.min !== undefined) validator.min = canonicalExactValue(validator.min, field, `${doctype.name}.${field.name} minimum`);
          if (validator.max !== undefined) validator.max = canonicalExactValue(validator.max, field, `${doctype.name}.${field.name} maximum`);
        } else {
          for (const [label, bound] of [["minimum", validator.min], ["maximum", validator.max]] as const) {
            if (bound !== undefined && (typeof bound !== "number" || !Number.isFinite(bound) || Math.abs(bound) > Number.MAX_SAFE_INTEGER)) {
              throw new Error(`${label} for "${doctype.name}.${field.name}" must be a finite safe number`);
            }
          }
          if (validator.min !== undefined && validator.max !== undefined && validator.min > validator.max) throw new Error(`Range validator on "${doctype.name}.${field.name}" has min greater than max`);
        }
      }
      if (validator.kind === "pattern" && !["text", "long_text", "link"].includes(field.type)) throw new Error(`Pattern validator on "${doctype.name}.${field.name}" requires a string field`);
      if (validator.kind === "domain") {
        if (field.type === "json") throw new Error(`Domain validator on "${doctype.name}.${field.name}" cannot target JSON`);
        const canonical = validator.values.map((value) => canonicalDomainValue(field, value, `${doctype.name}.${field.name}`));
        if (new Set(canonical).size !== canonical.length) throw new Error(`Domain validator on "${doctype.name}.${field.name}" has duplicate canonical values`);
        validator.values.splice(0, validator.values.length, ...canonical.map((value) => JSON.parse(value.slice(value.indexOf(":") + 1)) as string | number | boolean));
      }
    }
  }
  const visitingComputed = new Set<string>();
  const visitedComputed = new Set<string>();
  const visitComputed = (name: string, path: string[]) => {
    if (visitingComputed.has(name)) throw new Error(`Computed field dependency cycle: ${[...path, name].join(" -> ")}`);
    if (visitedComputed.has(name)) return;
    visitingComputed.add(name);
    const field = fields.get(name);
    for (const dependency of field?.computed?.dependencies ?? []) {
      if (fields.get(dependency)?.computed) visitComputed(dependency, [...path, name]);
    }
    visitingComputed.delete(name);
    visitedComputed.add(name);
  };
  for (const field of doctype.fields.filter((candidate) => candidate.computed)) visitComputed(field.name, []);
  const indexes = new Set<string>();
  for (const index of doctype.indexes) {
    if (new Set(index).size !== index.length) throw new Error(`Index on "${doctype.name}" repeats a field`);
    for (const field of index) if (!fields.has(field)) throw new Error(`Index on "${doctype.name}" references unknown field "${field}"`);
    const key = index.join("\u0000");
    if (indexes.has(key)) throw new Error(`Duplicate index on "${doctype.name}": ${index.join(", ")}`);
    indexes.add(key);
  }
  if (doctype.naming.field) {
    const field = fields.get(doctype.naming.field);
    if (!field) throw new Error(`Naming field "${doctype.naming.field}" does not exist on "${doctype.name}"`);
    if (field.type !== "text") throw new Error(`Naming field "${doctype.name}.${field.name}" must be text`);
    if (doctype.naming.series) throw new Error(`DocType "${doctype.name}" cannot combine field naming with a series`);
  }
  const viewIds = new Set<string>();
  for (const view of doctype.views) {
    if (view.doctype !== doctype.name) throw new Error(`View "${view.id}" belongs to "${view.doctype}", not "${doctype.name}"`);
    if (viewIds.has(view.id)) throw new Error(`Duplicate view id "${view.id}" on "${doctype.name}"`);
    viewIds.add(view.id);
    if (new Set(view.fields).size !== view.fields.length) throw new Error(`View "${view.id}" repeats a field`);
    for (const field of view.fields) if (!fields.has(field)) throw new Error(`View "${view.id}" references unknown field "${field}"`);
  }
  if (!doctype.workflow) return;
  const workflow = doctype.workflow;
  const workflowField = fields.get(workflow.field);
  if (!workflowField) throw new Error(`Workflow field "${workflow.field}" does not exist on "${doctype.name}"`);
  if (workflowField.type !== "select") throw new Error(`Workflow field "${doctype.name}.${workflow.field}" must be select`);
  if (workflowField.default !== undefined && workflowField.default !== workflow.initialState) {
    throw new Error(`Workflow field default for "${doctype.name}.${workflow.field}" must match initial state "${workflow.initialState}"`);
  }
  if (new Set(workflow.states).size !== workflow.states.length) throw new Error(`Workflow on "${doctype.name}" has duplicate states`);
  const states = new Set(workflow.states);
  if (!states.has(workflow.initialState)) throw new Error(`Workflow initial state "${workflow.initialState}" is not listed in states`);
  for (const state of states) {
    if (!workflowField.options?.includes(state)) throw new Error(`Workflow state "${state}" is not an option of "${doctype.name}.${workflow.field}"`);
  }
  const endpoints = new Set<string>();
  for (const transition of workflow.transitions) {
    if (!states.has(transition.to)) throw new Error(`Workflow transition "${transition.action}" targets unknown state "${transition.to}"`);
    if (new Set(transition.from).size !== transition.from.length) throw new Error(`Workflow transition "${transition.action}" repeats a source state`);
    for (const from of transition.from) {
      if (!states.has(from)) throw new Error(`Workflow transition "${transition.action}" starts from unknown state "${from}"`);
      const endpoint = `${transition.action}\u0000${from}`;
      if (endpoints.has(endpoint)) throw new Error(`Workflow action "${transition.action}" is ambiguous from state "${from}"`);
      endpoints.add(endpoint);
    }
  }
}

function exactDecimalCoefficient(value: unknown, field: FieldDefinition, label: string): bigint {
  if (typeof value !== "string") throw new Error(`${label} must use an exact decimal string`);
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match) throw new Error(`${label} is not a base-10 decimal`);
  const fraction = match[3] ?? "";
  const scale = decimalScale(field);
  if (fraction.length > scale) throw new Error(`${label} exceeds scale ${scale}`);
  const integerDigits = match[2] === "0" ? 0 : match[2]!.length;
  if (integerDigits + scale > decimalPrecision(field)) throw new Error(`${label} exceeds precision ${decimalPrecision(field)}`);
  const coefficient = BigInt(`${match[1] === "-" ? "-" : ""}${match[2]}${fraction.padEnd(scale, "0")}`);
  return coefficient;
}

function canonicalDomainValue(field: FieldDefinition, value: string | number | boolean, label: string): string {
  if (field.type === "decimal" || field.type === "currency") {
    return `string:${JSON.stringify(canonicalExactValue(value, field, `${label} domain value`))}`;
  }
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error(`Domain value for "${label}" must be a finite safe number`);
    return `number:${JSON.stringify(value)}`;
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`Domain value for "${label}" must be boolean`);
    return `boolean:${JSON.stringify(value)}`;
  }
  if (typeof value !== "string") throw new Error(`Domain value for "${label}" must be a string`);
  if (field.type === "select" && !field.options?.includes(value)) throw new Error(`Domain value for "${label}" must be a select option`);
  return `string:${JSON.stringify(value)}`;
}

function canonicalExactValue(value: unknown, field: FieldDefinition, label: string): string {
  const coefficient = exactDecimalCoefficient(value, field, label);
  const scale = decimalScale(field);
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const normalized = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${normalized}` : normalized;
}

function assertAppReferences(app: AppDefinition): void {
  const doctypes = new Map(app.modules.flatMap((module) => module.doctypes).map((doctype) => [doctype.name, doctype]));
  const appCommandIds = new Set<string>();
  for (const doctype of doctypes.values()) {
    for (const field of doctype.fields) {
      if (field.type === "link" && !doctypes.has(field.linkTo!)) {
        throw new Error(`Link field "${doctype.name}.${field.name}" targets unknown DocType "${field.linkTo}"`);
      }
    }
  }
  for (const module of app.modules) {
    const commandIds = new Set<string>();
    for (const command of module.commands) {
      if (commandIds.has(command.id)) throw new Error(`Duplicate command id "${command.id}" in module "${module.id}"`);
      commandIds.add(command.id);
      if (appCommandIds.has(command.id)) throw new Error(`Duplicate command id "${command.id}" across modules`);
      appCommandIds.add(command.id);
      for (const doctype of command.doctypes) {
        if (!doctypes.has(doctype)) throw new Error(`Command "${command.id}" in module "${module.id}" targets unknown DocType "${doctype}"`);
      }
      if (new Set(command.doctypes).size !== command.doctypes.length) throw new Error(`Command "${command.id}" repeats a DocType`);
      if (new Set(command.operations).size !== command.operations.length) throw new Error(`Command "${command.id}" repeats an operation`);
    }
    for (const [hookName, hooks] of Object.entries(module.hooks ?? {})) {
      for (const doctype of Object.keys(hooks ?? {})) {
        if (!doctypes.has(doctype)) throw new Error(`Hook "${hookName}" in module "${module.id}" targets unknown DocType "${doctype}"`);
      }
    }
  }
}

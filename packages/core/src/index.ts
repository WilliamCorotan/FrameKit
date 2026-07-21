import { z } from "zod";

export const fieldTypes = [
  "text",
  "long_text",
  "number",
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

export const FieldSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  type: z.enum(fieldTypes),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  linkTo: z.string().optional(),
  default: z.unknown().optional(),
  readOnly: z.boolean().default(false),
  inList: z.boolean().default(false),
  description: z.string().optional()
});

export type FieldDefinition = z.infer<typeof FieldSchema>;

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
});

export type RowPolicyRule = z.infer<typeof RowPolicyRuleSchema>;

export const RowPolicySchema = z.object({
  read: z.array(RowPolicyRuleSchema).min(1),
  write: z.array(RowPolicyRuleSchema).min(1)
});

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
  }).optional(),
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
  "afterCancel"
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

export const ModuleSchema: z.ZodType<ModuleDefinition> = z.object({
  id: z.string().min(1).regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().min(1),
  version: SemVerSchema,
  description: z.string().optional(),
  dependencies: z.array(z.string()).default([]),
  doctypes: z.array(DocTypeSchema).default([]),
  permissions: z.array(z.string()).default([]),
  navigation: z.array(NavigationItemSchema).default([]),
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

export function defineModule(definition: Omit<Partial<ModuleDefinition>, "doctypes"> & Pick<ModuleDefinition, "id" | "name"> & { doctypes?: z.input<typeof DocTypeSchema>[] }): ModuleDefinition {
  const doctypes = (definition.doctypes ?? []).map((doctype) => defineDocType(doctype));
  return ModuleSchema.parse({
    version: "0.1.0",
    dependencies: [],
    permissions: [],
    navigation: [],
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
  }
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

function assertAppReferences(app: AppDefinition): void {
  const doctypes = new Map(app.modules.flatMap((module) => module.doctypes).map((doctype) => [doctype.name, doctype]));
  for (const doctype of doctypes.values()) {
    for (const field of doctype.fields) {
      if (field.type === "link" && !doctypes.has(field.linkTo!)) {
        throw new Error(`Link field "${doctype.name}.${field.name}" targets unknown DocType "${field.linkTo}"`);
      }
    }
  }
  for (const module of app.modules) {
    for (const [hookName, hooks] of Object.entries(module.hooks ?? {})) {
      for (const doctype of Object.keys(hooks ?? {})) {
        if (!doctypes.has(doctype)) throw new Error(`Hook "${hookName}" in module "${module.id}" targets unknown DocType "${doctype}"`);
      }
    }
  }
}

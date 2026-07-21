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
export type DocumentAction = "create" | "read" | "update" | "delete" | "submit" | "cancel" | "transition";

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
  action: z.enum(["create", "read", "update", "delete", "submit", "cancel", "transition"]),
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

export const DocTypeSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(FieldSchema).default([]),
  permissions: z.array(PermissionRuleSchema).default([]),
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
  "afterTransition"
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
  version: z.string().min(1),
  description: z.string().optional(),
  dependencies: z.array(z.string()).default([]),
  doctypes: z.array(DocTypeSchema).default([]),
  permissions: z.array(z.string()).default([]),
  navigation: z.array(NavigationItemSchema).default([]),
  hooks: z.custom<ModuleHooks>().optional(),
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
  version: z.string().min(1),
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
  if (parsed.workflow && !parsed.workflow.states.includes(parsed.workflow.initialState)) {
    throw new Error(`Workflow initial state "${parsed.workflow.initialState}" is not listed in states`);
  }
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

export function hasAccess(context: TenantContext, rule: PermissionRule | WorkflowTransition): boolean {
  const roleAllowed = context.roles.includes("*") || rule.roles.length === 0 || rule.roles.some((role) => context.roles.includes(role));
  const permissionAllowed = context.permissions.includes("*") || rule.permissions.length === 0 || rule.permissions.some((permission) => context.permissions.includes(permission));
  return roleAllowed && permissionAllowed;
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
  const ids = new Set(modules.map((module) => module.id));
  for (const module of modules) {
    for (const dependency of module.dependencies) {
      if (!ids.has(dependency)) {
        throw new Error(`Module "${module.id}" requires missing dependency "${dependency}"`);
      }
    }
  }
}

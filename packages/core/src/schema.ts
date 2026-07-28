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
  "json",
  "children",
  "attachments"
] as const;

const TranslationKeySchema = z.string().regex(/^[a-z][a-z0-9_.-]*$/);
const LocaleSchema = z.string().min(2).refine((locale) => {
  try {
    return Intl.getCanonicalLocales(locale)[0] === locale;
  } catch {
    return false;
  }
}, "Locale must be a canonical BCP 47 language tag");

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

const FieldBaseSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  labelKey: TranslationKeySchema.optional(),
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
  descriptionKey: TranslationKeySchema.optional(),
  validators: z.array(FieldValidatorSchema).default([])
});

export const ChildFieldSchema = FieldBaseSchema.extend({
  type: z.enum(["text", "long_text", "number", "decimal", "currency", "boolean", "date", "datetime", "select", "link", "json"])
});

export const FieldSchema = FieldBaseSchema.extend({
  type: z.enum(fieldTypes),
  fields: z.array(ChildFieldSchema).min(1).optional(),
  computed: ComputedFieldSchema.optional()
});

export type FieldDefinition = z.infer<typeof FieldSchema>;
export type ChildFieldDefinition = z.infer<typeof ChildFieldSchema>;

export type ChildRecord = { id: string; position: number; data: DocumentData };
export type AttachmentMetadata = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  sha256: string;
  storageKey: string;
  createdAt: string;
  createdBy: string;
  pendingDelete?: { fingerprint: string; requestedAt: string; requestedBy: string };
};

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
  labelKey: TranslationKeySchema.optional(),
  description: z.string().optional(),
  descriptionKey: TranslationKeySchema.optional(),
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
  labelKey: TranslationKeySchema.optional(),
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

export const SettingDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  label: z.string().min(1),
  labelKey: TranslationKeySchema.optional(),
  description: z.string().optional(),
  descriptionKey: TranslationKeySchema.optional(),
  type: z.enum(["text", "number", "boolean", "select", "secret"]),
  scope: z.enum(["tenant", "app"]).default("tenant"),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  options: z.array(z.string()).optional()
}).strict();

export type SettingDefinition = z.infer<typeof SettingDefinitionSchema>;

export const LocalizationSchema = z.object({
  defaultLocale: LocaleSchema.default("en"),
  supportedLocales: z.array(LocaleSchema).min(1).default(["en"]),
  fallbackLocales: z.array(LocaleSchema).default([]),
  translations: z.record(LocaleSchema, z.record(TranslationKeySchema, z.string())).default({})
}).strict();

export type LocalizationDefinition = z.infer<typeof LocalizationSchema>;

export const ModuleSchema: z.ZodType<ModuleDefinition> = z.object({
  id: z.string().min(1).regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().min(1),
  nameKey: TranslationKeySchema.optional(),
  version: SemVerSchema,
  description: z.string().optional(),
  descriptionKey: TranslationKeySchema.optional(),
  dependencies: z.array(z.string()).default([]),
  doctypes: z.array(DocTypeSchema).default([]),
  permissions: z.array(z.string()).default([]),
  navigation: z.array(NavigationItemSchema).default([]),
  commands: z.array(CommandDefinitionSchema).default([]),
  hooks: ModuleHooksSchema.optional(),
  jobs: z.array(z.string()).default([]),
  settings: z.array(SettingDefinitionSchema).default([])
});

export type ModuleDefinition = {
  id: string;
  name: string;
  nameKey?: string;
  version: string;
  description?: string;
  descriptionKey?: string;
  dependencies: string[];
  doctypes: DocTypeDefinition[];
  permissions: string[];
  navigation: NavigationItem[];
  commands: CommandDefinition[];
  hooks?: ModuleHooks;
  jobs: string[];
  settings: SettingDefinition[];
};

export const AppSchema = z.object({
  name: z.string().min(1),
  nameKey: TranslationKeySchema.optional(),
  version: SemVerSchema,
  localization: LocalizationSchema.default({ defaultLocale: "en", supportedLocales: ["en"], fallbackLocales: [], translations: {} }),
  modules: z.array(ModuleSchema).default([])
});

export type AppDefinition = {
  name: string;
  nameKey?: string;
  version: string;
  localization: LocalizationDefinition;
  modules: ModuleDefinition[];
};

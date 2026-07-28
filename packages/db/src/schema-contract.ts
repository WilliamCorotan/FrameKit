/** Fixed relational schema owned by @framekit/db, independent of Drizzle and Postgres clients. */
export type FixedSchemaColumn = Readonly<{
  name: string;
  type: "text" | "integer" | "jsonb" | "timestamptz";
  nullable: boolean;
  default?: string;
}>;

export type FixedSchemaIndex = Readonly<{
  name: string;
  columns: readonly string[];
  unique: boolean;
}>;

export type FixedSchemaTable = Readonly<{
  name: string;
  columns: readonly FixedSchemaColumn[];
  indexes: readonly FixedSchemaIndex[];
}>;

export const fixedSchema = {
  auditEvents: {
    name: "framekit_audit_events",
    columns: [
      { name: "tenant_id", type: "text", nullable: false }, { name: "id", type: "text", nullable: false },
      { name: "user_id", type: "text", nullable: false }, { name: "action", type: "text", nullable: false },
      { name: "doctype", type: "text", nullable: false }, { name: "document_id", type: "text", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false }
    ],
    indexes: [{ name: "framekit_audit_events_identity", columns: ["tenant_id", "id"], unique: true }]
  },
  outboxEvents: {
    name: "framekit_outbox_events",
    columns: [
      { name: "tenant_id", type: "text", nullable: false }, { name: "id", type: "text", nullable: false },
      { name: "type", type: "text", nullable: false }, { name: "topic", type: "text", nullable: false },
      { name: "payload", type: "jsonb", nullable: false }, { name: "status", type: "text", nullable: false },
      { name: "attempts", type: "integer", nullable: false, default: "0" }, { name: "created_at", type: "timestamptz", nullable: false },
      { name: "processed_at", type: "timestamptz", nullable: true }, { name: "error", type: "text", nullable: true },
      { name: "lease_owner", type: "text", nullable: true }, { name: "lease_expires_at", type: "timestamptz", nullable: true },
      { name: "next_attempt_at", type: "timestamptz", nullable: true }
    ],
    indexes: [{ name: "framekit_outbox_events_identity", columns: ["tenant_id", "id"], unique: true }]
  },
  customFields: {
    name: "framekit_custom_fields",
    columns: [
      { name: "tenant_id", type: "text", nullable: false }, { name: "id", type: "text", nullable: false },
      { name: "doctype", type: "text", nullable: false }, { name: "field", type: "jsonb", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false }, { name: "updated_at", type: "timestamptz", nullable: false }
    ],
    indexes: [{ name: "framekit_custom_fields_identity", columns: ["tenant_id", "id"], unique: true }]
  },
  views: {
    name: "framekit_views",
    columns: [
      { name: "tenant_id", type: "text", nullable: false }, { name: "id", type: "text", nullable: false },
      { name: "doctype", type: "text", nullable: false },
      { name: "type", type: "text", nullable: false }, { name: "fields", type: "jsonb", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false }, { name: "updated_at", type: "timestamptz", nullable: false }
    ],
    indexes: [{ name: "framekit_views_identity", columns: ["tenant_id", "id"], unique: true }]
  }
} as const satisfies Record<string, FixedSchemaTable>;

export function fixedIndex(table: FixedSchemaTable, name: string): FixedSchemaIndex {
  const index = table.indexes.find((candidate) => candidate.name === name);
  if (!index) throw new Error(`Missing fixed schema index ${name} for ${table.name}`);
  return index;
}

export function fixedTableDdl(table: FixedSchemaTable): string {
  const columns = table.columns.map((column) =>
    `  ${column.name} ${column.type}${column.nullable ? "" : " not null"}${column.default === undefined ? "" : ` default ${column.default}`}`
  );
  return `create table if not exists ${table.name} (\n${columns.join(",\n")}\n);`;
}

export function fixedIndexDdl(table: FixedSchemaTable): string {
  return table.indexes.map((index) =>
    `create ${index.unique ? "unique " : ""}index if not exists ${index.name} on ${table.name} (${index.columns.join(", ")});`
  ).join("\n");
}

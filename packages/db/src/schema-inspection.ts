import type { Sql } from "postgres";
import { fixedSchema, type FixedSchemaTable } from "./schema-contract.js";

export type SchemaIssue = {
  table: string;
  kind: "missing_table" | "missing_column" | "column_mismatch" | "missing_index" | "index_mismatch";
  detail: string;
};

/** Read-only inspection of the supplied contracts; defaults cover four fixed relational tables. */
export async function inspectPostgresSchema(sql: Sql, options: { schema?: string; tables?: readonly FixedSchemaTable[] } = {}) {
  const schema = options.schema ?? "public";
  const tables: readonly FixedSchemaTable[] = options.tables ?? Object.values(fixedSchema);
  const issues: SchemaIssue[] = [];
  for (const table of tables) {
    const [found] = await sql<{ exists: boolean }[]>`
      select exists(select 1 from information_schema.tables
        where table_schema = ${schema} and table_name = ${table.name} and table_type = 'BASE TABLE') as exists
    `;
    if (!found?.exists) {
      issues.push({ table: table.name, kind: "missing_table", detail: "table missing" });
      continue;
    }
    const columns = await sql<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]>`
      select column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema = ${schema} and table_name = ${table.name}
    `;
    for (const expected of table.columns) {
      const actual = columns.find((column) => column.column_name === expected.name);
      if (!actual) {
        issues.push({ table: table.name, kind: "missing_column", detail: expected.name });
        continue;
      }
      const type = actual.data_type === "timestamp with time zone" ? "timestamptz" : actual.data_type;
      // Contracts use PostgreSQL's canonical expression text (the built-in default is simply 0).
      const defaultMismatch = (actual.column_default ?? undefined) !== expected.default;
      if (type !== expected.type || (actual.is_nullable === "YES") !== expected.nullable || defaultMismatch) {
        issues.push({ table: table.name, kind: "column_mismatch", detail: expected.name });
      }
    }
    const indexes = await sql<{
      name: string; valid: boolean; ready: boolean; unique: boolean; plain: boolean; columns: string[];
    }[]>`
      select c.relname as name, i.indisvalid as valid, i.indisready as ready, i.indisunique as unique,
        (i.indexprs is null and i.indpred is null and not i.indisexclusion and am.amname = 'btree'
          and i.indnkeyatts = i.indnatts
          and not exists(select 1 from unnest(i.indoption) flags where flags <> 0)
          and not exists(select 1 from unnest(i.indclass) classes(oid) join pg_opclass op on op.oid = classes.oid where not op.opcdefault)
          and not exists(select 1 from unnest(i.indkey, i.indcollation) keys(attnum, collation_id)
            join pg_attribute a on a.attrelid = t.oid and a.attnum = keys.attnum where a.attcollation <> keys.collation_id)
        ) as plain,
        array(select a.attname from unnest(i.indkey) with ordinality keys(attnum, position)
          left join pg_attribute a on a.attrelid = t.oid and a.attnum = keys.attnum order by keys.position) as columns
      from pg_index i join pg_class c on c.oid = i.indexrelid join pg_class t on t.oid = i.indrelid
        join pg_namespace n on n.oid = t.relnamespace join pg_am am on am.oid = c.relam
      where n.nspname = ${schema} and t.relname = ${table.name}
    `;
    for (const expected of table.indexes) {
      const actual = indexes.find((index) => index.name === expected.name);
      if (!actual) {
        issues.push({ table: table.name, kind: "missing_index", detail: expected.name });
        continue;
      }
      if (!actual.valid || !actual.ready || !actual.plain || actual.unique !== expected.unique || JSON.stringify(actual.columns) !== JSON.stringify(expected.columns)) {
        issues.push({ table: table.name, kind: "index_mismatch", detail: expected.name });
      }
    }
  }
  return { ok: issues.length === 0, checkedTables: tables.map((table) => table.name), issues };
}

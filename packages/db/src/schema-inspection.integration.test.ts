import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { inspectPostgresSchema, type FixedSchemaTable } from "./index.js";
const url = process.env.DATABASE_URL;

it.skipIf(!url)("inspects structural catalog drift without crossing schemas", async () => {
  const sql = postgres(url!);
  const schema = `inspect_${crypto.randomUUID().replaceAll("-", "")}`;
  const otherSchema = `${schema}_other`;
  const table: FixedSchemaTable = { name: "items", columns: [{ name: "id", type: "text", nullable: false }, { name: "attempts", type: "integer", nullable: false, default: "0" }], indexes: [{ name: "items_identity", columns: ["id", "attempts"], unique: true }] };
  try {
    for (const name of [schema, otherSchema]) await sql`create schema ${sql(name)}`;
    await sql`create table ${sql(schema)}.items (id text not null, attempts integer not null default 0)`;
    await sql`create unique index items_identity on ${sql(schema)}.items (id, attempts)`;
    await sql`create table ${sql(otherSchema)}.items (id integer)`;
    expect(await inspectPostgresSchema(sql, { schema, tables: [table] })).toMatchObject({ ok: true });
    expect(await inspectPostgresSchema(sql, { schema: otherSchema, tables: [table] })).toMatchObject({ ok: false });
    await sql`drop index ${sql(schema)}.items_identity`;
    await sql`create unique index items_identity on ${sql(schema)}.items (id desc, attempts) where id is not null`;
    await sql`alter table ${sql(schema)}.items alter column attempts set default 10`;
    const result = await inspectPostgresSchema(sql, { schema, tables: [table] });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "column_mismatch", detail: "attempts" }),
      expect.objectContaining({ kind: "index_mismatch", detail: "items_identity" })
    ]));
    await sql`drop index ${sql(schema)}.items_identity`;
    await sql`create unique index items_identity on ${sql(schema)}.items (lower(id), attempts)`;
    expect((await inspectPostgresSchema(sql, { schema, tables: [table] })).issues.some((issue) => issue.kind === "index_mismatch")).toBe(true);
  } finally {
    try { for (const name of [schema, otherSchema]) await sql`drop schema if exists ${sql(name)} cascade`; }
    finally { await sql.end(); }
  }
});

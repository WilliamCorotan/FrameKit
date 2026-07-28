import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { migrationChecksum, type MigrationPlan } from "@framekit/runtime";
import {
  createApiTokenTableSql,
  createAuthIdentityLifecycleTablesSql,
  createAuditTableSql,
  createCustomFieldTableSql,
  createDocumentTableSql,
  createMigrationTableSql,
  migrationConversionArtifactDigest,
  createNamingSeriesTableSql,
  createOutboxTableSql,
  createPostgresMigrationSql,
  createPostgresMigrationStatements,
  createRoleTableSql,
  createSessionRevocationTableSql,
  createUserTableSql,
  createViewTableSql,
  PostgresMigrationStore
} from "./index.js";
import { indexIdentifier } from "./migration-sql-helpers.js";
import { framekitAuditEvents, framekitAuthIdentityLinks, framekitCustomFields, framekitOutboxEvents, framekitSessionRevocations, framekitViews } from "./schema.js";
import { fixedSchema, type FixedSchemaColumn, type FixedSchemaTable } from "./schema-contract.js";

describe("db migration sql", () => {
  it("normalizes adversarial migration identifiers in linear time", () => {
    expect(indexIdentifier({
      doctype: `${"_".repeat(10_000)}Customer`,
      field: `${"-".repeat(10_000)}region${"-".repeat(10_000)}`
    }, "idx")).toBe("framekit_documents_customer_region_idx");
  });

  it("defines document and user tables", () => {
    expect(createDocumentTableSql()).toContain("framekit_documents");
    expect(createDocumentTableSql()).toContain("document_status text not null default 'draft'");
    expect(createDocumentTableSql()).toContain("owner_id text");
    expect(createUserTableSql()).toContain("framekit_users");
    expect(createUserTableSql()).toContain("password_hash");
    expect(createUserTableSql()).toContain("disabled_at");
    expect(createUserTableSql()).toContain("failed_login_attempts");
    expect(createRoleTableSql()).toContain("framekit_roles");
    expect(createApiTokenTableSql()).toContain("framekit_api_tokens");
    expect(createApiTokenTableSql()).toContain("token_hash");
    expect(createSessionRevocationTableSql()).toContain("framekit_session_revocations");
    expect(createSessionRevocationTableSql()).toContain("session_id");
    const authLifecycleSql = createAuthIdentityLifecycleTablesSql();
    expect(authLifecycleSql).toContain("framekit_auth_identity_links");
    expect(authLifecycleSql).toContain("framekit_auth_lifecycle_tokens");
    expect(authLifecycleSql).toContain("framekit_oidc_authorization_states");
    expect(authLifecycleSql).toContain("encrypted_code_verifier");
    expect(authLifecycleSql).toContain("framekit_auth_audit_events");
    expect(createAuditTableSql()).toContain("framekit_audit_events");
    expect(createOutboxTableSql()).toContain("framekit_outbox_events");
    expect(createCustomFieldTableSql()).toContain("framekit_custom_fields");
    expect(createViewTableSql()).toContain("framekit_views");
    expect(createNamingSeriesTableSql()).toContain("framekit_naming_series");
    expect(createMigrationTableSql()).toContain("framekit_migrations");
    expect(createMigrationTableSql()).toContain("framekit_migration_runs");
    expect(createMigrationTableSql()).toContain("conversion_digest");
    expect(createMigrationTableSql()).toContain("attempt_id text");
    expect(createMigrationTableSql()).toContain("approval jsonb not null");
    expect(createMigrationTableSql()).toContain("checksum");
  });

  it("keeps authentication identity indexes aligned with generated DDL", () => {
    const ddl = `${createSessionRevocationTableSql()}\n${createAuthIdentityLifecycleTablesSql()}`;
    const drizzleIndexes = [
      ...getTableConfig(framekitSessionRevocations).indexes,
      ...getTableConfig(framekitAuthIdentityLinks).indexes
    ].map((index) => ({ name: index.config.name, unique: index.config.unique, columns: index.config.columns.map(indexColumnName) }));
    expect(parseIndexes(ddl).filter((index) => drizzleIndexes.some((candidate) => candidate.name === index.name))).toEqual(drizzleIndexes);
  });

  it("enforces fixed-schema structural parity across Drizzle and DDL", () => {
    const cases = [
      [fixedSchema.auditEvents, framekitAuditEvents, createAuditTableSql()],
      [fixedSchema.outboxEvents, framekitOutboxEvents, createOutboxTableSql()],
      [fixedSchema.customFields, framekitCustomFields, createCustomFieldTableSql()],
      [fixedSchema.views, framekitViews, createViewTableSql()]
    ] as const;

    for (const [contract, table, ddl] of cases) {
      const drizzle = getTableConfig(table);
      expect(drizzle.name).toBe(contract.name);
      expect(drizzle.columns.map((column) => ({
        name: column.name,
        type: column.getSQLType() === "timestamp with time zone" ? "timestamptz" : column.getSQLType(),
        nullable: !column.notNull,
        default: column.hasDefault ? String(column.default) : undefined
      }))).toEqual(contract.columns);
      expect(drizzle.indexes.map((index) => ({
        name: index.config.name,
        unique: index.config.unique,
        columns: index.config.columns.map(indexColumnName)
      }))).toEqual(contract.indexes);
      expect(parseFixedDdl(ddl, contract)).toEqual({ columns: contract.columns, indexes: contract.indexes });
    }
  });

  it("hashes immutable conversion artifacts and rejects duplicate registry identities", async () => {
    const artifactDigest = await migrationConversionArtifactDigest("compiled conversion module v1");
    await expect(migrationConversionArtifactDigest("compiled conversion module v1")).resolves.toBe(artifactDigest);
    await expect(migrationConversionArtifactDigest("compiled conversion module v2")).resolves.not.toBe(artifactDigest);
    const artifact = { id: "customer-score-number", version: 1, artifactDigest, convert: (value: unknown) => Number(value) };

    expect(() => new PostgresMigrationStore({
      connectionString: "postgres://localhost/framekit_registry_validation",
      conversionRegistry: [artifact, { ...artifact }]
    })).toThrow(/registered more than once/);
    expect(() => new PostgresMigrationStore({
      connectionString: "postgres://localhost/framekit_registry_validation",
      conversionRegistry: [{ ...artifact, id: "bound-conversion", convert: artifact.convert.bind(null) }]
    })).toThrow(/native or bound function/);
  });

  it("generates executable SQL for JSON document migration plans", async () => {
    const plan = await migrationPlanFixture();
    const sql = createPostgresMigrationSql(plan);

    expect(sql).toContain("jsonb_set");
    expect(sql).toContain("create index if not exists framekit_documents_customer_region_idx");
    expect(sql).toContain("create unique index if not exists framekit_documents_customer_region_uniq");
    expect(sql).toContain("data ->> 'region' <> ''");
    expect(sql).toContain("tenant_id = 'tenant_1'");
  });

  it("generates rollback statements from rollback metadata", async () => {
    const plan = await migrationPlanFixture();
    const statements = createPostgresMigrationStatements(plan, { direction: "down" });

    expect(statements).toEqual(expect.arrayContaining([
      "drop index if exists framekit_documents_customer_region_idx;",
      "drop index if exists framekit_documents_customer_region_uniq;"
    ]));
    expect(statements.some((statement) => statement.includes("data = data - 'region'"))).toBe(true);
  });
});

function parseFixedDdl(ddl: string, contract: FixedSchemaTable): { columns: FixedSchemaTable["columns"]; indexes: FixedSchemaTable["indexes"] } {
  const create = new RegExp(`create table if not exists ${contract.name} \\(([^]*?)\\n\\);`).exec(ddl)?.[1];
  if (!create) throw new Error(`Missing CREATE TABLE for ${contract.name}`);
  const columns = create.split(",\n").map((line) => {
    const match = /^\s*(\w+)\s+(text|integer|jsonb|timestamptz)(?:\s+(not null))?(?:\s+default\s+([^\s]+))?$/i.exec(line);
    if (!match) throw new Error(`Unparseable fixed-schema column: ${line}`);
    return { name: match[1]!, type: fixedColumnType(match[2]!), nullable: !match[3], ...(match[4] === undefined ? {} : { default: match[4] }) };
  });
  const indexes = parseIndexes(ddl).filter((index) => contract.indexes.some((candidate) => candidate.name === index.name));
  return { columns, indexes };
}

function indexColumnName(column: unknown): string {
  if (typeof column === "object" && column !== null && "name" in column && typeof column.name === "string") {
    return column.name;
  }
  throw new Error("Structural schema indexes must reference named columns.");
}

function fixedColumnType(value: string): FixedSchemaColumn["type"] {
  if (value === "text" || value === "integer" || value === "jsonb" || value === "timestamptz") return value;
  throw new Error(`Unsupported fixed-schema column type: ${value}`);
}

function parseIndexes(ddl: string): Array<{ name: string; unique: boolean; columns: string[] }> {
  return [...ddl.matchAll(/create (unique )?index if not exists (\w+) on \w+ \(([^)]+)\);/g)]
    .map((match) => ({ name: match[2]!, unique: Boolean(match[1]), columns: match[3]!.split(", ") }));
}

async function migrationPlanFixture(): Promise<MigrationPlan> {
  const plan = {
    id: "migration-1",
    tenantId: "tenant_1",
    appName: "CRM",
    fromSchemaChecksum: "schema-before",
    toSchemaChecksum: "schema-after",
    fromUniqueConstraints: [],
    toUniqueConstraints: [{ doctype: "customer", field: "region" }],
    createdAt: "2026-07-06T00:00:00.000Z",
    changes: [
      {
        kind: "add_field" as const,
        doctype: "customer",
        field: "region",
        destructive: false,
        to: { name: "region", label: "Region", type: "text", default: "APAC" },
        rollback: { kind: "remove_field" as const, doctype: "customer", field: "region", destructive: true }
      },
      {
        kind: "add_unique_constraint" as const,
        doctype: "customer",
        field: "region",
        destructive: false,
        to: "region",
        rollback: { kind: "remove_unique_constraint" as const, doctype: "customer", field: "region", destructive: false, from: "region" }
      },
      {
        kind: "add_index" as const,
        doctype: "customer",
        field: "region",
        destructive: false,
        to: ["region"],
        rollback: { kind: "remove_index" as const, doctype: "customer", field: "region", destructive: false, from: ["region"] }
      }
    ]
  };
  return { ...plan, checksum: await migrationChecksum(plan) };
}

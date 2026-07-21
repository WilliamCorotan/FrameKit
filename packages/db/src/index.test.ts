import { describe, expect, it } from "vitest";
import { migrationChecksum, type MigrationPlan } from "@framekit/runtime";
import {
  createApiTokenTableSql,
  createAuthIdentityLifecycleTablesSql,
  createAuditTableSql,
  createCustomFieldTableSql,
  createDocumentTableSql,
  createMigrationTableSql,
  createNamingSeriesTableSql,
  createOutboxTableSql,
  createPostgresMigrationSql,
  createPostgresMigrationStatements,
  createRoleTableSql,
  createSessionRevocationTableSql,
  createUserTableSql,
  createViewTableSql
} from "./index.js";

describe("db migration sql", () => {
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
    expect(authLifecycleSql).toContain("unique (tenant_id, provider_id, subject)");
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
    expect(createMigrationTableSql()).toContain("checksum");
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

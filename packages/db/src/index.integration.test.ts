import postgres from "postgres";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { defineApp, defineDocType, defineModule, type TenantContext } from "@framekit/core";
import { createRuntime } from "@framekit/runtime";
import {
  PostgresApiTokenStore,
  PostgresAuditStore,
  PostgresCustomizationStore,
  PostgresDocumentRepository,
  PostgresMigrationStore,
  PostgresNamingSeriesStore,
  PostgresOutboxStore,
  PostgresRoleStore,
  PostgresSessionRevocationStore,
  PostgresUserStore
} from "./index.js";

declare const process: { env: Record<string, string | undefined> };

const connectionString = process.env.DATABASE_URL;
const tenant: TenantContext = {
  tenantId: "pg_integration_tenant",
  userId: "integration-user",
  roles: ["administrator"],
  permissions: ["*"]
};

const customerDocType = defineDocType({
  name: "customer",
  label: "Customer",
  naming: { field: "name" },
  fields: [
    { name: "name", label: "Name", type: "text", required: true, inList: true },
    { name: "status", label: "Status", type: "select", options: ["active", "paused"], default: "active", inList: true },
    { name: "external_id", label: "External ID", type: "text", unique: true }
  ],
  permissions: [
    { action: "create", permissions: ["crm.customer"] },
    { action: "read", permissions: ["crm.customer"] },
    { action: "update", permissions: ["crm.customer"] },
    { action: "delete", permissions: ["crm.customer"] }
  ]
});

const dealDocType = defineDocType({
  name: "deal",
  label: "Deal",
  naming: { prefix: "DEAL", series: true, digits: 4 },
  fields: [{ name: "title", label: "Title", type: "text", required: true }],
  permissions: [
    { action: "create", permissions: ["crm.deal"] },
    { action: "read", permissions: ["crm.deal"] }
  ]
});

const app = defineApp({
  name: "Postgres Integration",
  modules: [defineModule({ id: "crm", name: "CRM", doctypes: [customerDocType, dealDocType] })]
});

describe.skipIf(!connectionString)("Postgres durable stores", () => {
  const sql = postgres(connectionString!, { max: 1 });
  const stores = {
    repository: new PostgresDocumentRepository({ connectionString: connectionString! }),
    audit: new PostgresAuditStore({ connectionString: connectionString! }),
    outbox: new PostgresOutboxStore({ connectionString: connectionString! }),
    customization: new PostgresCustomizationStore({ connectionString: connectionString! }),
    namingSeries: new PostgresNamingSeriesStore({ connectionString: connectionString! }),
    migrations: new PostgresMigrationStore({ connectionString: connectionString! }),
    userStore: new PostgresUserStore({ connectionString: connectionString! }),
    roleStore: new PostgresRoleStore({ connectionString: connectionString! }),
    apiTokenStore: new PostgresApiTokenStore({ connectionString: connectionString! }),
    sessionRevocations: new PostgresSessionRevocationStore({ connectionString: connectionString! })
  };

  beforeAll(async () => {
    await migrateAll(stores);
    await cleanup(sql);
  });

  afterAll(async () => {
    await cleanup(sql);
    await closeStores(stores);
    await sql.end({ timeout: 1 });
  });

  it("persists documents, audit, outbox, customization, naming, migrations, users, and session revocations", async () => {
    const runtime = createRuntime(app, {
      repository: stores.repository,
      audit: stores.audit,
      outbox: stores.outbox,
      customization: stores.customization,
      namingSeries: stores.namingSeries,
      migrations: stores.migrations,
      idGenerator: createIdGenerator(),
      now: () => new Date("2026-07-06T00:00:00.000Z")
    });

    const customer = await runtime.create(tenant, "customer", {
      name: "Durable Customer",
      external_id: "EXT-001"
    });
    await runtime.update(tenant, "customer", customer.id, { status: "paused" });

    await expect(runtime.get(tenant, "customer", customer.id)).resolves.toMatchObject({
      id: "durable-customer",
      data: { name: "Durable Customer", status: "paused", external_id: "EXT-001" }
    });
    await expect(runtime.list(tenant, "customer", { filters: { status: "paused" }, limit: 5 })).resolves.toHaveLength(1);

    await runtime.addCustomField(tenant, {
      doctype: "customer",
      field: { name: "region", label: "Region", type: "text" }
    });
    await runtime.upsertView(tenant, { doctype: "customer", type: "list", fields: ["name", "region"] });
    await expect(runtime.customFields(tenant)).resolves.toMatchObject([{ id: "customer.region", field: { name: "region" } }]);
    await expect(runtime.views(tenant)).resolves.toMatchObject([{ id: "pg_integration_tenant.customer.list", fields: ["name", "region"] }]);

    await expect(runtime.create(tenant, "deal", { title: "First Deal" })).resolves.toMatchObject({ id: "DEAL-0001" });
    await expect(runtime.create(tenant, "deal", { title: "Second Deal" })).resolves.toMatchObject({ id: "DEAL-0002" });

    await expect(runtime.auditTrail(tenant)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "create", doctype: "customer", documentId: customer.id }),
      expect.objectContaining({ action: "update", doctype: "customer", documentId: customer.id })
    ]));
    await expect(runtime.outboxEvents(tenant, { status: "pending" })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "customer.created", topic: "customer", status: "pending" }),
      expect.objectContaining({ type: "customer.updated", topic: "customer", status: "pending" })
    ]));

    const nextApp = defineApp({
      name: "Postgres Integration",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              ...customerDocType,
              fields: [...customerDocType.fields, { name: "segment", label: "Segment", type: "text" }]
            }),
            dealDocType
          ]
        })
      ]
    });
    const plan = await runtime.planMigration(tenant, nextApp);
    await runtime.applyMigration(tenant, plan);
    await expect(runtime.migrationHistory(tenant)).resolves.toEqual([
      expect.objectContaining({ id: plan.id, checksum: plan.checksum, changes: expect.arrayContaining([expect.objectContaining({ field: "segment" })]) })
    ]);

    await stores.userStore.upsert({
      tenantId: tenant.tenantId,
      id: "worker",
      email: "Worker@Example.com",
      name: "Worker",
      passwordHash: "hash",
      roles: ["agent"],
      permissions: ["crm.customer"],
      failedLoginAttempts: 2
    });
    await expect(stores.userStore.findByEmail("worker@example.com", tenant.tenantId)).resolves.toMatchObject({ id: "worker", failedLoginAttempts: 2 });
    await expect(stores.userStore.list(tenant.tenantId)).resolves.toEqual([expect.objectContaining({ id: "worker" })]);

    await stores.roleStore.upsert({ tenantId: tenant.tenantId, id: "agent", name: "Agent", permissions: ["crm.customer"] });
    await expect(stores.roleStore.list(tenant.tenantId)).resolves.toEqual([expect.objectContaining({ id: "agent" })]);

    await stores.apiTokenStore.create({
      tenantId: tenant.tenantId,
      id: "token-1",
      name: "CI token",
      tokenHash: "token-hash-1",
      userId: "worker",
      roles: ["agent"],
      permissions: ["crm.customer"],
      createdAt: new Date("2026-07-06T00:00:00.000Z").toISOString()
    });
    await expect(stores.apiTokenStore.findByTokenHash("token-hash-1")).resolves.toMatchObject({ id: "token-1", userId: "worker" });

    await stores.sessionRevocations.revoke("pg-integration-session", new Date(Date.now() + 60_000).toISOString());
    await expect(stores.sessionRevocations.isRevoked("pg-integration-session")).resolves.toBe(true);
    await stores.sessionRevocations.revoke("pg-integration-session", new Date(Date.now() - 60_000).toISOString());
    await expect(stores.sessionRevocations.isRevoked("pg-integration-session")).resolves.toBe(false);
  });
});

type StoreSet = {
  repository: PostgresDocumentRepository;
  audit: PostgresAuditStore;
  outbox: PostgresOutboxStore;
  customization: PostgresCustomizationStore;
  namingSeries: PostgresNamingSeriesStore;
  migrations: PostgresMigrationStore;
  userStore: PostgresUserStore;
  roleStore: PostgresRoleStore;
  apiTokenStore: PostgresApiTokenStore;
  sessionRevocations: PostgresSessionRevocationStore;
};

async function migrateAll(stores: StoreSet) {
  await stores.repository.migrate();
  await stores.audit.migrate();
  await stores.outbox.migrate();
  await stores.customization.migrate();
  await stores.namingSeries.migrate();
  await stores.migrations.migrate();
  await stores.userStore.migrate();
  await stores.roleStore.migrate();
  await stores.apiTokenStore.migrate();
  await stores.sessionRevocations.migrate();
}

async function closeStores(stores: StoreSet) {
  for (const store of Object.values(stores)) {
    const candidate = store as unknown as {
      db?: { $client?: { end(options?: { timeout?: number }): Promise<void> } };
      sql?: { end(options?: { timeout?: number }): Promise<void> };
    };
    await candidate.db?.$client?.end({ timeout: 1 });
    await candidate.sql?.end({ timeout: 1 });
  }
}

async function cleanup(sql: postgres.Sql) {
  await sql`delete from framekit_documents where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_audit_events where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_outbox_events where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_custom_fields where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_views where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_naming_series where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_migrations where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_users where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_roles where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_api_tokens where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_session_revocations where session_id = 'pg-integration-session'`;
}

function createIdGenerator() {
  let counter = 0;
  return () => `pg-integration-${++counter}`;
}

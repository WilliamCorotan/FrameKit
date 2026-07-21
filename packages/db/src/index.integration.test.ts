import postgres from "postgres";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { defineApp, defineDocType, defineModule, type TenantContext } from "@framekit/core";
import { createRuntime, InMemoryDocumentRepository, type ListOptions } from "@framekit/runtime";
import {
  PostgresApiTokenStore,
  PostgresAuditStore,
  PostgresCustomizationStore,
  PostgresDocumentRepository,
  PostgresMigrationStore,
  PostgresMutationUnitOfWork,
  type PostgresMutationStage,
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

const queryDocType = defineDocType({
  name: "query_record",
  label: "Query Record",
  fields: [
    { name: "name", label: "Name", type: "text" },
    { name: "status", label: "Status", type: "select", options: ["active", "paused"] },
    { name: "score", label: "Score", type: "number" },
    { name: "notes", label: "Notes", type: "long_text" },
    { name: "metadata", label: "Metadata", type: "json" }
  ]
});

const app = defineApp({
  name: "Postgres Integration",
  modules: [defineModule({ id: "crm", name: "CRM", doctypes: [customerDocType, dealDocType] })]
});

describe.skipIf(!connectionString)("Postgres durable stores", () => {
  const sql = postgres(connectionString!, { max: 1 });
  let injectedStage: PostgresMutationStage | undefined;
  const stores = {
    repository: new PostgresDocumentRepository({ connectionString: connectionString! }),
    audit: new PostgresAuditStore({ connectionString: connectionString! }),
    outbox: new PostgresOutboxStore({ connectionString: connectionString! }),
    customization: new PostgresCustomizationStore({ connectionString: connectionString! }),
    namingSeries: new PostgresNamingSeriesStore({ connectionString: connectionString! }),
    migrations: new PostgresMigrationStore({ connectionString: connectionString! }),
    mutations: new PostgresMutationUnitOfWork({
      connectionString: connectionString!,
      faultInjector: (stage) => {
        if (stage === injectedStage) throw new Error(`injected ${stage} failure`);
      }
    }),
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
      mutations: stores.mutations,
      idGenerator: createIdGenerator("main"),
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

  it("pushes list operations into parameterized SQL with in-memory parity", async () => {
    const memory = new InMemoryDocumentRepository();
    const timestamp = "2026-07-06T00:00:00.000Z";
    const fixtures = [
      { id: "query-01", data: { name: "Alpha", status: "active", score: 2, notes: "needle one", metadata: { rank: 1 } } },
      { id: "query-02", data: { name: "Beta", status: "paused", score: 10, notes: "other", metadata: { rank: 2 } } },
      { id: "query-03", data: { name: "Gamma", status: "active", score: 10, notes: "needle two", metadata: { rank: 3 } } },
      { id: "query-04", data: { name: "Delta", status: "active", score: 25, notes: "other", metadata: { rank: 4 } } },
      { id: "query-05", data: { name: "%_' literal", status: "active", score: 30, notes: "escaped", metadata: { rank: 5 } } }
    ];
    for (const fixture of fixtures) {
      const record = { tenantId: tenant.tenantId, doctype: queryDocType.name, revision: 1, state: undefined, createdAt: timestamp, updatedAt: timestamp, ...fixture };
      await memory.create(tenant, queryDocType, record);
      await sql`
        insert into framekit_documents (tenant_id, doctype, id, revision, state, data, created_at, updated_at)
        values (${record.tenantId}, ${record.doctype}, ${record.id}, 1, null, ${sql.json(record.data)}, ${record.createdAt}, ${record.updatedAt})
      `;
    }

    const shapes: ListOptions[] = [
      { filters: { status: "active", score: { gte: 10 } }, sort: { field: "score", direction: "asc" }, fields: ["name", "score"], limit: 10 },
      { search: "needle", sort: { field: "name", direction: "desc" }, fields: ["name", "notes"], limit: 10 },
      { filters: { name: { contains: "%_'" } }, sort: { field: "name", direction: "asc" }, limit: 10 },
      { filters: { score: { in: [2, 25] } }, sort: { field: "score", direction: "desc" }, offset: 1, limit: 1 }
    ];
    for (const options of shapes) {
      const postgresPage = await stores.repository.listPage(tenant, queryDocType, options);
      const memoryPage = await memory.listPage(tenant, queryDocType, options);
      expect(postgresPage).toEqual(memoryPage);
    }

    const postgresFirst = await stores.repository.listPage(tenant, queryDocType, { sort: { field: "score", direction: "asc" }, limit: 2 });
    const memoryFirst = await memory.listPage(tenant, queryDocType, { sort: { field: "score", direction: "asc" }, limit: 2 });
    expect(postgresFirst).toEqual(memoryFirst);
    expect(postgresFirst.nextCursor).toBeDefined();
    const concurrent = {
      tenantId: tenant.tenantId,
      doctype: queryDocType.name,
      id: "query-concurrent-before-cursor",
      revision: 1,
      state: undefined,
      data: { name: "Inserted before cursor", status: "active", score: 1 },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await memory.create(tenant, queryDocType, concurrent);
    await sql`
      insert into framekit_documents (tenant_id, doctype, id, revision, state, data, created_at, updated_at)
      values (${concurrent.tenantId}, ${concurrent.doctype}, ${concurrent.id}, 1, null, ${sql.json(concurrent.data)}, ${concurrent.createdAt}, ${concurrent.updatedAt})
    `;
    const nextOptions = { sort: { field: "score", direction: "asc" } as const, cursor: postgresFirst.nextCursor, limit: 2 };
    const postgresNext = await stores.repository.listPage(tenant, queryDocType, nextOptions);
    expect(postgresNext).toEqual(await memory.listPage(tenant, queryDocType, nextOptions));
    expect(postgresNext.items.map((record) => record.id)).toEqual(["query-03", "query-04"]);
    await expect(stores.repository.listPage(tenant, queryDocType, { sort: { field: "metadata", direction: "asc" } })).rejects.toMatchObject({ code: "UNSUPPORTED_QUERY_SHAPE" });
  });

  it("uses a bounded parameterized query plan for a realistically large tenant", async () => {
    await sql`
      insert into framekit_documents (tenant_id, doctype, id, revision, state, data, created_at, updated_at)
      select ${tenant.tenantId}, ${queryDocType.name}, 'perf-' || lpad(value::text, 5, '0'), 1, null,
             jsonb_build_object('name', 'Performance ' || value, 'status', case when value % 2 = 0 then 'active' else 'paused' end, 'score', value),
             ${new Date("2026-01-01T00:00:00.000Z")} + value * interval '1 millisecond',
             ${new Date("2026-01-01T00:00:00.000Z")} + value * interval '1 millisecond'
      from generate_series(1, 10000) as value
    `;
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const repository = new PostgresDocumentRepository({ connectionString: connectionString!, onQuery: (query) => { captured.push(query); } });
    try {
      const injection = "active' OR true --";
      await expect(repository.listPage(tenant, queryDocType, { filters: { status: injection }, limit: 5 })).resolves.toMatchObject({ items: [] });
      expect(captured[0]!.sql).not.toContain(injection);
      expect(captured[0]!.params).toContain(injection);

      const page = await repository.listPage(tenant, queryDocType, {
        filters: { status: "active" },
        fields: ["name", "status"],
        limit: 5
      });
      expect(page.items).toHaveLength(5);
      expect(page.items.every((record) => Object.keys(record.data).every((field) => field === "name" || field === "status"))).toBe(true);
      const boundedQuery = captured.at(-1)!;
      expect(boundedQuery.sql).toContain("limit");
      expect(boundedQuery.sql).not.toContain("active");
      expect(boundedQuery.params).toContain("active");
      const plan = await sql.unsafe(`explain (analyze, buffers, format json) ${boundedQuery.sql}`, boundedQuery.params as never[]);
      const planText = JSON.stringify(plan);
      expect(planText).toContain("Limit");
      expect(planText).toMatch(/Index Scan|Bitmap Index Scan/);
    } finally {
      await (repository as unknown as { db: { $client: { end(options?: { timeout?: number }): Promise<void> } } }).db.$client.end({ timeout: 1 });
    }
  });

  it("enforces concurrent uniqueness and optimistic revisions", async () => {
    const runtime = createRuntime(app, {
      repository: stores.repository,
      audit: stores.audit,
      outbox: stores.outbox,
      mutations: stores.mutations,
      idGenerator: createIdGenerator("concurrency")
    });

    const duplicates = await Promise.allSettled([
      runtime.create(tenant, "customer", { name: "Concurrent One", external_id: "RACE-001" }),
      runtime.create(tenant, "customer", { name: "Concurrent Two", external_id: "RACE-001" })
    ]);
    expect(duplicates.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(duplicates.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "UNIQUE_CONSTRAINT_FAILED" }) })
    ]);

    const created = await runtime.create(tenant, "customer", { name: "Revision Target", external_id: "REV-001" });
    expect(created.revision).toBe(1);
    const updates = await Promise.allSettled([
      runtime.update(tenant, "customer", created.id, { status: "paused" }, { expectedRevision: 1 }),
      runtime.update(tenant, "customer", created.id, { status: "active" }, { expectedRevision: 1 })
    ]);
    expect(updates.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(updates.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "REVISION_CONFLICT" }) })
    ]);
    await expect(runtime.get(tenant, "customer", created.id)).resolves.toMatchObject({ revision: 2 });
    await expect(runtime.delete(tenant, "customer", created.id, { expectedRevision: 1 })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("rolls back document, audit, and outbox writes when a post-write stage fails", async () => {
    const failingApp = defineApp({
      name: "Postgres Fault Injection",
      modules: [defineModule({
        id: "faults",
        name: "Faults",
        doctypes: [customerDocType],
        hooks: { afterInsert: { customer: [() => { throw new Error("injected after-write failure"); }] } }
      })]
    });
    const runtime = createRuntime(failingApp, {
      repository: stores.repository,
      audit: stores.audit,
      outbox: stores.outbox,
      mutations: stores.mutations,
      idGenerator: createIdGenerator("fault")
    });

    await expect(runtime.create(tenant, "customer", { name: "Atomic Failure", external_id: "FAULT-001" })).rejects.toThrow("injected after-write failure");
    await expect(runtime.get(tenant, "customer", "atomic-failure")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(stores.audit.list(tenant)).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ documentId: "atomic-failure" })]));
    await expect(stores.outbox.list(tenant)).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ payload: expect.objectContaining({ id: "atomic-failure" }) })]));
  });

  it("rolls back the entire transaction when every durable mutation stage is faulted", async () => {
    const runtime = createRuntime(app, {
      repository: stores.repository,
      audit: stores.audit,
      outbox: stores.outbox,
      mutations: stores.mutations,
      idGenerator: createIdGenerator("stages")
    });

    try {
      for (const stage of ["document", "hooks", "audit", "outbox", "idempotency"] satisfies PostgresMutationStage[]) {
        injectedStage = stage;
        const id = `fault-${stage}`;
        await expect(runtime.create(tenant, "customer", {
          name: id,
          external_id: `STAGE-${stage}`
        }, { idempotencyKey: `fault-${stage}` })).rejects.toThrow(`injected ${stage} failure`);
        await expect(runtime.get(tenant, "customer", id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
        expect((await stores.audit.list(tenant)).filter((event) => event.documentId === id)).toHaveLength(0);
        expect((await stores.outbox.list(tenant)).filter((event) => event.payload.id === id)).toHaveLength(0);
      }
    } finally {
      injectedStage = undefined;
    }

    const target = await runtime.create(tenant, "customer", { name: "Mutation Rollback", external_id: "ROLLBACK-001" });
    try {
      injectedStage = "outbox";
      await expect(runtime.update(tenant, "customer", target.id, { status: "paused" }, { expectedRevision: 1 })).rejects.toThrow("injected outbox failure");
      await expect(runtime.get(tenant, "customer", target.id)).resolves.toMatchObject({ revision: 1, data: { status: "active" } });
      injectedStage = "audit";
      await expect(runtime.delete(tenant, "customer", target.id, { expectedRevision: 1 })).rejects.toThrow("injected audit failure");
      await expect(runtime.get(tenant, "customer", target.id)).resolves.toMatchObject({ revision: 1 });
    } finally {
      injectedStage = undefined;
    }
  });

  it("replays idempotent commands without duplicating durable effects", async () => {
    const runtime = createRuntime(app, {
      repository: stores.repository,
      audit: stores.audit,
      outbox: stores.outbox,
      mutations: stores.mutations,
      idGenerator: createIdGenerator("retry")
    });
    const [first, replay] = await Promise.all([
      runtime.create(tenant, "customer", { name: "Retry Customer", external_id: "RETRY-001" }, { idempotencyKey: "create-retry-1" }),
      runtime.create(tenant, "customer", { name: "Retry Customer", external_id: "RETRY-001" }, { idempotencyKey: "create-retry-1" })
    ]);
    expect(replay).toEqual(first);
    await expect(runtime.list(tenant, "customer", { filters: { external_id: "RETRY-001" } })).resolves.toHaveLength(1);
    await expect(stores.audit.list(tenant)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ documentId: first.id })]));
    const matchingAudit = (await stores.audit.list(tenant)).filter((event) => event.documentId === first.id);
    expect(matchingAudit).toHaveLength(1);

    const updated = await runtime.update(tenant, "customer", first.id, { status: "paused" }, { expectedRevision: 1, idempotencyKey: "update-retry-1" });
    const updateReplay = await runtime.update(tenant, "customer", first.id, { status: "paused" }, { expectedRevision: 1, idempotencyKey: "update-retry-1" });
    expect(updateReplay).toEqual(updated);
    await expect(runtime.update(tenant, "customer", first.id, { status: "active" }, { expectedRevision: 1, idempotencyKey: "update-retry-1" })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("commits the durable outbox before publishing realtime", async () => {
    const runtime = createRuntime(app, {
      repository: stores.repository,
      audit: stores.audit,
      outbox: stores.outbox,
      mutations: stores.mutations,
      realtime: { publish: () => { throw new Error("realtime unavailable"); } },
      idGenerator: createIdGenerator("realtime")
    });

    await expect(runtime.create(tenant, "customer", { name: "Publish Failure", external_id: "REALTIME-001" })).rejects.toThrow("realtime unavailable");
    await expect(runtime.get(tenant, "customer", "publish-failure")).resolves.toMatchObject({ revision: 1 });
    await expect(stores.outbox.list(tenant, { status: "pending" })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "customer.created", payload: expect.objectContaining({ id: "publish-failure", revision: 1 }) })
    ]));
  });
});

type StoreSet = {
  repository: PostgresDocumentRepository;
  audit: PostgresAuditStore;
  outbox: PostgresOutboxStore;
  customization: PostgresCustomizationStore;
  namingSeries: PostgresNamingSeriesStore;
  migrations: PostgresMigrationStore;
  mutations: PostgresMutationUnitOfWork;
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
  await stores.mutations.migrate();
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
  await sql`delete from framekit_document_unique_values where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_idempotency_keys where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_users where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_roles where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_api_tokens where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_session_revocations where session_id = 'pg-integration-session'`;
}

function createIdGenerator(namespace = "default") {
  let counter = 0;
  return () => `pg-integration-${namespace}-${++counter}`;
}

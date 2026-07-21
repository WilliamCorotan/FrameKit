import postgres from "postgres";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { defineApp, defineDocType, defineModule, type TenantContext } from "@framekit/core";
import { createRuntime, InMemoryDocumentRepository, migrationChecksum, type ListOptions } from "@framekit/runtime";
import {
  PostgresApiTokenStore,
  PostgresAuthAuditStore,
  PostgresAuthIdentityLinkStore,
  PostgresAuthLifecycleTokenStore,
  PostgresAuditStore,
  PostgresCustomizationStore,
  PostgresDocumentRepository,
  PostgresMigrationStore,
  migrationConversionArtifactDigest,
  PostgresMutationUnitOfWork,
  type PostgresMutationStage,
  PostgresNamingSeriesStore,
  PostgresOutboxStore,
  PostgresRealtimePublisher,
  PostgresOidcAuthorizationStateStore,
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
    { action: "delete", permissions: ["crm.customer"] },
    { action: "submit", permissions: ["crm.customer"] },
    { action: "cancel", permissions: ["crm.customer"] }
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

const approvalDocType = defineDocType({
  name: "approval",
  label: "Approval",
  fields: [
    { name: "title", label: "Title", type: "text", required: true },
    { name: "status", label: "Status", type: "select", options: ["pending", "approved"], required: true }
  ],
  permissions: [
    { action: "create", permissions: ["crm.approval"] },
    { action: "read", permissions: ["crm.approval"] }
  ],
  workflow: {
    field: "status",
    initialState: "pending",
    states: ["pending", "approved"],
    transitions: [{ action: "approve", from: ["pending"], to: "approved" }]
  }
});

const queryDocType = defineDocType({
  name: "query_record",
  label: "Query Record",
  fields: [
    { name: "name", label: "Name", type: "text" },
    { name: "status", label: "Status", type: "select", options: ["active", "paused"] },
    { name: "score", label: "Score", type: "number" },
    { name: "enabled", label: "Enabled", type: "boolean" },
    { name: "notes", label: "Notes", type: "long_text" },
    { name: "metadata", label: "Metadata", type: "json" }
  ]
});

const securedDocType = defineDocType({
  name: "secured_record",
  label: "Secured Record",
  ownership: { transferPermissions: ["records.transfer"] },
  fields: [
    { name: "title", label: "Title", type: "text", required: true },
    { name: "code", label: "Code", type: "text", unique: true },
    { name: "stage", label: "Stage", type: "select", options: ["open", "done"] }
  ],
  rowPolicy: {
    read: [{ owner: "self" }, { owner: "any", roles: ["manager"] }],
    write: [{ owner: "self" }, { owner: "any", permissions: ["records.manage"] }]
  },
  workflow: { field: "stage", initialState: "open", states: ["open", "done"], transitions: [{ action: "finish", from: ["open"], to: "done" }] }
});

const securedReferenceDocType = defineDocType({
  name: "secured_reference", label: "Secured Reference",
  fields: [{ name: "target", label: "Target", type: "link", linkTo: "secured_record" }]
});

const app = defineApp({
  name: "Postgres Integration",
  modules: [defineModule({ id: "crm", name: "CRM", doctypes: [customerDocType, dealDocType, approvalDocType, securedDocType, securedReferenceDocType] })]
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
    sessionRevocations: new PostgresSessionRevocationStore({ connectionString: connectionString! }),
    identityLinks: new PostgresAuthIdentityLinkStore({ connectionString: connectionString! }),
    lifecycleTokens: new PostgresAuthLifecycleTokenStore({ connectionString: connectionString! }),
    oidcStates: new PostgresOidcAuthorizationStateStore({ connectionString: connectionString! }),
    authAudit: new PostgresAuthAuditStore({ connectionString: connectionString! })
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
    const updatedCustomer = await runtime.update(tenant, "customer", customer.id, { status: "paused" });
    const submittedCustomer = await runtime.submit(tenant, "customer", customer.id, { expectedRevision: updatedCustomer.revision });
    const cancelledCustomer = await runtime.cancel(tenant, "customer", customer.id, { expectedRevision: submittedCustomer.revision });

    await expect(runtime.get(tenant, "customer", customer.id)).resolves.toMatchObject({
      id: "durable-customer",
      documentStatus: "cancelled",
      revision: cancelledCustomer.revision,
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
    const approval = await runtime.create(tenant, "approval", { title: "Persist initial workflow state" });
    await expect(runtime.get(tenant, "approval", approval.id)).resolves.toMatchObject({ state: "pending", data: { status: "pending" } });
    await expect(runtime.create(tenant, "approval", { title: "Conflicting state", status: "approved" })).rejects.toMatchObject({ code: "INVALID_INITIAL_STATE" });

    await expect(runtime.auditTrail(tenant)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "create", doctype: "customer", documentId: customer.id }),
      expect.objectContaining({ action: "update", doctype: "customer", documentId: customer.id }),
      expect.objectContaining({ action: "submit", doctype: "customer", documentId: customer.id }),
      expect.objectContaining({ action: "cancel", doctype: "customer", documentId: customer.id })
    ]));
    await expect(runtime.outboxEvents(tenant, { status: "pending" })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "customer.created", topic: "customer", status: "pending" }),
      expect.objectContaining({ type: "customer.updated", topic: "customer", status: "pending" }),
      expect.objectContaining({ type: "customer.submitted", topic: "customer", status: "pending" }),
      expect.objectContaining({ type: "customer.cancelled", topic: "customer", status: "pending" })
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
            dealDocType,
            approvalDocType,
            securedDocType,
            securedReferenceDocType
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

  it("atomically persists tenant identity links and consumes lifecycle/OIDC state once", async () => {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await stores.identityLinks.upsert({ tenantId: tenant.tenantId, providerId: "oidc", subject: "subject", userId: "user-1", createdAt: now, updatedAt: now });
    await expect(stores.identityLinks.upsert({ tenantId: tenant.tenantId, providerId: "oidc", subject: "subject", userId: "user-2", createdAt: now, updatedAt: now }))
      .rejects.toMatchObject({ code: "PROVIDER_IDENTITY_COLLISION" });
    await stores.lifecycleTokens.create({ id: "reset-1", tenantId: tenant.tenantId, kind: "password_reset", tokenHash: "reset-hash", userId: "user-1", createdAt: now, expiresAt });
    await expect(stores.lifecycleTokens.consume(tenant.tenantId, "password_reset", "reset-hash", now)).resolves.toMatchObject({ id: "reset-1" });
    await expect(stores.lifecycleTokens.consume(tenant.tenantId, "password_reset", "reset-hash", now)).resolves.toBeUndefined();
    await stores.oidcStates.create({ id: "state-1", providerId: "oidc", tenantId: tenant.tenantId, stateHash: "state-hash", nonceHash: "nonce-hash",
      encryptedCodeVerifier: "encrypted", returnTo: "/", redirectUri: "https://app.example/callback", createdAt: now, expiresAt });
    await expect(stores.oidcStates.consume("oidc", "state-hash", now)).resolves.toMatchObject({ id: "state-1" });
    await expect(stores.oidcStates.consume("oidc", "state-hash", now)).resolves.toBeUndefined();
    await stores.authAudit.record({ id: "auth-audit-1", tenantId: tenant.tenantId, action: "password_reset.completed", success: true, createdAt: now });
    await expect(stores.authAudit.list(tenant.tenantId)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "auth-audit-1", success: true })]));
  });

  it("pushes owner policies into reads and conditional mutations", async () => {
    let id = 0;
    const runtime = createRuntime(app, {
      repository: stores.repository, audit: stores.audit, outbox: stores.outbox, mutations: stores.mutations,
      idGenerator: () => String(++id).padStart(8, "0")
    });
    const alice = { ...tenant, userId: "alice", roles: [], permissions: [] };
    const bob = { ...tenant, userId: "bob", roles: [], permissions: [] };
    const manager = { ...tenant, userId: "manager", roles: ["manager"], permissions: ["records.transfer"] };
    const outsider = { ...alice, tenantId: `${tenant.tenantId}_other` };
    const aliceRecord = await runtime.create(alice, "secured_record", { title: "Alice", code: "alice-code" });
    const bobRecord = await runtime.create(bob, "secured_record", { title: "Bob", code: "bob-code" });
    expect(aliceRecord.ownerId).toBe("alice");
    expect((await runtime.list(alice, "secured_record")).map((record) => record.id)).toEqual([aliceRecord.id]);
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const policyRepository = new PostgresDocumentRepository({ connectionString: connectionString!, onQuery: (query) => { captured.push(query); } });
    try {
      await policyRepository.listPage(alice, securedDocType);
      expect(captured[0]!.sql).toContain("owner_id");
      expect(captured[0]!.sql).not.toContain(alice.userId);
      expect(captured[0]!.params).toContain(alice.userId);
    } finally {
      await (policyRepository as unknown as { db: { $client: { end(options?: { timeout?: number }): Promise<void> } } }).db.$client.end({ timeout: 1 });
    }
    expect(await runtime.list(manager, "secured_record")).toHaveLength(2);
    await expect(runtime.get(alice, "secured_record", bobRecord.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.get(outsider, "secured_record", aliceRecord.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.update(alice, "secured_record", bobRecord.id, { title: "stolen" })).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.delete(alice, "secured_record", bobRecord.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.transition(alice, "secured_record", bobRecord.id, "finish")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.submit(alice, "secured_record", bobRecord.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.create(bob, "secured_reference", { target: aliceRecord.id })).rejects.toMatchObject({ code: "LINK_NOT_FOUND" });
    await expect(runtime.create(bob, "secured_record", { title: "Hidden duplicate", code: "alice-code" })).rejects.toMatchObject({ code: "UNIQUE_CONSTRAINT_FAILED" });
    let rollbackId = 0;
    const rollbackRuntime = createRuntime(defineApp({ name: app.name, modules: [defineModule({
      id: "crm", name: "CRM", doctypes: [customerDocType, dealDocType, approvalDocType, securedDocType, securedReferenceDocType],
      hooks: {
        beforeOwnerTransfer: { secured_record: [({ document }) => { if (document?.data.title === "Mutation") { document.revision = 999; document.ownerId = "mallory"; document.data.title = "mutated"; } }] },
        afterOwnerTransfer: { secured_record: [({ document }) => {
          if (document?.data.title === "Rollback" && document.ownerId === "bob") throw new Error("injected transfer hook failure");
          if (document?.data.title === "Mutation") { document.revision = 999; document.ownerId = "mallory"; document.data.title = "mutated"; }
        }] }
      }
    })] }), {
      repository: stores.repository, audit: stores.audit, outbox: stores.outbox, mutations: stores.mutations,
      idGenerator: () => `x${String(++rollbackId).padStart(7, "0")}`
    });
    const rollbackRecord = await rollbackRuntime.create(alice, "secured_record", { title: "Rollback", code: "rollback-code" });
    await expect(rollbackRuntime.transferOwner(manager, "secured_record", rollbackRecord.id, "bob", { expectedRevision: 1 })).rejects.toThrow("injected transfer hook failure");
    const rollbackRows = await sql<{ ownerId: string; revision: number; title: string }[]>`
      select owner_id as "ownerId", revision, data ->> 'title' as title from framekit_documents
      where tenant_id = ${tenant.tenantId} and id = ${rollbackRecord.id}
    `;
    expect(rollbackRows).toEqual([{ ownerId: "alice", revision: 1, title: "Rollback" }]);
    await expect(rollbackRuntime.get(alice, "secured_record", rollbackRecord.id)).resolves.toMatchObject({ ownerId: "alice", revision: 1 });
    await expect(rollbackRuntime.get(bob, "secured_record", rollbackRecord.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    const mutationRecord = await rollbackRuntime.create(alice, "secured_record", { title: "Mutation", code: "mutation-code" });
    const mutationTransfer = await rollbackRuntime.transferOwner(manager, "secured_record", mutationRecord.id, "bob", { expectedRevision: 1, idempotencyKey: "pg-transfer-mutation" });
    expect(mutationTransfer).toEqual({ id: mutationRecord.id, ownerId: "bob", revision: 2, updatedAt: expect.any(String) });
    const mutationRows = await sql<{ ownerId: string; revision: number; title: string }[]>`
      select owner_id as "ownerId", revision, data ->> 'title' as title from framekit_documents where tenant_id = ${tenant.tenantId} and id = ${mutationRecord.id}
    `;
    expect(mutationRows).toEqual([{ ownerId: "bob", revision: 2, title: "Mutation" }]);
    const transferOutbox = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from framekit_outbox_events where tenant_id = ${tenant.tenantId} and type = 'secured_record.owner.transferred' and payload ->> 'id' = ${mutationRecord.id}
    `;
    expect(transferOutbox[0]?.payload).toEqual({ doctype: "secured_record", ...mutationTransfer });
    expect(transferOutbox[0]?.payload).not.toHaveProperty("data");
    await expect(rollbackRuntime.transferOwner(manager, "secured_record", mutationRecord.id, "bob", { expectedRevision: 1, idempotencyKey: "pg-transfer-mutation" })).resolves.toEqual(mutationTransfer);
    const transferred = await runtime.transferOwner(manager, "secured_record", aliceRecord.id, "bob", { expectedRevision: aliceRecord.revision });
    expect(transferred).toMatchObject({ ownerId: "bob", revision: 2 });
    const rows = await sql<{ ownerId: string }[]>`select owner_id as "ownerId" from framekit_documents where tenant_id = ${tenant.tenantId} and id = ${aliceRecord.id}`;
    expect(rows).toEqual([{ ownerId: "bob" }]);
    await expect(runtime.get(alice, "secured_record", aliceRecord.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.get(bob, "secured_record", aliceRecord.id)).resolves.toMatchObject({ ownerId: "bob" });
  });

  it("serializes executable migrations, rolls back atomically, detects drift, and upgrades legacy uniqueness", async () => {
    const migrationTenant = { ...tenant, tenantId: "pg_migration_state_tenant" };
    const upgradeTenant = { ...tenant, tenantId: "pg_migration_upgrade_tenant" };
    const conflictTenant = { ...tenant, tenantId: "pg_migration_conflict_tenant" };
    const tenantIds = [migrationTenant.tenantId, upgradeTenant.tenantId, conflictTenant.tenantId];
    const baseDocType = defineDocType({ name: "migration_record", label: "Migration Record", fields: [{ name: "name", label: "Name", type: "text" }] });
    const targetDocType = defineDocType({
      ...baseDocType,
      fields: [...baseDocType.fields, { name: "region", label: "Region", type: "text", default: "APAC" }],
      indexes: [["region"]]
    });
    const baseApp = defineApp({ name: "Migration Integration", modules: [defineModule({ id: "migration", name: "Migration", doctypes: [baseDocType] })] });
    const targetApp = defineApp({ name: "Migration Integration", modules: [defineModule({ id: "migration", name: "Migration", doctypes: [targetDocType] })] });
    const faultStore = new PostgresMigrationStore({
      connectionString: connectionString!,
      faultInjector: (stage, plan, statementIndex) => {
        if (plan.id === "migration-partial" && stage === "statement" && statementIndex === 0) throw new Error("injected migration failure");
      }
    });
    try {
      await sql`delete from framekit_documents where tenant_id = any(${tenantIds})`;
      await sql`delete from framekit_document_unique_values where tenant_id = any(${tenantIds})`;
      await sql`delete from framekit_migrations where tenant_id = any(${tenantIds})`;
      await sql`
        insert into framekit_documents (tenant_id, doctype, id, revision, state, data, created_at, updated_at)
        values (${migrationTenant.tenantId}, ${baseDocType.name}, 'migration-row', 1, null, ${sql.json({ name: "Legacy" })}, now(), now())
      `;

      const planner = createRuntime(baseApp, { migrations: stores.migrations, idGenerator: () => "migration-concurrent" });
      const plan = await planner.planMigration(migrationTenant, targetApp);
      const otherApp = defineApp({ name: "Other Migration App", modules: [] });
      const otherPlan = await createRuntime(otherApp, { idGenerator: () => "migration-concurrent" }).planMigration(migrationTenant, otherApp);
      const concurrent = await Promise.all([
        stores.migrations.applyPlan(migrationTenant, plan),
        stores.migrations.applyPlan(migrationTenant, plan),
        stores.migrations.applyPlan(migrationTenant, otherPlan)
      ]);
      expect(concurrent[1]).toEqual(concurrent[0]);
      expect(concurrent[2]?.id).toBe(plan.id);
      await expect(stores.migrations.list(migrationTenant, { appName: plan.appName })).resolves.toHaveLength(1);
      await expect(stores.migrations.list(migrationTenant, { appName: otherPlan.appName })).resolves.toHaveLength(1);
      const migratedRows = await sql<{ data: Record<string, unknown> }[]>`select data from framekit_documents where tenant_id = ${migrationTenant.tenantId}`;
      expect(migratedRows[0]?.data).toEqual({ name: "Legacy", region: "APAC" });

      const differentTarget = { ...plan, toSchemaChecksum: "different-target" };
      const conflictingId = { ...differentTarget, checksum: await migrationChecksum(differentTarget) };
      await expect(stores.migrations.applyPlan(migrationTenant, conflictingId)).rejects.toMatchObject({ code: "MIGRATION_ID_CONFLICT" });
      await expect(stores.migrations.applyPlan({ ...migrationTenant, tenantId: "wrong" }, plan)).rejects.toMatchObject({ code: "MIGRATION_TENANT_MISMATCH" });
      await expect(stores.migrations.applyPlan(migrationTenant, { ...plan, changes: [] })).rejects.toMatchObject({ code: "MIGRATION_CHECKSUM_MISMATCH" });

      const targetPlanner = createRuntime(targetApp, { idGenerator: () => "migration-drift" });
      const staleAfterRollback = await targetPlanner.planMigration(migrationTenant, targetApp);
      const rolledBack = await stores.migrations.rollback(migrationTenant, concurrent[0]!, { allowDestructive: true, id: "migration-concurrent-down" });
      expect(rolledBack.id).toBe("migration-concurrent-down");
      const rolledBackRows = await sql<{ data: Record<string, unknown> }[]>`select data from framekit_documents where tenant_id = ${migrationTenant.tenantId}`;
      expect(rolledBackRows[0]?.data).toEqual({ name: "Legacy" });
      await expect(stores.migrations.applyPlan(migrationTenant, staleAfterRollback)).rejects.toMatchObject({ code: "MIGRATION_SCHEMA_DRIFT" });

      const partialPlanner = createRuntime(baseApp, { idGenerator: () => "migration-partial" });
      const partialPlan = await partialPlanner.planMigration(migrationTenant, targetApp);
      await expect(faultStore.applyPlan(migrationTenant, partialPlan)).rejects.toThrow("injected migration failure");
      const afterPartial = await sql<{ data: Record<string, unknown> }[]>`select data from framekit_documents where tenant_id = ${migrationTenant.tenantId}`;
      expect(afterPartial[0]?.data).toEqual({ name: "Legacy" });
      expect((await stores.migrations.list(migrationTenant)).map((record) => record.id)).not.toContain("migration-partial");

      const upgradeDocType = defineDocType({ name: "legacy_upgrade", label: "Legacy Upgrade", fields: [{ name: "code", label: "Code", type: "text", unique: true }] });
      const upgradeApp = defineApp({ name: "Upgrade Integration", modules: [defineModule({ id: "upgrade", name: "Upgrade", doctypes: [upgradeDocType] })] });
      await sql`
        insert into framekit_documents (tenant_id, doctype, id, revision, state, data, created_at, updated_at)
        values (${upgradeTenant.tenantId}, ${upgradeDocType.name}, 'legacy-a', 1, null, ${sql.json({ code: "A" })}, now(), now()),
               (${upgradeTenant.tenantId}, ${upgradeDocType.name}, 'legacy-b', 1, null, ${sql.json({ code: "B" })}, now(), now())
      `;
      await sql`
        insert into framekit_migrations (tenant_id, id, app_name, changes, checksum, created_at, applied_at)
        values (${upgradeTenant.tenantId}, 'legacy-history', ${upgradeApp.name}, '[]'::jsonb, 'legacy-checksum', now() - interval '1 day', now() - interval '1 day')
      `;
      await sql.unsafe("create unique index if not exists framekit_documents_legacy_upgrade_code_uniq on framekit_documents (tenant_id, doctype, (data ->> 'code')) where doctype = 'legacy_upgrade' and data ? 'code' and data ->> 'code' <> ''");
      const compatibleIndex = await sql<{ oid: number }[]>`select 'framekit_documents_legacy_upgrade_code_uniq'::regclass::oid as oid`;
      await sql`
        insert into framekit_documents (tenant_id, doctype, id, revision, state, data, created_at, updated_at)
        values (${upgradeTenant.tenantId}, ${upgradeDocType.name}, 'legacy-empty-a', 1, null, ${sql.json({ code: "" })}, now(), now()),
               (${upgradeTenant.tenantId}, ${upgradeDocType.name}, 'legacy-empty-b', 1, null, ${sql.json({ code: "" })}, now(), now())
      `;
      const upgradePlanner = createRuntime(upgradeApp, { idGenerator: () => "migration-upgrade" });
      const upgradePlan = await upgradePlanner.planMigration(upgradeTenant, upgradeApp);
      await stores.migrations.applyPlan(upgradeTenant, upgradePlan);
      await stores.migrations.applyPlan(upgradeTenant, upgradePlan);
      const reservations = await sql<{ documentId: string }[]>`
        select document_id as "documentId" from framekit_document_unique_values
        where tenant_id = ${upgradeTenant.tenantId} and doctype = ${upgradeDocType.name} order by document_id
      `;
      expect(reservations.map((row) => row.documentId)).toEqual(["legacy-a", "legacy-b"]);
      await expect(stores.migrations.list(upgradeTenant)).resolves.toHaveLength(2);
      const normalizedIndex = await sql<{ definition: string }[]>`select pg_get_indexdef('framekit_documents_legacy_upgrade_code_uniq'::regclass) as definition`;
      expect(normalizedIndex[0]?.definition).toContain("<> ''::text");
      const preservedIndex = await sql<{ oid: number }[]>`select 'framekit_documents_legacy_upgrade_code_uniq'::regclass::oid as oid`;
      expect(preservedIndex[0]?.oid).toBe(compatibleIndex[0]?.oid);

      const conflictDocType = defineDocType({ name: "legacy_conflict", label: "Legacy Conflict", fields: [{ name: "code", label: "Code", type: "text", unique: true }] });
      const conflictApp = defineApp({ name: "Conflict Integration", modules: [defineModule({ id: "conflict", name: "Conflict", doctypes: [conflictDocType] })] });
      await sql`
        insert into framekit_documents (tenant_id, doctype, id, revision, state, data, created_at, updated_at)
        values (${conflictTenant.tenantId}, ${conflictDocType.name}, 'duplicate-a', 1, null, ${sql.json({ code: "DUP" })}, now(), now()),
               (${conflictTenant.tenantId}, ${conflictDocType.name}, 'duplicate-b', 1, null, ${sql.json({ code: "DUP" })}, now(), now())
      `;
      const conflictPlanner = createRuntime(conflictApp, { idGenerator: () => "migration-conflict" });
      const conflictPlan = await conflictPlanner.planMigration(conflictTenant, conflictApp);
      await expect(stores.migrations.applyPlan(conflictTenant, conflictPlan)).rejects.toMatchObject({ code: "LEGACY_UNIQUE_CONFLICT" });
      await expect(stores.migrations.list(conflictTenant)).resolves.toHaveLength(0);
      const conflictReservations = await sql<{ count: number }[]>`select count(*)::int as count from framekit_document_unique_values where tenant_id = ${conflictTenant.tenantId}`;
      expect(conflictReservations[0]?.count).toBe(0);
    } finally {
      await sql`delete from framekit_documents where tenant_id = any(${tenantIds})`;
      await sql`delete from framekit_document_unique_values where tenant_id = any(${tenantIds})`;
      await sql`delete from framekit_migrations where tenant_id = any(${tenantIds})`;
      await sql.unsafe("drop index if exists framekit_documents_legacy_upgrade_code_uniq");
      await sql.unsafe("drop index if exists framekit_documents_legacy_conflict_code_uniq");
      await (faultStore as unknown as { sql: { end(options?: { timeout?: number }): Promise<void> } }).sql.end({ timeout: 1 });
    }
  });

  it("resumes approved online conversions with durable checkpoints and isolated concurrent operators", async () => {
    const onlineTenant = { ...tenant, tenantId: "pg_online_migration_tenant" };
    const isolatedTenant = { ...tenant, tenantId: "pg_online_migration_isolated" };
    const timeoutTenant = { ...tenant, tenantId: "pg_online_migration_timeout" };
    const tenantIds = [onlineTenant.tenantId, isolatedTenant.tenantId, timeoutTenant.tenantId];
    const textDocType = defineDocType({ name: "online_record", label: "Online Record", fields: [{ name: "score", label: "Score", type: "text" }] });
    const numberDocType = defineDocType({ ...textDocType, fields: [{ name: "score", label: "Score", type: "number" }] });
    const currentApp = defineApp({ name: "Online Migration", modules: [defineModule({ id: "online", name: "Online", doctypes: [textDocType] })] });
    const targetApp = defineApp({ name: "Online Migration", modules: [defineModule({ id: "online", name: "Online", doctypes: [numberDocType] })] });
    const artifactDigest = await migrationConversionArtifactDigest("fixture://online-record-score-number/v1");
    const invalidArtifactDigest = await migrationConversionArtifactDigest("fixture://online-record-score-invalid-date/v1");
    const convertScore = (value: unknown, _document: Readonly<Record<string, unknown>>, parameters: unknown) =>
      Number(value) + Number((parameters as { offset?: number }).offset ?? 0);
    const invalidConvert = () => new Date("2026-07-21T00:00:00.000Z");
    const conversionRegistry = [
      { id: "online-record-score-number", version: 1, artifactDigest, convert: convertScore },
      { id: "online-record-score-invalid-date", version: 1, artifactDigest: invalidArtifactDigest, convert: invalidConvert }
    ];
    let interruptOnce = true;
    const onlineStore = new PostgresMigrationStore({
      connectionString: connectionString!,
      conversionRegistry,
      faultInjector: (stage) => {
        if (stage === "online_chunk" && interruptOnce) {
          interruptOnce = false;
          throw new Error("injected online interruption");
        }
      }
    });
    let releaseChunk!: () => void;
    let signalChunkEntered!: () => void;
    const chunkGate = new Promise<void>((resolve) => { releaseChunk = resolve; });
    const chunkEntered = new Promise<void>((resolve) => { signalChunkEntered = resolve; });
    let gateOnce = true;
    const gatedStore = new PostgresMigrationStore({
      connectionString: connectionString!,
      conversionRegistry,
      faultInjector: async (stage) => {
        if (stage === "online_chunk" && gateOnce) {
          gateOnce = false;
          signalChunkEntered();
          await chunkGate;
        }
      }
    });
    const peerStore = new PostgresMigrationStore({ connectionString: connectionString!, conversionRegistry });
    try {
      await onlineStore.migrate();
      await sql`delete from framekit_migration_runs where tenant_id = any(${tenantIds})`;
      await sql`delete from framekit_migrations where tenant_id = any(${tenantIds})`;
      await sql`delete from framekit_documents where tenant_id = any(${tenantIds})`;
      for (const tenantId of tenantIds) {
        await sql`
          insert into framekit_documents (tenant_id, doctype, id, revision, state, data, created_at, updated_at)
          values (${tenantId}, ${textDocType.name}, 'row-1', 1, null, ${sql.json({ score: "10" })}, now(), now()),
                 (${tenantId}, ${textDocType.name}, 'row-2', 1, null, ${sql.json({ score: "20" })}, now(), now()),
                 (${tenantId}, ${textDocType.name}, 'row-3', 1, null, ${sql.json({ score: "30" })}, now(), now())
        `;
      }
      const planned = await createRuntime(currentApp, { idGenerator: () => "online-v1" }).planMigration(onlineTenant, targetApp);
      const isolatedPlanned = await createRuntime(currentApp, { idGenerator: () => "online-isolated" }).planMigration(isolatedTenant, targetApp);
      const conversionDescriptor = {
        id: "online-record-score-number",
        version: 1,
        doctype: textDocType.name,
        field: "score",
        fromType: "text",
        toType: "number",
        parameters: { offset: 0 }
      };
      const conversion = {
        ...conversionDescriptor,
        artifactDigest
      };
      const unsignedPlan = { ...planned, conversions: [conversion] };
      const plan = { ...unsignedPlan, checksum: await migrationChecksum(unsignedPlan) };
      const approval = {
        approver: "release-manager@example.test",
        planDigest: plan.checksum,
        approvedAt: "2026-07-21T00:00:00.000Z",
        outcome: "approved" as const
      };
      const options = { approval, chunkSize: 2, maxRetries: 0 };

      const rejectedUnsigned = { ...isolatedPlanned, id: "online-rejected", conversions: [conversion] };
      const rejectedPlan = { ...rejectedUnsigned, checksum: await migrationChecksum(rejectedUnsigned) };
      const rejectedApproval = { ...approval, planDigest: rejectedPlan.checksum, outcome: "rejected" as const };
      await expect(onlineStore.applyOnlinePlan(isolatedTenant, rejectedPlan, {
        ...options,
        approval: rejectedApproval
      })).rejects.toMatchObject({ code: "MIGRATION_APPROVAL_REJECTED" });
      await expect(onlineStore.applyOnlinePlan(isolatedTenant, rejectedPlan, {
        ...options,
        approval: { ...rejectedApproval, outcome: "approved" }
      })).rejects.toMatchObject({ code: "MIGRATION_APPROVAL_REJECTED" });
      await expect(onlineStore.getOnlineRun(isolatedTenant, rejectedPlan.appName, rejectedPlan.id)).resolves.toMatchObject({
        status: "failed",
        approval: rejectedApproval
      });

      const invalidDescriptor = { ...conversionDescriptor, id: "online-record-score-invalid-date", parameters: null };
      const invalidConversion = {
        ...invalidDescriptor,
        artifactDigest: invalidArtifactDigest
      };
      const invalidUnsigned = { ...isolatedPlanned, id: "online-invalid-json", conversions: [invalidConversion] };
      const invalidPlan = { ...invalidUnsigned, checksum: await migrationChecksum(invalidUnsigned) };
      await expect(onlineStore.applyOnlinePlan(isolatedTenant, invalidPlan, {
        ...options,
        approval: { ...approval, planDigest: invalidPlan.checksum }
      })).rejects.toMatchObject({ code: "INVALID_MIGRATION_CONVERSION_VALUE" });

      await expect(onlineStore.applyOnlinePlan(onlineTenant, plan, options)).rejects.toThrow("injected online interruption");
      await expect(onlineStore.getOnlineRun(onlineTenant, plan.appName, plan.id)).resolves.toMatchObject({
        status: "failed",
        checkpoint: { conversionIndex: 0, processed: 0 },
        approval
      });
      const driftedConversion = { ...conversion, parameters: { offset: 100 } };
      const driftedUnsigned = { ...plan, conversions: [driftedConversion] };
      const driftedPlan = { ...driftedUnsigned, checksum: await migrationChecksum(driftedUnsigned) };
      expect(driftedPlan.checksum).not.toBe(plan.checksum);
      await expect(onlineStore.applyOnlinePlan(onlineTenant, driftedPlan, {
        ...options,
        approval: { ...approval, planDigest: driftedPlan.checksum }
      })).rejects.toMatchObject({ code: "MIGRATION_PLAN_DRIFT" });

      const concurrent = await Promise.all([
        onlineStore.applyOnlinePlan(onlineTenant, plan, options),
        peerStore.applyOnlinePlan(onlineTenant, plan, options)
      ]);
      expect(concurrent[1]).toEqual(concurrent[0]);
      const converted = await sql<{ id: string; score: number; revision: number }[]>`
        select id, (data ->> 'score')::int as score, revision from framekit_documents
        where tenant_id = ${onlineTenant.tenantId} and doctype = ${textDocType.name} order by id
      `;
      expect(converted).toEqual([
        { id: "row-1", score: 10, revision: 2 },
        { id: "row-2", score: 20, revision: 2 },
        { id: "row-3", score: 30, revision: 2 }
      ]);
      const isolated = await sql<{ scores: string[]; revisions: number[] }[]>`
        select array_agg(data ->> 'score' order by id) as scores, array_agg(revision order by id) as revisions
        from framekit_documents where tenant_id = ${isolatedTenant.tenantId} and doctype = ${textDocType.name}
      `;
      expect(isolated[0]).toEqual({ scores: ["10", "20", "30"], revisions: [1, 1, 1] });
      await expect(onlineStore.getOnlineRun(onlineTenant, plan.appName, plan.id)).resolves.toMatchObject({
        status: "completed",
        checkpoint: { conversionIndex: 1, processed: 3 },
        approval
      });
      await expect(onlineStore.getOnlineRun(onlineTenant, "Other App", plan.id)).resolves.toBeUndefined();

      const timeoutPlanned = await createRuntime(currentApp, { idGenerator: () => "online-timeout" }).planMigration(timeoutTenant, targetApp);
      const timeoutUnsigned = { ...timeoutPlanned, conversions: [conversion] };
      const timeoutPlan = { ...timeoutUnsigned, checksum: await migrationChecksum(timeoutUnsigned) };
      const timeoutOptions = {
        ...options,
        approval: { ...approval, planDigest: timeoutPlan.checksum },
        lockTimeoutMs: 20
      };
      const completingApply = gatedStore.applyOnlinePlan(timeoutTenant, timeoutPlan, timeoutOptions);
      await chunkEntered;
      await expect(peerStore.applyOnlinePlan(timeoutTenant, timeoutPlan, timeoutOptions)).rejects.toMatchObject({
        code: "MIGRATION_LOCK_TIMEOUT"
      });
      releaseChunk();
      await expect(completingApply).resolves.toMatchObject({ id: timeoutPlan.id });
      await expect(gatedStore.getOnlineRun(timeoutTenant, timeoutPlan.appName, timeoutPlan.id)).resolves.toMatchObject({
        status: "completed"
      });
    } finally {
      releaseChunk();
      await sql`delete from framekit_migration_runs where tenant_id = any(${tenantIds})`;
      await sql`delete from framekit_migrations where tenant_id = any(${tenantIds})`;
      await sql`delete from framekit_documents where tenant_id = any(${tenantIds})`;
      await (onlineStore as unknown as { sql: { end(options?: { timeout?: number }): Promise<void> } }).sql.end({ timeout: 1 });
      await (gatedStore as unknown as { sql: { end(options?: { timeout?: number }): Promise<void> } }).sql.end({ timeout: 1 });
      await (peerStore as unknown as { sql: { end(options?: { timeout?: number }): Promise<void> } }).sql.end({ timeout: 1 });
    }
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
      const record = { tenantId: tenant.tenantId, doctype: queryDocType.name, revision: 1, documentStatus: "draft" as const, state: undefined, createdAt: timestamp, updatedAt: timestamp, ...fixture };
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
      documentStatus: "draft" as const,
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

    const adversarialFixtures = [
      { id: "query-missing", data: { status: "edge" } },
      { id: "query-null", data: { name: null, score: null, status: "edge" } },
      { id: "query-empty", data: { name: "", score: "", status: "edge" } },
      { id: "query-zero", data: { name: "zero", score: 0, status: "edge" } },
      { id: "query-unicode-bmp", data: { name: "\uE000", status: "unicode" } },
      { id: "query-unicode-supplementary", data: { name: "\u{10000}", status: "unicode" } }
    ];
    for (const fixture of adversarialFixtures) {
      const record = { tenantId: tenant.tenantId, doctype: queryDocType.name, revision: 1, documentStatus: "draft" as const, state: undefined, createdAt: timestamp, updatedAt: timestamp, ...fixture };
      await memory.create(tenant, queryDocType, record);
      await sql`
        insert into framekit_documents (tenant_id, doctype, id, revision, state, data, created_at, updated_at)
        values (${record.tenantId}, ${record.doctype}, ${record.id}, 1, null, ${sql.json(record.data)}, ${record.createdAt}, ${record.updatedAt})
      `;
    }
    const equalityShapes: Array<{ options: ListOptions; ids: string[] }> = [
      { options: { filters: { status: "edge", name: { eq: null } }, sort: { field: "id", direction: "asc" } }, ids: ["query-null"] },
      { options: { filters: { status: "edge", name: { eq: "" } }, sort: { field: "id", direction: "asc" } }, ids: ["query-empty"] },
      { options: { filters: { status: "edge", name: { ne: "" } }, sort: { field: "id", direction: "asc" } }, ids: ["query-missing", "query-null", "query-zero"] },
      { options: { filters: { status: "edge", name: { in: [null, ""] } }, sort: { field: "id", direction: "asc" } }, ids: ["query-empty", "query-null"] },
      { options: { filters: { status: "edge", name: { isNull: true } }, sort: { field: "id", direction: "asc" } }, ids: ["query-empty", "query-missing", "query-null"] },
      { options: { filters: { status: "edge", score: { lte: 0 } }, sort: { field: "id", direction: "asc" } }, ids: ["query-zero"] }
    ];
    for (const shape of equalityShapes) {
      const postgresPage = await stores.repository.listPage(tenant, queryDocType, shape.options);
      expect(postgresPage).toEqual(await memory.listPage(tenant, queryDocType, shape.options));
      expect(postgresPage.items.map((record) => record.id)).toEqual(shape.ids);
    }

    const unicodeOptions = { filters: { status: "unicode" }, sort: { field: "name", direction: "asc" } as const, limit: 1 };
    const unicodeFirst = await stores.repository.listPage(tenant, queryDocType, unicodeOptions);
    expect(unicodeFirst).toEqual(await memory.listPage(tenant, queryDocType, unicodeOptions));
    expect(unicodeFirst.items.map((record) => record.id)).toEqual(["query-unicode-bmp"]);
    const unicodeNextOptions = { ...unicodeOptions, cursor: unicodeFirst.nextCursor };
    expect(await stores.repository.listPage(tenant, queryDocType, unicodeNextOptions)).toEqual(await memory.listPage(tenant, queryDocType, unicodeNextOptions));

    const booleanFixtures = [
      { id: "query-boolean-missing", data: { status: "boolean" } },
      { id: "query-boolean-null", data: { status: "boolean", enabled: null } },
      { id: "query-boolean-false-a", data: { status: "boolean", enabled: false } },
      { id: "query-boolean-false-b", data: { status: "boolean", enabled: false } },
      { id: "query-boolean-true", data: { status: "boolean", enabled: true } }
    ];
    for (const fixture of booleanFixtures) {
      const record = { tenantId: tenant.tenantId, doctype: queryDocType.name, revision: 1, documentStatus: "draft" as const, state: undefined, createdAt: timestamp, updatedAt: timestamp, ...fixture };
      await memory.create(tenant, queryDocType, record);
      await sql`
        insert into framekit_documents (tenant_id, doctype, id, revision, state, data, created_at, updated_at)
        values (${record.tenantId}, ${record.doctype}, ${record.id}, 1, null, ${sql.json(record.data)}, ${record.createdAt}, ${record.updatedAt})
      `;
    }
    for (const direction of ["asc", "desc"] as const) {
      let postgresCursor: string | undefined;
      let memoryCursor: string | undefined;
      const seen: string[] = [];
      do {
        const options = { filters: { status: "boolean" }, sort: { field: "enabled", direction }, cursor: postgresCursor, limit: 2 };
        const postgresPage = await stores.repository.listPage(tenant, queryDocType, options);
        const memoryPage = await memory.listPage(tenant, queryDocType, { ...options, cursor: memoryCursor });
        expect(postgresPage).toEqual(memoryPage);
        seen.push(...postgresPage.items.map((record) => record.id));
        postgresCursor = postgresPage.nextCursor;
        memoryCursor = memoryPage.nextCursor;
      } while (postgresCursor);
      expect(seen).toEqual(direction === "asc"
        ? ["query-boolean-missing", "query-boolean-null", "query-boolean-false-a", "query-boolean-false-b", "query-boolean-true"]
        : ["query-boolean-true", "query-boolean-false-a", "query-boolean-false-b", "query-boolean-missing", "query-boolean-null"]);
    }

    await expect(stores.repository.listPage(tenant, queryDocType, { filters: { name: { contains: 42 } } as never })).rejects.toMatchObject({ code: "INVALID_QUERY", statusCode: 422 });
    const forgedNumericCursor = btoa(JSON.stringify({ v: 1, field: "score", direction: "asc", value: "10", id: "query-02" }))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    await expect(stores.repository.listPage(tenant, queryDocType, { sort: { field: "score", direction: "asc" }, cursor: forgedNumericCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR", statusCode: 422 });
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

  it("executes cross-DocType command batches atomically with replay and stale-revision rollback", async () => {
    const commandTenant = { ...tenant, tenantId: "pg_command_batch_tenant" };
    const commandApp = defineApp({ name: "Postgres Commands", modules: [defineModule({
      id: "commands", name: "Commands", doctypes: [customerDocType, dealDocType], commands: [{
        id: "customer-deal", label: "Customer and deal", permission: "commands.manage", mode: "atomic",
        doctypes: [customerDocType.name, dealDocType.name], operations: ["create", "update", "delete"], maxOperations: 10
      }]
    })] });
    const runtime = createRuntime(commandApp, {
      repository: stores.repository, audit: stores.audit, outbox: stores.outbox, mutations: stores.mutations,
      idGenerator: createIdGenerator("command")
    });
    try {
      const request = { operations: [
        { operation: "create" as const, doctype: customerDocType.name, id: "command-customer", data: { name: "Command Customer", external_id: "COMMAND-001" } },
        { operation: "create" as const, doctype: dealDocType.name, id: "command-deal", data: { title: "Command Deal" } }
      ], idempotencyKey: "customer-deal-1" };
      const applied = await runtime.executeDocumentCommand(commandTenant, "customer-deal", request);
      expect(applied).toMatchObject({ replayed: false, documents: [{ id: "command-customer" }, { id: "command-deal" }] });
      await expect(runtime.executeDocumentCommand(commandTenant, "customer-deal", request)).resolves.toMatchObject({ replayed: true });
      expect((await stores.audit.list(commandTenant)).filter((event) => ["command-customer", "command-deal"].includes(event.documentId))).toHaveLength(2);

      injectedStage = "outbox";
      await expect(runtime.executeDocumentCommand(commandTenant, "customer-deal", { operations: [
        { operation: "create", doctype: customerDocType.name, id: "fault-customer", data: { name: "Fault", external_id: "COMMAND-FAULT" } },
        { operation: "create", doctype: dealDocType.name, id: "fault-deal", data: { title: "Fault" } }
      ] })).rejects.toThrow("injected outbox failure");
      injectedStage = undefined;
      await expect(runtime.get(commandTenant, customerDocType.name, "fault-customer")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
      await expect(runtime.get(commandTenant, dealDocType.name, "fault-deal")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

      await expect(runtime.executeDocumentCommand(commandTenant, "customer-deal", { operations: [
        { operation: "update", doctype: customerDocType.name, id: "command-customer", expectedRevision: 1, data: { status: "paused" } },
        { operation: "update", doctype: dealDocType.name, id: "command-deal", expectedRevision: 99, data: { title: "Stale" } }
      ] })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      await expect(runtime.get(commandTenant, customerDocType.name, "command-customer")).resolves.toMatchObject({ revision: 1, data: { status: "active" } });
    } finally {
      injectedStage = undefined;
      await sql`delete from framekit_document_unique_values where tenant_id = ${commandTenant.tenantId}`;
      await sql`delete from framekit_idempotency_keys where tenant_id = ${commandTenant.tenantId}`;
      await sql`delete from framekit_audit_events where tenant_id = ${commandTenant.tenantId}`;
      await sql`delete from framekit_outbox_events where tenant_id = ${commandTenant.tenantId}`;
      await sql`delete from framekit_documents where tenant_id = ${commandTenant.tenantId}`;
    }
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

  it("atomically leases outbox rows across stores and enforces retry ownership", async () => {
    const other = new PostgresOutboxStore({ connectionString: connectionString! });
    const claimTenant = { ...tenant, tenantId: "pg_outbox_claim_tenant" };
    await other.migrate();
    await sql`delete from framekit_outbox_events where tenant_id = ${claimTenant.tenantId}`;
    try {
      for (let index = 0; index < 4; index += 1) {
        await stores.outbox.record({
          tenantId: claimTenant.tenantId,
          id: `claim-${index}`,
          type: "customer.created",
          topic: "customer",
          payload: { index },
          status: "pending",
          attempts: 0,
          createdAt: new Date(1_000 + index).toISOString()
        });
      }
      const [left, right] = await Promise.all([
        stores.outbox.claim(claimTenant, { ownerId: "left", limit: 4, now: "2026-07-21T00:00:00.000Z" }),
        other.claim(claimTenant, { ownerId: "right", limit: 4, now: "2026-07-21T00:00:00.000Z" })
      ]);
      expect(left.length + right.length).toBe(4);
      expect(new Set([...left, ...right].map((event) => event.id)).size).toBe(4);
      const claimed = [...left, ...right];
      const first = claimed[0]!;
      const wrongOwner = first.leaseOwner === "left" ? "right" : "left";
      await expect(other.acknowledge(claimTenant, first.id, wrongOwner)).rejects.toMatchObject({ code: "OUTBOX_LEASE_LOST" });
      await stores.outbox.acknowledge(claimTenant, first.id, first.leaseOwner!);

      const expired = claimed[1]!;
      const reclaimed = await other.claim(claimTenant, {
        ownerId: "right", maxAttempts: 2, now: "2026-07-21T00:00:31.000Z"
      });
      expect(reclaimed).toEqual(expect.arrayContaining([expect.objectContaining({ id: expired.id, attempts: 2, leaseOwner: "right" })]));
      await other.reject(claimTenant, expired.id, "right", "terminal", { maxAttempts: 2, now: "2026-07-21T00:00:31.000Z" });
      await expect(other.list(claimTenant, { status: "dead_letter" })).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: expired.id, attempts: 2, error: "terminal" })
      ]));
      await stores.outbox.record({
        tenantId: claimTenant.tenantId,
        id: "already-exhausted",
        type: "customer.created",
        topic: "customer",
        payload: {},
        status: "failed",
        attempts: 2,
        error: "legacy failure",
        createdAt: "2026-07-21T00:00:00.000Z"
      });
      await expect(other.claim(claimTenant, { ownerId: "sweeper", maxAttempts: 2, now: "2026-07-21T00:01:00.000Z" })).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "already-exhausted" })])
      );
      await expect(other.list(claimTenant, { status: "dead_letter" })).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "already-exhausted", attempts: 2, error: "legacy failure" })
      ]));
    } finally {
      await sql`delete from framekit_outbox_events where tenant_id = ${claimTenant.tenantId}`;
      await other.close();
    }
  });

  it("publishes across Postgres instances and replays durable events after a cursor", async () => {
    const heldInsert = deferred<void>();
    const releaseInsert = deferred<void>();
    const insertOrder: string[] = [];
    const publisher = new PostgresRealtimePublisher({
      connectionString: connectionString!,
      faultInjector: async (stage, event) => {
        if (stage !== "inserted") return;
        const id = String(event.payload.id);
        insertOrder.push(id);
        if (id === "held") {
          heldInsert.resolve();
          await releaseInsert.promise;
        }
      }
    });
    const subscriber = new PostgresRealtimePublisher({ connectionString: connectionString! });
    const channel = "tenant:pg_realtime_tenant:documents";
    await publisher.migrate();
    await sql`delete from framekit_realtime_events where channel = ${channel}`;
    const received: Array<{ cursor?: string; payload: Record<string, unknown> }> = [];
    const unsubscribe = await subscriber.subscribe(channel, (event) => received.push(event));
    try {
      await expect(subscriber.health()).resolves.toMatchObject({ ok: true });
      await publisher.publish({ channel, type: "customer.created", payload: { id: "first" } });
      await waitFor(() => received.length === 1);
      const cursor = received[0]!.cursor!;
      await publisher.publish({ channel, type: "customer.updated", payload: { id: "second" } });
      await waitFor(() => received.length === 2);
      await expect(subscriber.list(channel, { after: cursor })).resolves.toEqual([
        expect.objectContaining({ type: "customer.updated", payload: { id: "second" } })
      ]);
      const held = publisher.publish({ channel, type: "customer.updated", payload: { id: "held" } });
      await heldInsert.promise;
      const follower = publisher.publish({ channel, type: "customer.updated", payload: { id: "follower" } });
      await Promise.resolve();
      await Promise.resolve();
      expect(insertOrder.slice(-1)).toEqual(["held"]);
      releaseInsert.resolve();
      await Promise.all([held, follower]);
      await waitFor(() => received.length === 4);
      await Promise.all(Array.from({ length: 50 }, (_, index) => publisher.publish({
        channel,
        type: "customer.updated",
        payload: { id: `burst-${index}` }
      })));
      await waitFor(() => received.length === 54);
      const cursors = received.map((event) => BigInt(event.cursor!));
      expect(cursors).toHaveLength(54);
      expect(new Set(cursors.map(String)).size).toBe(54);
      expect(cursors.every((value, index) => index === 0 || value > cursors[index - 1]!)).toBe(true);
      const replayed = await subscriber.list(channel, { after: cursor, order: "asc", limit: 100 });
      expect(replayed.map((event) => event.cursor)).toEqual(received.slice(1).map((event) => event.cursor));
    } finally {
      unsubscribe();
      await sql`delete from framekit_realtime_events where channel = ${channel}`;
      await Promise.all([publisher.close(), subscriber.close()]);
    }
  }, 10_000);
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
  identityLinks: PostgresAuthIdentityLinkStore;
  lifecycleTokens: PostgresAuthLifecycleTokenStore;
  oidcStates: PostgresOidcAuthorizationStateStore;
  authAudit: PostgresAuthAuditStore;
};

async function migrateAll(stores: StoreSet) {
  await Promise.all(Object.values(stores).map((store) => store.start()));
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
  await stores.identityLinks.migrate();
  await stores.lifecycleTokens.migrate();
  await stores.oidcStates.migrate();
  await stores.authAudit.migrate();
}

async function closeStores(stores: StoreSet) {
  await Promise.all(Object.values(stores).map((store) => store.close()));
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
  await sql`delete from framekit_auth_identity_links where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_auth_lifecycle_tokens where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_oidc_authorization_states where tenant_id = ${tenant.tenantId}`;
  await sql`delete from framekit_auth_audit_events where tenant_id = ${tenant.tenantId}`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for cross-instance event");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createIdGenerator(namespace = "default") {
  let counter = 0;
  return () => `pg-integration-${namespace}-${++counter}`;
}

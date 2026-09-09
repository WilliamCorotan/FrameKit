import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { defineApp, defineDocType, defineModule, FramekitError, type DocumentCommandRequest, type TenantContext } from "@framekit/core";
import { createRuntime, type MutationCommand, type MutationUnitOfWork, type SagaStore } from "@framekit/runtime";
import { PostgresDocumentRepository, PostgresMutationUnitOfWork, PostgresSagaStore, createAuditTableSql, createDocumentTableSql, createMutationTablesSql, createOutboxTableSql } from "./index.js";
import { runBootstrapMigrations } from "./connection.js";
import type { PostgresMutationStage } from "./types.js";

const connectionString = process.env.DATABASE_URL;
const documentType = defineDocType({
  name: "saga_test_record", label: "Saga record", ownership: {},
  rowPolicy: { read: [{ owner: "self" }], write: [{ owner: "self" }] },
  fields: [{ name: "title", label: "Title", type: "text", required: true }],
  permissions: ["create", "read", "update", "delete"].map((action) => ({ action: action as "create", permissions: ["saga.records"] }))
});
const app = defineApp({ name: "Saga tests", modules: [defineModule({
  id: "saga", name: "Saga", doctypes: [documentType], commands: [{
    id: "saga-records", label: "Saga records", permission: "saga.run", mode: "saga", doctypes: [documentType.name], operations: ["create", "update", "delete"]
  }]
})] });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function request(key: string, count = 2): DocumentCommandRequest {
  return { idempotencyKey: key, operations: Array.from({ length: count }, (_, index) => ({
    operation: "create", doctype: documentType.name, id: `${key}-${index}`, data: { title: `Record ${index}` },
    compensation: { operation: "delete", doctype: documentType.name, id: `${key}-${index}`, expectedRevision: 1 }
  })) };
}

describe.skipIf(!connectionString)("durable saga recovery and mutation fencing", () => {
  const sql = postgres(connectionString!, { max: 4, onnotice: () => undefined });
  const tenants: string[] = [];
  const resources: Array<{ close(): Promise<void> }> = [];

  beforeAll(async () => {
    await runBootstrapMigrations(sql, createDocumentTableSql(), createAuditTableSql(), createOutboxTableSql(), createMutationTablesSql());
    const store = new PostgresSagaStore({ connectionString: connectionString! });
    await store.migrate();
    await store.close();
  });
  afterEach(async () => {
    await Promise.all(resources.splice(0).map((resource) => resource.close()));
    for (const tenant of tenants.splice(0)) {
      await sql`delete from framekit_sagas where tenant_id = ${tenant}`;
      await sql`delete from framekit_idempotency_keys where tenant_id = ${tenant}`;
      await sql`delete from framekit_document_unique_values where tenant_id = ${tenant}`;
      await sql`delete from framekit_documents where tenant_id = ${tenant}`;
      await sql`delete from framekit_audit_events where tenant_id = ${tenant}`;
      await sql`delete from framekit_outbox_events where tenant_id = ${tenant}`;
    }
  });
  afterAll(async () => { await sql.end(); });

  function fixture(faultInjector?: (stage: PostgresMutationStage, command: MutationCommand) => void | Promise<void>) {
    const tenant: TenantContext = { tenantId: `saga-${crypto.randomUUID()}`, userId: "initiator", roles: [], permissions: ["saga.run", "saga.records"] };
    tenants.push(tenant.tenantId);
    const repository = new PostgresDocumentRepository({ connectionString: connectionString! });
    const mutations = new PostgresMutationUnitOfWork({ connectionString: connectionString!, faultInjector });
    const sagas = new PostgresSagaStore({ connectionString: connectionString! });
    const second = new PostgresSagaStore({ connectionString: connectionString! });
    resources.push(repository, mutations, sagas, second);
    const runtime = (store: SagaStore = sagas, unit: MutationUnitOfWork = mutations) => createRuntime(app, { repository, mutations: unit, sagas: store });
    const expire = async (key: string) => { await sql`update framekit_sagas set lease_until = clock_timestamp() - interval '1 second' where tenant_id = ${tenant.tenantId} and key = ${key}`; };
    return { tenant, repository, mutations, sagas, second, runtime, expire };
  }

  async function direct(f: ReturnType<typeof fixture>, key: string, owner: string, leaseMs = 30_000) {
    let journal = await f.sagas.claim({ tenantId: f.tenant.tenantId, key, owner, command: "saga-records", fingerprint: key, operations: request(key, 1).operations, leaseMs });
    journal = await f.sagas.save({ tenantId: f.tenant.tenantId, key, owner, expectedRevision: journal.revision,
      progress: { phase: "running", nextStep: 0, activeStep: 0, documents: [] }, leaseMs });
    const timestamp = new Date().toISOString();
    const command: MutationCommand = {
      tenant: f.tenant, doctype: documentType, operation: "create",
      document: { tenantId: f.tenant.tenantId, doctype: documentType.name, id: key, revision: 1, documentStatus: "draft", ownerId: f.tenant.userId, data: { title: key }, createdAt: timestamp, updatedAt: timestamp },
      idempotencyKey: `direct:${key}`, idempotencyFingerprint: key,
      sagaFence: { key, owner, phase: "running", step: 0 }, afterWrite: async () => undefined,
      sideEffects: {
        audit: { id: crypto.randomUUID(), tenantId: f.tenant.tenantId, userId: f.tenant.userId, action: "test", doctype: documentType.name, documentId: key, createdAt: timestamp },
        outbox: { id: crypto.randomUUID(), tenantId: f.tenant.tenantId, type: "test", topic: "test", payload: {}, status: "pending", attempts: 0, createdAt: timestamp }
      }
    };
    return { journal, command };
  }

  it("retains a completed receipt, rejects modified requests, and reauthorizes current ownership", async () => {
    const f = fixture();
    const input = request("completed");
    expect(await f.runtime().executeDocumentCommand(f.tenant, "saga-records", input)).toMatchObject({ replayed: false, documents: [{ id: "completed-0" }, { id: "completed-1" }] });
    expect((await f.sagas.get(f.tenant.tenantId, input.idempotencyKey!))?.phase).toBe("completed");
    expect(await f.runtime(f.second).executeDocumentCommand(f.tenant, "saga-records", input)).toMatchObject({ replayed: true });
    const modified = structuredClone(input);
    modified.operations[0] = { ...modified.operations[0]!, operation: "create", data: { title: "Changed" } };
    await expect(f.runtime().executeDocumentCommand(f.tenant, "saga-records", modified)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await sql`update framekit_documents set owner_id = 'another-user' where tenant_id = ${f.tenant.tenantId} and id = 'completed-0'`;
    await expect(f.runtime().executeDocumentCommand(f.tenant, "saga-records", input)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    const [count] = await sql<{ total: number }[]>`select count(*)::int as total from framekit_audit_events where tenant_id = ${f.tenant.tenantId}`;
    expect(count?.total).toBe(2);
  });

  it("rejects live competing claims and stale owners before both new writes and receipt replay", async () => {
    const f = fixture();
    const { command } = await direct(f, "fenced", "old");
    const claim = { tenantId: f.tenant.tenantId, key: "fenced", owner: "new", command: "saga-records", fingerprint: "fenced", operations: request("fenced", 1).operations, leaseMs: 30_000 };
    await expect(f.second.claim(claim)).rejects.toMatchObject({ code: "COMMAND_SAGA_BUSY" });
    await f.expire("fenced");
    await f.second.claim(claim);
    await expect(f.mutations.execute(command)).rejects.toMatchObject({ code: "COMMAND_SAGA_LEASE_LOST" });
    expect(await f.repository.get(f.tenant, documentType, "fenced")).toBeUndefined();
    await f.mutations.execute({ ...command, sagaFence: { ...command.sagaFence!, owner: "new" } });
    await expect(f.mutations.execute(command)).rejects.toMatchObject({ code: "COMMAND_SAGA_LEASE_LOST" });
  });

  it("holds the journal lock through commit so a new claim drains the old transaction", async () => {
    const entered = deferred();
    const resume = deferred();
    const f = fixture(async (stage) => { if (stage === "document") { entered.resolve(); await resume.promise; } });
    const { journal, command } = await direct(f, "drain", "old", 150);
    const mutation = f.mutations.execute(command);
    await entered.promise;
    await new Promise((resolve) => setTimeout(resolve, 180));
    let claimed = false;
    const next = f.second.claim({ tenantId: f.tenant.tenantId, key: "drain", owner: "new", command: "saga-records", fingerprint: "drain", operations: request("drain", 1).operations, leaseMs: 30_000 }).then((value) => { claimed = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(claimed).toBe(false);
    resume.resolve();
    await mutation;
    expect((await next).owner).toBe("new");
    expect(await f.mutations.replay(f.tenant, command.idempotencyKey!, command.idempotencyFingerprint)).toMatchObject({ found: true });
    await expect(f.sagas.save({ tenantId: f.tenant.tenantId, key: "drain", owner: "old", expectedRevision: journal.revision,
      progress: { phase: "running", nextStep: 1, documents: [command.document] }, leaseMs: 30_000 })).rejects.toMatchObject({ code: "COMMAND_SAGA_LEASE_LOST" });
  });

  it("resumes a crash after step commit but before progress without repeating side effects", async () => {
    const f = fixture();
    let crash = true;
    const store: SagaStore = {
      get: f.sagas.get.bind(f.sagas), claim: f.sagas.claim.bind(f.sagas), describe: f.sagas.describe.bind(f.sagas),
      async save(input) {
        if (crash && input.progress.phase === "running" && input.progress.nextStep === 1) {
          crash = false;
          await f.expire(input.key);
          throw new FramekitError("COMMAND_SAGA_LEASE_LOST", "Simulated process loss", 409);
        }
        return f.sagas.save(input);
      }
    };
    const input = request("crash");
    await expect(f.runtime(store).executeDocumentCommand(f.tenant, "saga-records", input)).rejects.toMatchObject({ code: "COMMAND_SAGA_LEASE_LOST" });
    expect(await f.sagas.get(f.tenant.tenantId, "crash")).toMatchObject({ phase: "running", nextStep: 0, activeStep: 0 });
    const restricted = { ...f.tenant, permissions: ["saga.run"] };
    await expect(f.runtime(f.second).executeDocumentCommand(restricted, "saga-records", input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const changedAuthority = { ...f.tenant, permissions: [...f.tenant.permissions, "new.permission"], roles: ["new-role"] };
    expect(await f.runtime(f.second).executeDocumentCommand(changedAuthority, "saga-records", input)).toMatchObject({ documents: [{ id: "crash-0" }, { id: "crash-1" }] });
    const [count] = await sql<{ total: number }[]>`select count(*)::int as total from framekit_audit_events where tenant_id = ${f.tenant.tenantId}`;
    expect(count?.total).toBe(2);
  });

  it("compensates the active step after an unknown commit result, even before a progress receipt was saved", async () => {
    const f = fixture();
    let loseResponse = true;
    const unit: MutationUnitOfWork = {
      describe: f.mutations.describe.bind(f.mutations), replay: f.mutations.replay.bind(f.mutations),
      async execute(command) {
        const result = await f.mutations.execute(command);
        if (loseResponse) { loseResponse = false; throw new Error("commit response lost"); }
        return result;
      }
    };
    const input = request("unknown", 1);
    await expect(f.runtime(f.sagas, unit).executeDocumentCommand(f.tenant, "saga-records", input)).rejects.toMatchObject({ code: "COMMAND_SAGA_FAILED", details: { compensationFailures: [] } });
    expect(await f.repository.get(f.tenant, documentType, "unknown-0")).toBeUndefined();
    expect(await f.sagas.get(f.tenant.tenantId, "unknown")).toMatchObject({ phase: "compensated", compensationIndex: -1 });
    await expect(f.runtime().executeDocumentCommand(f.tenant, "saga-records", input)).rejects.toMatchObject({ code: "COMMAND_SAGA_TERMINAL" });
  });

  it("retains a failed compensation for retry and never resumes forward execution afterward", async () => {
    let rejectForward = true;
    let rejectCompensation = true;
    const f = fixture((stage, command) => {
      if (stage !== "document") return;
      if (command.sagaFence?.phase === "running" && command.sagaFence.step === 1 && rejectForward) { rejectForward = false; throw new Error("forward failed"); }
      if (command.sagaFence?.phase === "compensating" && rejectCompensation) { rejectCompensation = false; throw new Error("compensation failed once"); }
    });
    const input = request("retry");
    await expect(f.runtime().executeDocumentCommand(f.tenant, "saga-records", input)).rejects.toMatchObject({ code: "COMMAND_SAGA_FAILED", details: { compensationFailures: [{ index: 0 }] } });
    expect(await f.sagas.get(f.tenant.tenantId, "retry")).toMatchObject({ phase: "compensating", compensationIndex: 0 });
    expect(await f.repository.get(f.tenant, documentType, "retry-0")).toBeDefined();
    await expect(f.runtime(f.second).executeDocumentCommand(f.tenant, "saga-records", input)).rejects.toMatchObject({ code: "COMMAND_SAGA_FAILED", details: { compensationFailures: [] } });
    expect(await f.repository.get(f.tenant, documentType, "retry-0")).toBeUndefined();
    expect(await f.repository.get(f.tenant, documentType, "retry-1")).toBeUndefined();
    await expect(f.runtime().executeDocumentCommand(f.tenant, "saga-records", input)).rejects.toMatchObject({ code: "COMMAND_SAGA_TERMINAL" });
  });

  it("rejects wrong-phase mutations and preserves tenant isolation for colliding delimiter keys", async () => {
    const f = fixture();
    const { journal, command } = await direct(f, "phase", "owner");
    await f.sagas.save({ tenantId: f.tenant.tenantId, key: "phase", owner: "owner", expectedRevision: journal.revision,
      progress: { phase: "compensating", nextStep: 0, compensationIndex: 0, documents: [], failure: { message: "stop" } }, leaseMs: 30_000 });
    await expect(f.mutations.execute(command)).rejects.toMatchObject({ code: "COMMAND_SAGA_LEASE_LOST" });
    const claim = { command: "saga-records", fingerprint: "scope", operations: request("scope", 1).operations, owner: "owner", leaseMs: 30_000 };
    tenants.push(`${f.tenant.tenantId}:a`);
    await f.sagas.claim({ ...claim, tenantId: `${f.tenant.tenantId}:a`, key: "b" });
    await f.second.claim({ ...claim, tenantId: f.tenant.tenantId, key: "a:b" });
    expect(await f.sagas.get(f.tenant.tenantId, "b")).toBeUndefined();
  });

  it("replays a committed compensation after its progress checkpoint is lost", async () => {
    const f = fixture((stage, command) => {
      if (stage === "document" && command.sagaFence?.phase === "running" && command.sagaFence.step === 1) throw new Error("forward failure");
    });
    let crash = true;
    const store: SagaStore = {
      get: f.sagas.get.bind(f.sagas), claim: f.sagas.claim.bind(f.sagas), describe: f.sagas.describe.bind(f.sagas),
      async save(input) {
        if (crash && input.progress.phase === "compensating" && input.progress.compensationIndex === -1) {
          crash = false;
          await f.expire(input.key);
          throw new FramekitError("COMMAND_SAGA_LEASE_LOST", "Simulated compensation checkpoint loss", 409);
        }
        return f.sagas.save(input);
      }
    };
    const input = request("compensation-crash");
    await expect(f.runtime(store).executeDocumentCommand(f.tenant, "saga-records", input)).rejects.toMatchObject({ code: "COMMAND_SAGA_LEASE_LOST" });
    expect(await f.sagas.get(f.tenant.tenantId, input.idempotencyKey!)).toMatchObject({ phase: "compensating", compensationIndex: 0 });
    expect(await f.repository.get(f.tenant, documentType, "compensation-crash-0")).toBeUndefined();
    await expect(f.runtime(f.second).executeDocumentCommand(f.tenant, "saga-records", input)).rejects.toMatchObject({ code: "COMMAND_SAGA_FAILED", details: { compensationFailures: [] } });
    expect((await f.sagas.get(f.tenant.tenantId, input.idempotencyKey!))?.phase).toBe("compensated");
    const [count] = await sql<{ total: number }[]>`select count(*)::int as total from framekit_audit_events where tenant_id = ${f.tenant.tenantId}`;
    expect(count?.total).toBe(2);
  });
});

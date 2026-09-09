import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineApp, defineDocType, defineModule } from "../packages/core/dist/index.js";
import { createRuntime } from "../packages/runtime/dist/index.js";
import { createPostgresConnection, PostgresDocumentRepository, PostgresAuditStore, PostgresOutboxStore, PostgresMutationUnitOfWork } from "../packages/db/dist/index.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point to a disposable verification database.");
const durationSeconds = positiveInteger("FRAMEKIT_SOAK_SECONDS", 30, 86400);
const concurrency = positiveInteger("FRAMEKIT_SOAK_CONCURRENCY", 8, 128);
const poolMax = positiveInteger("FRAMEKIT_DB_POOL_MAX", 4, 128);
const tenant = { tenantId: `operations-${crypto.randomUUID()}`, userId: "probe", roles: [], permissions: ["*"] };
function connect() {
  const connection = createPostgresConnection({ connectionString: process.env.DATABASE_URL, max: poolMax });
  const options = { connectionString: process.env.DATABASE_URL, connection };
  return { connection, adapters: {
    repository: new PostgresDocumentRepository(options), audit: new PostgresAuditStore(options),
    outbox: new PostgresOutboxStore(options), mutations: new PostgresMutationUnitOfWork(options)
  } };
}
let { connection, adapters } = connect();
const app = defineApp({ name: "Operations probe", modules: [defineModule({ id: "probe", name: "Probe", doctypes: [defineDocType({ name: "probe", label: "Probe", fields: [{ name: "value", label: "Value", type: "number", required: true }] })] })] });
let runtime;
const latencies = [];
let cycles = 0;
const started = performance.now();
try {
  for (const adapter of Object.values(adapters)) await adapter.migrate();
  runtime = createRuntime(app, adapters);
  await runtime.start();
  const initial = await runtime.create(tenant, "probe", { value: 0 }, { idempotencyKey: "restart-probe" });
  await runtime.close();
  await connection.close();
  ({ connection, adapters } = connect());
  runtime = createRuntime(app, adapters);
  await runtime.start();
  const replay = await runtime.create(tenant, "probe", { value: 0 }, { idempotencyKey: "restart-probe" });
  assert.equal(replay.id, initial.id, "restart replay duplicated a committed mutation");
  const competing = await Promise.allSettled([1, 2].map((value) => runtime.update(tenant, "probe", initial.id, { value }, { expectedRevision: initial.revision })));
  assert.equal(competing.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = competing.find((item) => item.status === "rejected");
  assert.equal(rejected.reason.code, "REVISION_CONFLICT");
  const deadline = performance.now() + durationSeconds * 1000;
  const results = await Promise.allSettled(Array.from({ length: concurrency }, async (_, worker) => {
    let iteration = 0;
    while (performance.now() < deadline) {
      const cycleStart = performance.now();
      const key = `${worker}-${iteration++}`;
      const created = await runtime.create(tenant, "probe", { value: worker }, { idempotencyKey: key });
      const duplicate = await runtime.create(tenant, "probe", { value: worker }, { idempotencyKey: key });
      assert.equal(created.id, duplicate.id);
      const updated = await runtime.update(tenant, "probe", created.id, { value: worker + 1 }, { expectedRevision: created.revision });
      const read = await runtime.get(tenant, "probe", created.id);
      assert.equal(read.revision, updated.revision);
      assert.equal(read.data.value, worker + 1);
      cycles++;
      const elapsed = performance.now() - cycleStart;
      if (latencies.length < 100_000) latencies.push(elapsed);
      else {
        const sample = Math.floor(Math.random() * cycles);
        if (sample < latencies.length) latencies[sample] = elapsed;
      }
    }
  }));
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (errors.length) throw new AggregateError(errors, "Operations verification failed.");
  const [{ count }] = await connection.sql`select count(*)::int as count from framekit_documents where tenant_id = ${tenant.tenantId}`;
  assert.equal(count, cycles + 1, "idempotency or mutation count mismatch");
  latencies.sort((a, b) => a - b);
  const percentile = (fraction) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))];
  const report = {
    ok: true, at: new Date().toISOString(), durationSeconds, concurrency, poolMax, cycles,
    elapsedMs: Math.round(performance.now() - started), latencySamples: latencies.length,
    cycleLatencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
    checks: ["new-client-restart-idempotency", "competing-revision-fencing", "concurrent-create-replay-update-read", "persisted-count"],
    scope: "Postgres runtime component probe; not HTTP capacity, failover, or a production SLO certification."
  };
  const output = resolve(process.env.FRAMEKIT_OPERATIONS_REPORT ?? ".release/operations.json");
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  try {
    await runtime?.close();
    for (const table of ["framekit_document_unique_values", "framekit_idempotency_keys", "framekit_documents", "framekit_audit_events", "framekit_outbox_events"]) {
      await connection.sql`delete from ${connection.sql(table)} where tenant_id = ${tenant.tenantId}`;
    }
  } finally { await connection.close(); }
}
function positiveInteger(name, fallback, maximum) {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(value) || value > maximum) throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  return value;
}

import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { defineApp, defineDocType, defineModule } from "../packages/core/dist/index.js";
import { createRuntime } from "../packages/runtime/dist/index.js";
import { createPostgresConnection, PostgresDocumentRepository, PostgresMutationUnitOfWork, PostgresAuditStore, PostgresOutboxStore } from "../packages/db/dist/index.js";

if (!process.env.DATABASE_URL) throw new Error("Crash verification requires a disposable DATABASE_URL.");
const doctype = defineDocType({ name: "crash_probe", label: "Crash probe", fields: [{ name: "title", label: "Title", type: "text" }] });
const app = defineApp({ name: "Crash probe", modules: [defineModule({ id: "probe", name: "Probe", doctypes: [doctype] })] });
const tenantId = process.env.FRAMEKIT_CRASH_TENANT ?? `crash-${crypto.randomUUID()}`;
const tenant = { tenantId, userId: "probe", roles: [], permissions: ["*"] };
const connection = createPostgresConnection({ connectionString: process.env.DATABASE_URL, max: 2 });
const repository = new PostgresDocumentRepository({ connection: connection, connectionString: process.env.DATABASE_URL });
const mutations = new PostgresMutationUnitOfWork({ connection: connection, connectionString: process.env.DATABASE_URL });
const audit = new PostgresAuditStore({ connection, connectionString: process.env.DATABASE_URL });
const outbox = new PostgresOutboxStore({ connection, connectionString: process.env.DATABASE_URL });
const mode = process.argv[2];
if (mode === "committed" || mode === "replay") {
  const runtime = createRuntime(app, { repository, mutations, audit, outbox });
  await runtime.start();
  const record = await runtime.create(tenant, doctype.name, { title: "Committed before crash" }, { idempotencyKey: "crash-receipt" });
  process.send({ ready: true, id: record.id });
  await new Promise(() => {});
} else if (mode === "uncommitted") {
  await connection.sql.begin(async (tx) => {
    await tx`insert into framekit_documents (tenant_id, doctype, id, revision, data, created_at, updated_at)
      values (${tenantId}, ${doctype.name}, 'uncommitted', 1, ${tx.json({ title: "Must roll back" })}, now(), now())`;
    process.send({ ready: true });
    await new Promise(() => {});
  });
} else {
  const children = new Set();
  async function crash(stage) {
    const child = fork(fileURLToPath(import.meta.url), [stage], {
      env: { ...process.env, FRAMEKIT_CRASH_TENANT: tenantId }, stdio: ["ignore", "ignore", "pipe", "ipc"]
    });
    children.add(child);
    let stderr = "";
    child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-4000); });
    let timeout;
    try {
      const result = await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Crash child ${stage} timed out.`)), 15000);
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`Crash child ${stage} exited ${code}: ${stderr}`)));
        child.once("message", resolve);
      });
      assert.equal(result.ready, true);
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      assert.equal((await exited)[1], "SIGKILL");
      children.delete(child);
      return result;
    } finally { clearTimeout(timeout); }
  }
  try {
    await repository.migrate();
    await mutations.migrate();
    await audit.migrate();
    await outbox.migrate();
    const committed = await crash("committed");
    const replay = await crash("replay");
    assert.equal(replay.id, committed.id);
    await crash("uncommitted");
    const rows = await connection.sql`select id from framekit_documents where tenant_id = ${tenantId}`;
    assert.deepEqual(rows.map((row) => row.id), [committed.id]);
    console.log(JSON.stringify({ ok: true, checks: ["SIGKILL-after-commit-receipt-replay", "SIGKILL-before-commit-rollback"], scope: "Local PostgreSQL component recovery; not managed-service failover." }, null, 2));
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
    }
    try {
      for (const table of ["framekit_idempotency_keys", "framekit_document_unique_values", "framekit_outbox_events", "framekit_audit_events", "framekit_documents"]) {
        if ((await connection.sql`select to_regclass(${table}) as relation`)[0]?.relation) await connection.sql`delete from ${connection.sql(table)} where tenant_id = ${tenantId}`;
      }
    } finally { await connection.close(); }
  }
}

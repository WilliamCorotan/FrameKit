import { loadLocalEnvironment, requireDatabaseUrl } from "./environment.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createPostgresConnection, PostgresDocumentRepository, PostgresCustomizationStore } from "../packages/db/dist/index.js";
import { createAesGcmSettingsSecrets, S3AttachmentStorage } from "../packages/storage/dist/index.js";
import { defineDocType } from "../packages/core/dist/index.js";

loadLocalEnvironment();
requireDatabaseUrl();

if (!process.env.DATABASE_URL || !process.env.FRAMEKIT_TEST_S3_ENDPOINT) throw new Error("Recovery verification requires a disposable admin DATABASE_URL and FRAMEKIT_TEST_S3_ENDPOINT.");
const require = createRequire(new URL("../packages/storage/package.json", import.meta.url));
const { S3Client, CreateBucketCommand, DeleteBucketCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const admin = createPostgresConnection({ connectionString: process.env.DATABASE_URL, max: 2 });
const suffix = crypto.randomUUID().replaceAll("-", "");
const sourceName = `fk_backup_${suffix}`;
const restoredName = `fk_restore_${suffix}`;
const bucket = `framekit-recovery-${suffix}`;
const directory = await mkdtemp(join(tmpdir(), "framekit-recovery-"));
const archive = join(directory, "database.dump");
const createdDatabases = [];
let bucketCreated = false;
const connections = [];
const client = new S3Client({ endpoint: process.env.FRAMEKIT_TEST_S3_ENDPOINT, region: "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: process.env.FRAMEKIT_TEST_S3_ACCESS_KEY ?? "framekit-test", secretAccessKey: process.env.FRAMEKIT_TEST_S3_SECRET_KEY ?? "framekit-test-password" }
});
const tenant = { tenantId: "restore-probe", userId: "probe", roles: [], permissions: ["*"] };
const doctype = defineDocType({ name: "restore_probe", label: "Restore probe", fields: [{ name: "name", label: "Name", type: "text" }] });
const context = { appName: "Restore probe", scopeId: "tenant:restore-probe", key: "secret" };
const keyBytes = crypto.getRandomValues(new Uint8Array(32));
const keyring = createAesGcmSettingsSecrets({ activeKeyId: "backup-key", keys: { "backup-key": keyBytes } });
const now = new Date().toISOString();
const record = { id: "record", tenantId: tenant.tenantId, doctype: doctype.name, revision: 1, documentStatus: "draft", data: { name: "Restored record" }, createdAt: now, updatedAt: now };
try {
  for (const name of [sourceName, restoredName]) {
    await admin.sql`create database ${admin.sql(name)}`;
    createdDatabases.push(name);
  }
  const sourceUrl = databaseUrl(sourceName);
  const source = connect(sourceUrl);
  const repository = new PostgresDocumentRepository({ connectionString: sourceUrl, connection: source });
  const settings = new PostgresCustomizationStore({ connectionString: sourceUrl, connection: source });
  const storage = new S3AttachmentStorage({ sql: source.sql, client, bucket, namespace: context.appName });
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  bucketCreated = true;
  await repository.migrate(); await settings.migrate(); await storage.migrate();
  await repository.create(tenant, doctype, record);
  const persistedRecord = await repository.get(tenant, doctype, record.id);
  await settings.upsertSettingValue(tenant, { ...context, value: await keyring.seal("recoverable-secret", context), protected: true, updatedAt: now });
  await storage.put("restore-probe/object", new Uint8Array([1, 2, 3, 255]), { contentType: "application/octet-stream" });
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
  assert.equal(listed.IsTruncated, false);
  const objects = await Promise.all((listed.Contents ?? []).map(async ({ Key }) => {
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key }));
    return { Key, Body: await object.Body.transformToByteArray(), ContentType: object.ContentType };
  }));
  assert.equal(objects.length, 1);
  await source.close();
  runPg("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", archive], sourceUrl);
  await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects.map(({ Key }) => ({ Key })) } }));
  const empty = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
  assert.equal(empty.KeyCount, 0);
  runPg("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "--dbname", restoredName, archive], databaseUrl(restoredName));
  for (const object of objects) await client.send(new PutObjectCommand({ Bucket: bucket, ...object }));
  const restoredUrl = databaseUrl(restoredName);
  const restored = connect(restoredUrl);
  const restoredRepository = new PostgresDocumentRepository({ connectionString: restoredUrl, connection: restored });
  const restoredSettings = new PostgresCustomizationStore({ connectionString: restoredUrl, connection: restored });
  const restoredStorage = new S3AttachmentStorage({ sql: restored.sql, client, bucket, namespace: context.appName });
  assert.deepEqual(await restoredRepository.get(tenant, doctype, record.id), persistedRecord);
  const [value] = await restoredSettings.listSettingValues(tenant, context.appName);
  const recoveredKeyring = createAesGcmSettingsSecrets({ activeKeyId: "new-key", keys: { "backup-key": keyBytes, "new-key": crypto.getRandomValues(new Uint8Array(32)) } });
  assert.equal(await recoveredKeyring.unseal(value.value, context), "recoverable-secret");
  assert.deepEqual(await restoredStorage.get("restore-probe/object"), new Uint8Array([1, 2, 3, 255]));
  assert.equal(await restoredRepository.get({ ...tenant, tenantId: "other" }, doctype, record.id), undefined);
  console.log(JSON.stringify({ ok: true, at: new Date().toISOString(), checks: ["pg-dump-restore-new-database", "document-tenant-isolation", "historical-secret-key", "registry-and-object-bytes-restored"], scope: "Isolated fixture restore; deployment backup policies and recovery objectives need separate qualification." }));
} finally {
  const failures = [];
  for (const connection of connections) { try { await connection.close(); } catch (error) { failures.push(error); } }
  if (bucketCreated) {
    try {
      const objects = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
      if (objects.Contents?.length) await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects.Contents.map(({ Key }) => ({ Key })) } }));
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    } catch (error) { failures.push(error); }
  }
  client.destroy();
  for (const name of createdDatabases.reverse()) { try { await admin.sql`drop database ${admin.sql(name)}`; } catch (error) { failures.push(error); } }
  await admin.close();
  await rm(directory, { recursive: true, force: true });
  if (failures.length) throw new AggregateError(failures, "Recovery fixture cleanup failed.");
}
function databaseUrl(name) { const url = new URL(process.env.DATABASE_URL); url.pathname = `/${name}`; return url.href; }
function connect(url) { const connection = createPostgresConnection({ connectionString: url, max: 2 }); connections.push(connection); return connection; }
function runPg(command, args, url) {
  // Credentials stay in the child environment, never command arguments or output.
  const parsed = new URL(url);
  execFileSync(command, args, { env: { ...process.env, PGHOST: parsed.hostname, PGPORT: parsed.port || "5432", PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password), PGDATABASE: parsed.pathname.slice(1), PGSSLMODE: parsed.searchParams.get("sslmode") ?? "prefer" }, stdio: ["ignore", "ignore", "pipe"] });
}

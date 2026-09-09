import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { S3AttachmentStorage } from "./s3.js";

const url = process.env.DATABASE_URL;
const endpoint = process.env.FRAMEKIT_TEST_S3_ENDPOINT;

describe.skipIf(!url || !endpoint)("durable S3 attachment storage", () => {
  const sql = postgres(url!, { max: 3 });
  const client = new S3Client({
    endpoint, region: "us-east-1", forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: process.env.FRAMEKIT_TEST_S3_ACCESS_KEY ?? "framekit-test", secretAccessKey: process.env.FRAMEKIT_TEST_S3_SECRET_KEY ?? "framekit-test-password" }
  });
  const bucket = `framekit-${crypto.randomUUID()}`;
  const namespace = crypto.randomUUID();
  const options = { sql, client, bucket, namespace };
  const storage = new S3AttachmentStorage(options);
  const identity = JSON.stringify([namespace, bucket, "framekit"]);
  beforeAll(async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    await storage.migrate();
    await storage.start();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    const objects = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    if (objects.Contents?.length) await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects.Contents.map(({ Key }) => ({ Key })) } }));
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    await sql`delete from framekit_attachment_objects where namespace = ${identity}`;
    await storage.close();
    client.destroy();
    await sql.end();
  });

  it("survives restart, isolates namespaces, and retains expired but owned uploads", async () => {
    await storage.put("tenant/app/file", new Uint8Array([1, 2, 3]), { contentType: "application/octet-stream", lease: { owner: "upload", durationMs: 1000 } });
    const peer = new S3AttachmentStorage(options);
    await expect(peer.get("tenant/app/file")).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(new S3AttachmentStorage({ ...options, namespace: "different" }).get("tenant/app/file")).resolves.toBeUndefined();
    await sql`update framekit_attachment_objects set lease_expires_at = clock_timestamp() - interval '1 hour', created_at = clock_timestamp() - interval '1 hour' where namespace = ${identity}`;
    await peer.releaseLease("tenant/app/file", "wrong-owner");
    await expect(peer.listCleanupCandidates("tenant/")).resolves.toEqual([]);
    await expect(peer.put("tenant/app/file", new Uint8Array([9]), { contentType: "text/plain" })).rejects.toMatchObject({ code: "ATTACHMENT_KEY_EXISTS" });
    await expect(peer.get("tenant/app/file")).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await peer.releaseLease("tenant/app/file", "upload");
    const [candidate] = await peer.listCleanupCandidates("tenant/");
    expect(candidate).toBeDefined();
    await expect(peer.deleteIfUnleased(candidate!.key, { minimumAgeMs: 60_000, expectedRevision: "wrong" })).resolves.toBe(false);
    const results = await Promise.all([storage, peer].map((store) => store.deleteIfUnleased(candidate!.key, { minimumAgeMs: 60_000, expectedRevision: candidate!.revision })));
    expect(results.sort()).toEqual([false, true]);
    await expect(peer.get(candidate!.key)).resolves.toBeUndefined();
    await peer.close();
    await expect(storage.list("tenant/")).resolves.toEqual([]);
  });

  it("repairs failed object deletion after restart without deleting a different generation", async () => {
    await storage.put("tenant/app/delete", new Uint8Array([4]), { contentType: "text/plain" });
    vi.spyOn(client, "send").mockRejectedValueOnce(new Error("injected object-storage outage"));
    await expect(storage.delete("tenant/app/delete")).rejects.toThrow("injected object-storage outage");
    vi.restoreAllMocks();
    const [pending] = await sql`select state from framekit_attachment_objects where namespace = ${identity} and logical_key = 'tenant/app/delete'`;
    expect(pending?.state).toBe("deleting");
    await storage.put("tenant/app/keep", new Uint8Array([5]), { contentType: "text/plain" });
    const restarted = new S3AttachmentStorage(options);
    expect(await restarted.retryPendingDeletes()).toBeGreaterThan(0);
    await expect(restarted.get("tenant/app/delete")).resolves.toBeUndefined();
    await expect(restarted.get("tenant/app/keep")).resolves.toEqual(new Uint8Array([5]));
    const [repaired] = await sql`select state from framekit_attachment_objects where namespace = ${identity} and logical_key = 'tenant/app/delete'`;
    expect(repaired?.state).toBe("deleted");
    await restarted.close();
  });

  it("advances past failed pending deletes and does not starve later rows", async () => {
    for (const key of ["tenant/app/poison", "tenant/app/recoverable"]) await storage.put(key, new Uint8Array([1]), { contentType: "text/plain" });
    const rows = await sql<{ logical_key: string; physical_key: string }[]>`
      update framekit_attachment_objects set state = 'deleting', checked_at = clock_timestamp() - interval '1 hour'
      where namespace = ${identity} and logical_key in ('tenant/app/poison', 'tenant/app/recoverable') returning logical_key, physical_key
    `;
    const poison = rows.find((row) => row.logical_key.endsWith("poison"))!;
    const originalSend = client.send.bind(client);
    vi.spyOn(client, "send").mockImplementation(async (command, options) => {
      if ((command as { input?: { Key?: string } }).input?.Key === poison.physical_key) throw new Error("poison");
      return originalSend(command, options);
    });
    await expect(storage.retryPendingDeletes(2)).rejects.toBeInstanceOf(AggregateError);
    vi.restoreAllMocks();
    await expect(storage.get("tenant/app/recoverable")).resolves.toBeUndefined();
    const [recovered] = await sql`select state from framekit_attachment_objects where namespace = ${identity} and logical_key = 'tenant/app/recoverable'`;
    expect(recovered?.state).toBe("deleted");
    const [checked] = await sql<{ checked_at: Date }[]>`select checked_at from framekit_attachment_objects where namespace = ${identity} and logical_key = 'tenant/app/poison'`;
    expect(checked!.checked_at.getTime()).toBeGreaterThan(Date.now() - 10_000);
    await expect(storage.retryPendingDeletes(1)).resolves.toBe(1);
  });

  it("rejects oversized uploads before creating records", async () => {
    const small = new S3AttachmentStorage({ ...options, maximumObjectBytes: 2 });
    await expect(small.put("tenant/app/oversized", new Uint8Array(3), { contentType: "text/plain" })).rejects.toMatchObject({ code: "ATTACHMENT_SIZE_LIMIT" });
    await expect(small.list("tenant/app/oversized")).resolves.toEqual([]);
  });
});

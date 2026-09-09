import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { FramekitError } from "@framekit/core";
import type { AttachmentStorage, RepositoryDiagnostics } from "@framekit/runtime";
import type { Sql } from "postgres";

export type S3AttachmentStorageOptions = {
  /** Both clients are borrowed; the application owns their shutdown. */
  sql: Sql;
  client: S3Client;
  bucket: string;
  namespace: string;
  prefix?: string;
  maximumObjectBytes?: number;
};
type ObjectRow = { logical_key: string; physical_key: string; revision: string; size: number };

export class S3AttachmentStorage implements AttachmentStorage {
  private readonly namespace: string;
  private readonly prefix: string;
  private readonly maximumObjectBytes: number;
  private closed = false;

  constructor(private readonly options: S3AttachmentStorageOptions) {
    if (!options.bucket || !options.namespace) throw new Error("Attachment bucket and namespace are required.");
    this.prefix = options.prefix ?? "framekit";
    if (!/^[A-Za-z0-9/_-]+$/.test(this.prefix) || this.prefix.endsWith("/")) throw new Error("Attachment prefix must be URL-safe without a trailing slash.");
    this.maximumObjectBytes = options.maximumObjectBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maximumObjectBytes) || this.maximumObjectBytes < 1 || this.maximumObjectBytes > 1024 * 1024 * 1024) throw new Error("Attachment size limit must be a positive integer no larger than 1 GiB.");
    this.namespace = JSON.stringify([options.namespace, options.bucket, this.prefix]);
  }

  async migrate(): Promise<void> {
    this.assertOpen();
    await this.options.sql`
      create table if not exists framekit_attachment_objects (
        namespace text not null, logical_key text not null, physical_key text not null,
        revision text not null, state text not null check (state in ('uploading', 'live', 'deleting', 'deleted')),
        size bigint not null, content_type text not null, lease_owner text, lease_expires_at timestamptz,
        created_at timestamptz not null default clock_timestamp(), checked_at timestamptz not null default clock_timestamp(),
        primary key (namespace, logical_key), unique (namespace, physical_key)
      )
    `;
  }

  async start(signal?: AbortSignal): Promise<void> {
    this.assertOpen();
    signal?.throwIfAborted();
    await this.options.sql`select 1 from framekit_attachment_objects limit 1`;
    await this.options.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }), { abortSignal: signal });
  }

  describe(): RepositoryDiagnostics {
    return { kind: "s3-postgres-attachments", durable: true, features: ["immutable-generations", "leases", "revision-snapshots", "conditional-delete", "deletion-repair"] };
  }
  async close(): Promise<void> { this.closed = true; }

  async put(key: string, bytes: Uint8Array, metadata: { contentType: string; lease?: { owner: string; durationMs: number } }): Promise<void> {
    this.assertOpen();
    if (!key || bytes.byteLength > this.maximumObjectBytes) throw new FramekitError("ATTACHMENT_SIZE_LIMIT", "Attachment exceeds the configured size limit or has an invalid key.", 422);
    if (metadata.lease && (!metadata.lease.owner || !Number.isSafeInteger(metadata.lease.durationMs) || metadata.lease.durationMs <= 0)) throw new Error("Attachment lease owner and positive duration are required.");
    const physicalKey = `${this.prefix}/objects/${crypto.randomUUID()}`;
    const revision = crypto.randomUUID();
    const rows = await this.options.sql`
      insert into framekit_attachment_objects (namespace, logical_key, physical_key, revision, state, size, content_type, lease_owner, lease_expires_at)
      values (${this.namespace}, ${key}, ${physicalKey}, ${revision}, 'uploading', ${bytes.byteLength}, ${metadata.contentType},
        ${metadata.lease?.owner ?? null}, case when ${Boolean(metadata.lease)} then clock_timestamp() + (${metadata.lease?.durationMs ?? 0} * interval '1 millisecond') else null end)
      on conflict (namespace, logical_key) do nothing returning logical_key
    `;
    if (!rows.length) throw new FramekitError("ATTACHMENT_KEY_EXISTS", "Attachment keys cannot be overwritten or reused.", 409);
    try {
      await this.options.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: physicalKey, Body: new Uint8Array(bytes), ContentType: metadata.contentType, IfNoneMatch: "*" }));
      const saved = await this.options.sql`
        update framekit_attachment_objects set state = 'live', revision = ${crypto.randomUUID()}
        where namespace = ${this.namespace} and logical_key = ${key} and revision = ${revision} and state = 'uploading' returning logical_key
      `;
      if (!saved.length) throw new FramekitError("ATTACHMENT_UPLOAD_CANCELLED", "Attachment upload was cancelled before completion.", 409);
    } catch (error) {
      // Retain the generation's tombstone when a remote response is ambiguous.
      await this.delete(key).catch(() => undefined);
      throw error;
    }
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    this.assertOpen();
    const [row] = await this.options.sql<ObjectRow[]>`
      select physical_key, size from framekit_attachment_objects where namespace = ${this.namespace} and logical_key = ${key} and state = 'live'
    `;
    if (!row) return undefined;
    const response = await this.options.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: row.physical_key }));
    if (!response.Body) throw this.corrupt();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > this.maximumObjectBytes || size > Number(row.size)) throw this.corrupt();
      chunks.push(chunk);
    }
    if (size !== Number(row.size)) throw this.corrupt();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }

  async list(prefix: string): Promise<string[]> {
    this.assertOpen();
    const rows = await this.options.sql<ObjectRow[]>`
      select logical_key from framekit_attachment_objects where namespace = ${this.namespace}
      and state = 'live' and left(logical_key, length(${prefix})) = ${prefix} order by logical_key
    `;
    return rows.map((row) => row.logical_key);
  }

  async listCleanupCandidates(prefix: string): Promise<Array<{ key: string; revision: string }>> {
    this.assertOpen();
    const rows = await this.options.sql<ObjectRow[]>`
      select logical_key, revision from framekit_attachment_objects where namespace = ${this.namespace}
      and state = 'live' and lease_owner is null and left(logical_key, length(${prefix})) = ${prefix} order by logical_key
    `;
    return rows.map((row) => ({ key: row.logical_key, revision: row.revision }));
  }

  async releaseLease(key: string, owner: string): Promise<void> {
    this.assertOpen();
    await this.options.sql`
      update framekit_attachment_objects set lease_owner = null, lease_expires_at = null, revision = ${crypto.randomUUID()}
      where namespace = ${this.namespace} and logical_key = ${key} and state = 'live' and lease_owner = ${owner}
    `;
  }

  async deleteIfUnleased(key: string, options: { minimumAgeMs: number; expectedRevision: string }): Promise<boolean> {
    this.assertOpen();
    if (!Number.isSafeInteger(options.minimumAgeMs) || options.minimumAgeMs < 0 || !options.expectedRevision) throw new Error("Conditional deletion requires a revision and a non-negative age.");
    const rows = await this.options.sql<ObjectRow[]>`
      update framekit_attachment_objects set state = 'deleting', revision = ${crypto.randomUUID()}
      where namespace = ${this.namespace} and logical_key = ${key} and revision = ${options.expectedRevision}
      and state = 'live' and lease_owner is null and created_at <= clock_timestamp() - (${options.minimumAgeMs} * interval '1 millisecond')
      returning logical_key, physical_key, revision
    `;
    if (!rows[0]) return false;
    await this.deleteGeneration(rows[0]);
    return true;
  }

  async delete(key: string): Promise<void> {
    this.assertOpen();
    const rows = await this.options.sql<ObjectRow[]>`
      update framekit_attachment_objects set state = 'deleting', revision = ${crypto.randomUUID()}
      where namespace = ${this.namespace} and logical_key = ${key} returning logical_key, physical_key, revision
    `;
    if (rows[0]) await this.deleteGeneration(rows[0]);
  }

  /** Tombstones are retained so an ambiguous upload response cannot lose its cleanup identity. */
  async retryPendingDeletes(limit = 100): Promise<number> {
    this.assertOpen();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Deletion repair limit must be between 1 and 1000.");
    const rows = await this.options.sql<ObjectRow[]>`
      select logical_key, physical_key, revision from framekit_attachment_objects where namespace = ${this.namespace}
      and state in ('deleting', 'deleted') order by checked_at, logical_key limit ${limit}
    `;
    const failures: unknown[] = [];
    for (const row of rows) {
      await this.options.sql`
        update framekit_attachment_objects set checked_at = clock_timestamp()
        where namespace = ${this.namespace} and logical_key = ${row.logical_key} and physical_key = ${row.physical_key}
        and revision = ${row.revision} and state in ('deleting', 'deleted')
      `;
      try {
        await this.deleteGeneration(row);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "One or more pending attachment deletions failed.");
    return rows.length;
  }

  private async deleteGeneration(row: ObjectRow): Promise<void> {
    await this.options.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: row.physical_key }));
    await this.options.sql`
      update framekit_attachment_objects set state = 'deleted', checked_at = clock_timestamp()
      where namespace = ${this.namespace} and logical_key = ${row.logical_key} and physical_key = ${row.physical_key}
      and revision = ${row.revision} and state in ('deleting', 'deleted')
    `;
  }
  private corrupt(): FramekitError { return new FramekitError("ATTACHMENT_STORAGE_CORRUPT", "Stored attachment bytes do not match their receipt.", 503); }
  private assertOpen(): void {
    if (this.closed) throw new FramekitError("ATTACHMENT_STORAGE_CLOSED", "Attachment storage is closed.", 503);
  }
}

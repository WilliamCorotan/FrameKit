# Production storage

`@framekit/storage` provides AES-256-GCM settings encryption and S3-compatible attachments backed by a PostgreSQL object registry. The CRM composes these adapters when configured. Applications using the runtime directly should set `deployment: "production"` and await `runtime.start()` before accepting requests. Startup rejects missing secret storage and any core adapter with missing or non-durable diagnostics. Diagnostics are an adapter contract; they do not independently certify a custom adapter.

## Settings keys and rotation

Supply `FRAMEKIT_SETTINGS_ACTIVE_KEY` and `FRAMEKIT_SETTINGS_KEYS`, a JSON object mapping key identifiers to canonical unpadded base64url strings containing 32 random bytes. Generate each key with a cryptographic random source; keep it in your platform's secret manager separately from `FRAMEKIT_AUTH_SECRET`. Never use the examples' test keys.

Values use a versioned authenticated envelope. Encryption binds the key identifier, application name, scope, and setting key, so ciphertext cannot be moved between settings or tenants. Plaintext must be valid Unicode and at most 1 MiB. Authentication failures return a generic error.

To rotate, deploy the old and new keys together with the new active identifier. New writes use the new key; old values remain readable. Rewrite existing secret settings through the authorized settings API, verify their envelopes use the new identifier, then retire the old key after the database backup retention period. Keep historical keys in the backup recovery secret store until all backups requiring them expire. Losing a key makes its ciphertext unrecoverable.

## Attachments and recovery

Provide a private bucket, `AWS_REGION`, and the standard AWS SDK credential chain (prefer workload identity). An optional `FRAMEKIT_S3_ENDPOINT` must be HTTPS in production. The adapter requires GetObject, PutObject, DeleteObject and bucket-head access; integration tests additionally create isolated buckets. Apply bucket encryption and access policy through infrastructure configuration. The default per-object limit is 16 MiB and can be configured up to 1 GiB; runtime/HTTP field limits may be lower.

`S3AttachmentStorage` borrows a PostgreSQL `sql` and an `S3Client`; the application closes both. Call `migrate()` before `start()`. Each upload attempt receives a unique logical key and immutable physical generation. The registry records upload ownership, revision snapshots, and deletion tombstones. Runtime orphan cleanup snapshots candidates before scanning document references and deletes only matching unleased revisions. Custom adapters must implement this snapshot/conditional-delete contract; cleanup fails closed otherwise.

Owned leases remain protected even after their time expires. Expiry alone cannot prove that a paused writer will never commit. Unknown transaction outcomes retain the object and its lease; a successful reference read permits release. For abandoned uploads, first stop and drain all writers, resolve outstanding database transactions, back up the registry and document references, then reconcile the exact generation against current references. Release its recorded owner only after that reconciliation, or explicitly delete it if no committed reference exists. Do not run an age-only bucket lifecycle rule against active attachment objects.

Schedule `retryPendingDeletes()` in an operating worker. It retries immutable generations, retains tombstones to recover delayed ambiguous remote writes, rotates failed attempts behind older pending work, and reports an AggregateError after processing the batch when any deletion fails. Alert on failures and queue growth. Tombstones are intentionally retained; pruning needs a provider-specific bound on outstanding writes and a separately verified retention procedure.

Back up the PostgreSQL registry and bucket together. Enable bucket versioning where available and test recovery of a matching database/object snapshot. A database-only restore does not restore attachment bytes. Restore the settings keyring alongside the database through a separate secure process.

## Connection ownership

`createPostgresConnection({ connectionString, max, listenerConnections, totalBudget })` creates a shared connection group with a total query capacity of `max` (at least two). Half the capacity, rounded up, serves raw SQL; the remainder serves Drizzle. Separate pools isolate Drizzle’s date/JSON codecs from raw transactions and attachment storage. Pass its `connection` to each Postgres adapter. Borrowing adapters do not close these pools; its owner calls `close()` once after all adapters finish. The budget checks declared capacity; applications must count every independently constructed listener/pool.

CRM defaults to ten query connections plus one dedicated realtime listener per process. Configure `FRAMEKIT_DB_POOL_MAX` and `FRAMEKIT_DB_CONNECTION_BUDGET`, multiplying the resulting per-process limit by API and worker replicas before sizing the database. Startup failures and Nitro shutdown close adapters before the shared pool. Production does not seed demo records, and bootstrap inserts only missing users and roles.

## Verification

`pnpm test:storage` requires `DATABASE_URL` and `FRAMEKIT_TEST_S3_ENDPOINT`; missing services fail the explicit command. It creates and removes an isolated test bucket and registry namespace. The default test credentials are fixture-only. CI runs these tests against Postgres 16 and 17 with the pinned S3-compatible fixture. This exercises the compatibility contract locally; validate bucket policies, TLS, credentials, and recovery with your deployed provider before release.

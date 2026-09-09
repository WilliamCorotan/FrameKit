# Deployment

Framekit apps use Nitro as the default host engine.

## Local Reference Stack

```bash
docker compose up --build
```

`docker-compose.yml` is a local/reference stack, not a production deployment template. It includes the Nitro API, Postgres, and Redis; Postgres and Redis publish only to `127.0.0.1`. The local password defaults to `framekit`.

To override the local password, set this pair together:

```bash
FRAMEKIT_POSTGRES_PASSWORD='p@:/#ss'
FRAMEKIT_POSTGRES_URL='postgresql://framekit:p%40%3A%2F%23ss@postgres:5432/framekit'
```

`FRAMEKIT_POSTGRES_PASSWORD` is passed to Postgres unchanged. `FRAMEKIT_POSTGRES_URL` is passed as the CRM's `DATABASE_URL`; its password component must be percent-encoded as a URI user-info value. Compose does not URL-encode interpolated values, so never interpolate the raw password into a connection URL. When `DATABASE_URL` is set, the CRM example uses durable Postgres stores for documents, users, audit events, outbox events, custom fields, views, and naming series.

Do not deploy the bundled Postgres or Redis services to production. Provision a private network or managed Postgres and Redis service, create distinct least-privilege runtime credentials, supply them through the deployment platform's secret manager, and set `DATABASE_URL` and `REDIS_URL` accordingly. Do not reuse the Compose password default or expose either data service on a public interface.

Required production storage configuration and recovery details are in [Production storage](storage.md). The CRM now rejects missing database, settings keyring, or S3 configuration when `NODE_ENV=production`; the reference Compose stack requires an externally provisioned private bucket.

Recommended production environment:

- `DATABASE_URL`: Postgres connection string for document, auth, audit, customization, naming series, migration, and outbox stores.
- `FRAMEKIT_SETTINGS_ACTIVE_KEY` and `FRAMEKIT_SETTINGS_KEYS`: active key ID and encryption keyring supplied by the secret manager.
- `FRAMEKIT_S3_BUCKET` and `AWS_REGION`: private attachment bucket; optionally `FRAMEKIT_S3_ENDPOINT` for an HTTPS-compatible provider.
- `FRAMEKIT_DB_POOL_MAX` and `FRAMEKIT_DB_CONNECTION_BUDGET`: per-process pool size and total query/listener budget (defaults 10 and 11).
- `REDIS_URL`: Redis connection string for BullMQ-backed queues.
- `FRAMEKIT_AUTH_SECRET`: at least 32 characters from a cryptographically random source, used to sign sessions.
- `FRAMEKIT_ADMIN_EMAIL` and `FRAMEKIT_ADMIN_PASSWORD`: explicitly provisioned initial CRM admin credentials; example values are rejected.
- `FRAMEKIT_ALLOWED_ORIGINS`: exact comma-separated HTTPS origins allowed to make credentialed browser requests.
- `FRAMEKIT_COOKIE_SAME_SITE`: `lax` by default; use `none` only for an HTTPS cross-site Desk deployment.
- `FRAMEKIT_TRUST_PROXY`: keep `false` unless a trusted proxy sanitizes and replaces forwarded host/protocol headers.
- `NITRO_PRESET=node-server`: Node container output.

Start from `.env.production.example` and supply its blank secret values through your deployment platform. The root `.env.example` contains development-only credentials and must not be promoted to production. The local/reference `docker-compose.yml` refuses to start until the required application credentials and origin allowlist are provided.

Run `pnpm audit:all` before building the image. For durable deployments, run the app once with Postgres connectivity so store `migrate()` calls can create or update framework tables.

## Postgres

The Postgres adapter stores framework records in JSON/document tables plus dedicated tables for users, roles, API tokens, session revocations, audit events, outbox events, custom fields, views, naming series, and migration history.

Operational expectations:

- Back up the database before applying destructive migration plans.
- Keep `framekit_migrations.checksum` values intact; apply rejects tampered plans.
- Establish the hardened migration baseline and legacy uniqueness reservations using the [executable migration upgrade procedure](migrations.md) before enabling the new write path.
- Supply the independently reviewed tenant and app identity to migration CLI commands with `--tenant-id` and `--app-name`; do not derive operator context from an artifact.
- Use database-level monitoring for connection saturation and slow queries.
- Prefer one database role for application runtime and a separate elevated role for manual maintenance.

## Redis And Queues

BullMQ-backed jobs require Redis. Keep Redis private to the deployment network and monitor queue latency, failed job counts, and retry depth. Server processes should treat outbox dispatch and queue workers as separately scalable workloads.

## Secret and attachment storage adapters

Framekit supplies `@framekit/storage` with authenticated AES-GCM settings encryption, historical-key rotation, and PostgreSQL/S3 attachment generations with atomic leases and conditional cleanup. Configure the keyring and private bucket as described in [storage](storage.md). Operators still own credential provisioning, key backup/rotation, bucket policy and the paired database/object backup chain. Custom adapters must honor the same failure and cleanup contracts; memory adapters are development-only.

## Serverless And Edge

Set `NITRO_PRESET` for the target platform supported by Nitro. Keep long-running work behind the queue/outbox ports; serverless runtimes should process outbox events through a scheduled function or managed queue.

Serverless constraints:

- Do not rely on in-memory repositories, event history, rate-limit buckets, or session revocation stores across invocations.
- Use Postgres-backed stores for durable framework state.
- Use managed Redis or provider-native queues for background work.
- Configure `/health/dependencies` checks only for dependencies reachable from the runtime.

## Required Checks

Every release candidate should pass:

```bash
pnpm audit:all
```

Add service-backed smoke checks for Postgres, Redis, and the built Nitro server before promoting a release candidate.

See [Deployment Security](security.md) for the threat model, cookie/CSRF behavior, CORS rules, proxy trust boundary, and production checklist.

## Operations qualification

After building packages, run `DATABASE_URL=... pnpm verify:operations` against a disposable database. It uses a random tenant and removes only that tenant's probe records. It verifies restart idempotency, competing revision fences, concurrent create/replay/update/read cycles, and final persisted counts. The default is 30 seconds, eight workers and four total raw/ORM query connections. Set `FRAMEKIT_SOAK_SECONDS` (up to 86400), `FRAMEKIT_SOAK_CONCURRENCY`, and `FRAMEKIT_DB_POOL_MAX` to exercise your deployment profile. The bounded latency sample and results are written to `.release/operations.json`, or `FRAMEKIT_OPERATIONS_REPORT`.

This is a runtime/Postgres component probe. It does not establish an HTTP capacity limit, a failover guarantee, or a production SLO. Run a longer soak and an HTTP workload representative of your data, permissions and attachments on the candidate deployment. Define acceptable latency, error rate, recovery time and data-loss objectives before interpreting the results.

Operational runbooks must cover these events:

- **Database interruption:** stop admitting writes when readiness fails, preserve mutation idempotency keys, reconnect, and verify the stored outcome before retrying an ambiguous operation. Do not assume a lost response means rollback.
- **Queue or dispatcher interruption:** let leases expire and another owner claim work; preserve event/job IDs in downstream idempotency handling. Inspect dead letters before requeueing. Retry only after fixing the cause, with bounded attempts and backoff.
- **Attachment service interruption:** preserve immutable generation tombstones and owned upload leases; run deletion repair and follow the quiesced reconciliation procedure in [storage](storage.md).
- **Restore:** restore the database, matching bucket contents and historical settings keys to an isolated environment first. Validate record counts, references, secret resolution, tenant separation, and idempotency receipts before switching traffic. Replaying an outbox after restore can repeat external effects, so downstream deduplication state must cover the restored interval.
- **Retention:** choose audit, outbox, idempotency and object-tombstone retention from your recovery window and obligations. Do not delete active leases or idempotency receipts while callers may retry. Alert on pending-age, dead-letter count, attachment repair failures, pool saturation and failed readiness.

`pnpm verify:recovery` performs an isolated PostgreSQL custom-format dump/restore plus object-byte and historical-key recovery. It requires `pg_dump`/`pg_restore` at least as new as the test server, a disposable `DATABASE_URL` role allowed to create databases, and `FRAMEKIT_TEST_S3_ENDPOINT` with fixture bucket permissions. The command creates two randomly named databases and one bucket, removes/restores the fixture object, verifies restored data and tenant isolation, then cleans up only those fixtures. It never restores over the supplied database. A passing fixture drill does not replace recovery testing of your production backup chain.

### Expired authentication records

Schedule bounded batches of `PostgresAuthLifecycleTokenStore.pruneExpired(limit)` and `PostgresOidcAuthorizationStateStore.pruneExpired(limit)` and `PostgresMfaStore.pruneExpiredAttempts(limit)` on the administrative worker. Limits default to 1,000 and must be 1–10,000. Database-clock expiration and `SKIP LOCKED` permit concurrent cleaners without deleting live records. MFA factors and disabled-factor session-version tombstones are never pruned by these APIs. Retain saga receipts, mutation receipts, and audit records until an explicit application retention policy makes replay expiry acceptable.

### Process crash probe

After building packages, run `DATABASE_URL=<disposable-postgres> pnpm verify:crash`. The harness starts its own child processes, kills them with SIGKILL after a runtime commit and inside an uncommitted transaction, and checks durable receipt replay and transaction rollback. It removes only its randomly named tenant data. This complements `verify:operations` and `verify:recovery`; it does not certify database failover, regional recovery, or application HTTP capacity.

### Node server request and shutdown bounds

The generated server and CRM bridge cap request bodies at 16 MiB by default (`FRAMEKIT_MAX_REQUEST_BYTES`, positive safe integer bytes) and return 413 before passing oversized content to Nitro. Responses stream with backpressure, including SSE; client disconnects abort the adapter request and response stream. Shutdown aborts active requests and closes adapter resources, with a five-second deadline (`FRAMEKIT_SHUTDOWN_TIMEOUT_MS`, 1–60,000 milliseconds); an exceeded deadline exits non-zero. Account for encoded attachment size when choosing a request limit. Configure matching limits and timeouts at the reverse proxy.

Framework bootstrap `migrate()` calls coordinate with a database-scoped transaction advisory lock, including the S3 attachment registry. Each call uses one connection for the lock and its DDL, preventing concurrent replicas from racing PostgreSQL catalog creation. Keep the documented document-before-mutation initialization order. Application migration planning/apply retains its separate approval and locking contract.

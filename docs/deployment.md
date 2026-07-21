# Deployment

Framekit apps use Nitro as the default host engine.

## Node Container

```bash
docker compose up --build
```

The full example stack includes the Nitro API, Postgres, and Redis. When `DATABASE_URL` is set, the CRM example uses durable Postgres stores for documents, users, audit events, outbox events, custom fields, views, and naming series.

Recommended production environment:

- `DATABASE_URL`: Postgres connection string for document, auth, audit, customization, naming series, migration, and outbox stores.
- `REDIS_URL`: Redis connection string for BullMQ-backed queues.
- `FRAMEKIT_AUTH_SECRET`: at least 32 characters from a cryptographically random source, used to sign sessions.
- `FRAMEKIT_ADMIN_EMAIL` and `FRAMEKIT_ADMIN_PASSWORD`: explicitly provisioned initial CRM admin credentials; example values are rejected.
- `FRAMEKIT_ALLOWED_ORIGINS`: exact comma-separated HTTPS origins allowed to make credentialed browser requests.
- `FRAMEKIT_COOKIE_SAME_SITE`: `lax` by default; use `none` only for an HTTPS cross-site Desk deployment.
- `FRAMEKIT_TRUST_PROXY`: keep `false` unless a trusted proxy sanitizes and replaces forwarded host/protocol headers.
- `NITRO_PRESET=node-server`: Node container output.

Start from `.env.production.example` and supply its blank secret values through your deployment platform. The root `.env.example` contains development-only credentials and must not be promoted to production. `docker-compose.yml` refuses to start until the production credentials and origin allowlist are provided.

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

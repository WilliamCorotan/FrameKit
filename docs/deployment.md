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
- `FRAMEKIT_AUTH_SECRET`: high-entropy secret used to sign sessions.
- `FRAMEKIT_ADMIN_EMAIL` and `FRAMEKIT_ADMIN_PASSWORD`: initial CRM admin seed credentials.
- `NITRO_PRESET=node-server`: Node container output.

Run `pnpm audit:all` before building the image. For durable deployments, run the app once with Postgres connectivity so store `migrate()` calls can create or update framework tables.

## Postgres

The Postgres adapter stores framework records in JSON/document tables plus dedicated tables for users, roles, API tokens, session revocations, audit events, outbox events, custom fields, views, naming series, and migration history.

Operational expectations:

- Back up the database before applying destructive migration plans.
- Keep `framekit_migrations.checksum` values intact; apply rejects tampered plans.
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

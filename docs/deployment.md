# Deployment

Framekit apps use Nitro as the default host engine.

## Node Container

```bash
docker compose up --build
```

The full example stack includes the Nitro API, Postgres, and Redis. When `DATABASE_URL` is set, the CRM example uses durable Postgres stores for documents, users, audit events, outbox events, custom fields, views, and naming series.

## Serverless And Edge

Set `NITRO_PRESET` for the target platform supported by Nitro. Keep long-running work behind the queue/outbox ports; serverless runtimes should process outbox events through a scheduled function or managed queue.

## Required Checks

Every release candidate should pass:

```bash
pnpm typecheck
pnpm test
pnpm build
```

# [WIP] Framekit

Framekit is a TypeScript meta-framework inspired by Frappe. It lets you build metadata-driven business applications with DocTypes, modules, permissions, workflows, hooks, generated APIs, customization, audit trails, outbox events, realtime publishing, a Desk UI, and portable Nitro deployment.

Nitro is the default host engine, but the framework core does not depend on Nitro, React, Drizzle, Redis, BullMQ, or Postgres. Those live behind adapter ports so applications can run in Node containers first and later target serverless or edge-style platforms where appropriate.

## What Is Included

- Metadata-defined DocTypes and modules.
- Generated CRUD, workflow, metadata, customization, audit, outbox, diagnostics, auth, and OpenAPI endpoints.
- Password auth with signed session tokens.
- Tenant-aware permissions and Bearer-token context resolution.
- In-memory development stores and durable Postgres stores.
- Custom fields, view metadata, and naming series.
- Audit log and durable outbox with worker dispatch helpers.
- Realtime document event publishing.
- React Desk UI generated from metadata.
- Typed SDK, CLI scaffolding, Docker Compose, CI, and deployment docs.

## Quick Start

```bash
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install
pnpm dev
```

The CRM example API runs at:

```txt
http://localhost:3000
```

Run the Desk UI in another terminal:

```bash
pnpm dev:desk
```

The Desk usually runs at `http://localhost:5173`. If that port is occupied, Vite will choose the next available port.

Default CRM login:

```json
{ "email": "admin@example.com", "password": "admin12345" }
```

## Useful Commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm audit:all
pnpm --filter @framekit/example-crm outbox:dispatch
pnpm --filter @framekit/cli framekit create-app alpha-suite
pnpm --filter @framekit/cli framekit new-module sales
pnpm --filter @framekit/cli framekit new-doctype sales-order
pnpm --filter @framekit/cli framekit generate-sdk examples/crm/src/app.ts
pnpm --filter @framekit/cli framekit generate-migration examples/crm/src/app.ts examples/crm/src/app.ts
```

## API Overview

System and contracts:

```txt
GET  /health
GET  /health/dependencies
GET  /api/meta
GET  /api/diagnostics
GET  /api/migrations
POST /api/migrations/plan
POST /api/migrations/apply
GET  /api/realtime/events
GET  /api/realtime/stream
GET  /api/openapi.json
```

Auth:

```txt
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/refresh
POST /api/auth/logout
POST /api/auth/password/change
POST /api/auth/providers/{id}/login
GET  /api/auth/audit
GET  /api/auth/users
POST /api/auth/users
PATCH /api/auth/users/{id}
DELETE /api/auth/users/{id}
POST /api/auth/users/{id}/password
GET  /api/auth/roles
POST /api/auth/roles
PATCH /api/auth/roles/{id}
DELETE /api/auth/roles/{id}
GET  /api/auth/tokens
POST /api/auth/tokens
DELETE /api/auth/tokens/{id}
```

Documents:

```txt
GET    /api/doctypes/{doctype}
POST   /api/doctypes/{doctype}
GET    /api/doctypes/{doctype}/{id}
PATCH  /api/doctypes/{doctype}/{id}
DELETE /api/doctypes/{doctype}/{id}
POST   /api/doctypes/{doctype}/{id}/transition
```

Framework records:

```txt
GET  /api/audit
GET  /api/outbox
POST /api/outbox/{id}/dispatch
POST /api/outbox/{id}/fail
```

Customization:

```txt
GET  /api/custom-fields
POST /api/custom-fields
GET  /api/views
POST /api/views
```

Example login and authenticated request:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"admin12345"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).token))')

curl -s http://localhost:3000/api/doctypes/customer \
  -H "authorization: Bearer $TOKEN"
```

## Core Concepts

`DocType` is the primary metadata unit. It defines fields, permissions, naming, workflows, indexes, and views for a business document.

```ts
import { defineDocType } from "@framekit/core";

export const deal = defineDocType({
  name: "deal",
  label: "Deal",
  naming: { prefix: "DEAL", series: true, digits: 5 },
  fields: [
    { name: "title", label: "Title", type: "text", required: true, inList: true },
    { name: "amount", label: "Amount", type: "currency", default: 0, inList: true }
  ],
  permissions: [
    { action: "create", permissions: ["crm.deal.write"] },
    { action: "read", permissions: ["crm.deal.read"] }
  ]
});
```

`Module` groups DocTypes, permissions, navigation, hooks, jobs, settings, and dependencies.

`Runtime` executes framework use cases: validation, permissions, hooks, document persistence, audit, outbox, realtime publishing, custom fields, views, and naming series.

`Nitro adapter` exposes the runtime through generated HTTP routes.

## Package Map

| Package | Purpose |
| --- | --- |
| `@framekit/core` | Pure metadata definitions: DocTypes, modules, apps, permissions, workflows, views. |
| `@framekit/runtime` | Application services and ports for documents, audit, outbox, customization, naming, realtime, and migration planning. |
| `@framekit/auth` | Password hashing, signed sessions, refresh/logout, revocation, lockout, API tokens, auth audit, and provider login ports. |
| `@framekit/nitro` | Nitro/H3 adapter for generated framework APIs, operations headers, rate limiting, telemetry hooks, and health checks. |
| `@framekit/openapi` | OpenAPI 3.1 generator from Framekit metadata. |
| `@framekit/db` | Postgres adapters for documents, users, audit, outbox, custom fields, views, naming series. |
| `@framekit/jobs` | Queue port, BullMQ adapter, outbox dispatcher, scheduled job registry. |
| `@framekit/realtime` | Event bus contract and in-memory publisher/subscriber. |
| `@framekit/sdk` | HTTP client for auth, metadata, documents, audit, outbox, customization, views, migrations, realtime, and admin APIs. |
| `@framekit/cli` | App/module/DocType scaffolding, generated SDK types, and generated migration artifacts. |
| `@framekit/desk` | React Desk UI generated from metadata. |

## Repository Layout

```txt
apps/desk          React metadata-driven admin UI
examples/crm       Nitro CRM example app
packages/*         Framework packages
docs/              Architecture, deployment, and roadmap docs
```

## Deployment

The default production target is a Nitro Node server with Postgres and Redis:

```bash
docker compose up --build
```

When `DATABASE_URL` is set, the CRM example uses Postgres for:

- Documents
- Users
- Audit events
- Outbox events
- Custom fields
- View metadata
- Naming series

Nitro can also emit provider-specific outputs through `NITRO_PRESET`. Keep long-running work behind queue/outbox ports for serverless deployments.

See [docs/deployment.md](docs/deployment.md).

## Environment

Copy `.env.example` when running a durable deployment:

```bash
cp .env.example .env
```

Important variables:

```txt
DATABASE_URL=postgresql://framekit:framekit@localhost:5432/framekit
REDIS_URL=redis://localhost:6379
FRAMEKIT_AUTH_SECRET=replace-with-at-least-16-characters
FRAMEKIT_ADMIN_EMAIL=admin@example.com
FRAMEKIT_ADMIN_PASSWORD=admin12345
VITE_FRAMEKIT_API_URL=http://localhost:3000
```

## Creating A New App

```bash
pnpm --filter @framekit/cli framekit create-app alpha-suite
```

The scaffold includes:

- `package.json`
- `nitro.config.ts`
- `routes/[...].ts`
- `src/app.ts`
- `.env.example`
- `Dockerfile`
- A starter `Note` DocType

## Verification

Every iteration should pass:

```bash
pnpm audit:all
```

Current verification status:

- Full audit passes: lint, typecheck, tests, and build.
- Test suite passes: 9 files, 44 tests.
- Production build passes for packages, Desk, and CRM example.
- In-process Nitro smoke covers auth lifecycle, provider login, OpenAPI, diagnostics, document CRUD, uniqueness, filters, cursor/projection, auth admin, password reset/change, customization, migrations, outbox, realtime history, and security/operations headers.

## Architecture

Framekit follows a clean architecture boundary:

- `core` and `runtime` are inward modules.
- Nitro, React, Postgres, Redis, BullMQ, and Docker are outer adapters.
- Source dependencies point inward.
- Framework details are swappable behind ports.

Current clean architecture score: about `8.5/10`. The remaining gaps are mostly release hardening and broader adapter coverage, not core dependency direction.

See [docs/architecture.md](docs/architecture.md).

## Roadmap Status

The current local framework core is largely implemented. Remaining release-candidate work is tracked in [docs/maturity-roadmap.md](docs/maturity-roadmap.md) and GitHub Issues.

## License

No license has been selected yet.

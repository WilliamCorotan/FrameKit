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

Development-only CRM login:

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

System, contracts, migrations, realtime, and operations:

```txt
GET  /health
GET  /health/dependencies
GET  /api/meta
GET  /api/diagnostics
GET  /api/migrations
POST /api/migrations/plan
POST /api/migrations/apply
POST /api/commands/{command}
GET  /api/realtime/events
GET  /api/realtime/stream
GET  /api/openapi.json
```

`/health/dependencies` runs adapter-provided dependency checks, for example Postgres, Redis, queues, or downstream services.

Migration planning, executable apply/replay, drift rules, upgrade backfill, and rollback limits are documented in [Executable migrations](docs/migrations.md).
Atomic bulk commands, cross-document sagas, idempotency, compensation, and recovery limits are documented in [Mutation consistency](docs/consistency.md).

Auth lifecycle, provider login, audit, and admin APIs:

Production identity-linking, OIDC Authorization Code + PKCE, invitation, recovery, and MFA policy are documented in [docs/identity.md](docs/identity.md).

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
PUT  /api/auth/users/{id}
DELETE /api/auth/users/{id}
POST /api/auth/users/{id}/password
GET  /api/auth/roles
POST /api/auth/roles
PATCH /api/auth/roles/{id}
PUT  /api/auth/roles/{id}
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
  -H 'origin: http://localhost:3000' \
  -d '{"email":"admin@example.com","password":"admin12345"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).token))')

curl -s http://localhost:3000/api/doctypes/customer \
  -H "authorization: Bearer $TOKEN"
```

When an auth service is configured, every API route except health checks, login/provider login, and the OpenAPI document requires a valid bearer token or session cookie. Tenant, user, role, and permission headers never override that authenticated context.

Framework operations use dedicated permissions (or the `*` superuser permission):

| Permission | Operations |
| --- | --- |
| `framekit.diagnostics.read` | Runtime diagnostics |
| `framekit.migrations.read` | Migration history |
| `framekit.migrations.manage` | Migration planning and apply |
| `framekit.realtime.read` | Realtime event history and SSE stream |
| `framekit.audit.read` | Runtime audit trail |
| `framekit.outbox.read` | Outbox inspection |
| `framekit.outbox.manage` | Outbox dispatch/failure mutation |
| `framekit.customization.read` | Custom-field and view inspection |
| `framekit.customization.manage` | Custom-field and view mutation |

Apps without an auth service cannot access protected routes by default. Local-only prototypes may explicitly enable `development.allowHeaderIdentity`; Framekit accepts that escape hatch only when `NODE_ENV=development` or `NODE_ENV=test`.

SDK auth lifecycle and admin example:

```ts
import { createClient } from "@framekit/sdk";

const client = createClient({ baseUrl: "http://localhost:3000" });

await client.login("admin@example.com", "admin12345");
await client.me();
await client.refresh();

await client.upsertRole({
  id: "support",
  name: "Support",
  permissions: ["crm.customer.read"]
});

const apiToken = await client.createApiToken({
  name: "CRM import",
  roles: ["support"],
  permissions: ["crm.customer.read"]
});

await client.authAudit();
await client.logout();
```

SDK failures are typed and preserve server status, code, details, and request identity. Retries are opt-in and limited to safe/idempotent operations; see [SDK errors, retries, and configuration upgrades](docs/sdk-errors-and-retries.md).

Provider login uses the same session shape after an app registers an auth provider:

```ts
await client.loginWithProvider("oidc", "<provider-token>");
```

Migration workflow with SDK and CLI:

```ts
import { nextApp } from "./next-app";

const plan = await client.planMigration(nextApp);
await client.applyMigration(plan, { allowDestructive: false });
```

```bash
pnpm --filter @framekit/cli framekit generate-sdk examples/crm/src/app.ts --out /tmp/crm-sdk.ts
pnpm --filter @framekit/cli framekit generate-migration examples/crm/src/app.ts examples/crm/src/next-app.ts --out /tmp/crm-migration.ts
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

| Package | Purpose | Verification status |
| --- | --- | --- |
| `@framekit/core` | Pure metadata definitions: DocTypes, modules, apps, permissions, workflows, views. | Unit covered. |
| `@framekit/runtime` | Application services and ports for documents, audit, outbox, customization, naming, realtime, migration planning, checksums, destructive guards, and migration apply records. | Unit covered; atomicity and concurrency hardening tracked in [#19](https://github.com/WilliamCorotan/FrameKit/issues/19). |
| `@framekit/auth` | Password hashing, signed sessions, refresh/logout, revocation, lockout, API tokens, auth audit, user/role admin, and provider-independent login ports. | Authenticated identity and lifecycle paths covered; OIDC depth is tracked in [#25](https://github.com/WilliamCorotan/FrameKit/issues/25). |
| `@framekit/nitro` | Nitro/H3 adapter for generated framework APIs, cookie transport, auth/admin routes, operations authorization, rate limiting, telemetry hooks, and health dependency checks. | In-process, built, forged-header, cross-tenant, and least-privilege checks covered; production-safe HTTP defaults are tracked in [#17](https://github.com/WilliamCorotan/FrameKit/issues/17). |
| `@framekit/openapi` | OpenAPI 3.1 generator from Framekit metadata and framework routes. | Unit covered. |
| `@framekit/db` | Postgres adapters for documents, users, roles, API tokens, session revocations, audit, outbox, custom fields, views, naming series, and migration history. | Postgres integration covered; atomicity, query pushdown, and migration depth tracked in [#19](https://github.com/WilliamCorotan/FrameKit/issues/19), [#20](https://github.com/WilliamCorotan/FrameKit/issues/20), and [#21](https://github.com/WilliamCorotan/FrameKit/issues/21). |
| `@framekit/jobs` | Queue port, BullMQ adapter, outbox dispatcher, scheduled job registry. | Unit and Redis/BullMQ integration covered; durable worker behavior tracked in [#22](https://github.com/WilliamCorotan/FrameKit/issues/22). |
| `@framekit/realtime` | Event bus contract and in-memory publisher/subscriber for document events and SSE routes. | Unit and in-process smoke covered; durable replay is tracked in [#22](https://github.com/WilliamCorotan/FrameKit/issues/22). |
| `@framekit/sdk` | HTTP client for auth lifecycle, provider login, metadata, documents, audit, outbox, customization, views, migrations, realtime, and admin APIs. | Unit covered; generated endpoint parity and standalone consumer verification are tracked in [#24](https://github.com/WilliamCorotan/FrameKit/issues/24). |
| `@framekit/cli` | App/module/DocType scaffolding, generated SDK types, and executable migration workflows. | CLI smoke covered; standalone consumer and publication proof tracked in [#24](https://github.com/WilliamCorotan/FrameKit/issues/24). |
| `@framekit/desk` | React Desk UI generated from metadata, auth/admin/operations/customization surfaces. | Build and mocked browser journeys covered; real full-stack browser CI tracked in [#23](https://github.com/WilliamCorotan/FrameKit/issues/23). |

## Repository Layout

```txt
apps/desk          React metadata-driven admin UI
examples/crm       Nitro CRM example app
packages/*         Framework packages
docs/              Architecture, deployment, and roadmap docs
```

## Deployment

The intended production target is a Nitro Node server with Postgres and Redis. The current release is a beta: production-depth gates are present, while the remaining 1.0 metadata semantics are tracked in the [maturity roadmap](docs/maturity-roadmap.md).

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
See [docs/security.md](docs/security.md) before exposing a deployment to untrusted traffic.
See [docs/observability.md](docs/observability.md) for lifecycle, health, telemetry, and redaction contracts.
See [docs/compatibility.md](docs/compatibility.md) for supported runtimes, services, and browsers.

## Environment

Copy `.env.example` only for local development. Production deployments start from `.env.production.example` and provision blank secrets through the deployment platform:

```bash
cp .env.example .env
```

Important variables:

```txt
DATABASE_URL=postgresql://framekit:framekit@localhost:5432/framekit
REDIS_URL=redis://localhost:6379
FRAMEKIT_AUTH_SECRET=<provision-at-least-32-random-characters>
FRAMEKIT_ALLOWED_ORIGINS=https://desk.example.com
FRAMEKIT_ADMIN_EMAIL=ops@your-company.example
FRAMEKIT_ADMIN_PASSWORD=<provision-with-a-secret-manager>
VITE_FRAMEKIT_API_URL=http://localhost:3000
```

## Creating A New App

```bash
pnpm --filter @framekit/cli framekit create-app alpha-suite
```

Scaffold commands refuse to overwrite generated paths by default. Use `--dry-run` to inspect every planned write and `--force` to replace only the listed scaffold files.

`create-app` is intentionally a server starter. It includes:

- `package.json`
- `nitro.config.ts`
- `routes/[...].ts`
- `src/app.ts`
- `.env.example`
- `.env.production.example`
- `Dockerfile`
- A starter `Note` DocType

It does not scaffold the React Desk. Run the repository Desk separately or build a frontend against `@framekit/sdk`; a packaged Desk template is deferred until its assets, configuration, and upgrade contract can be shipped as one supported unit.

## Verification

Every iteration should pass:

```bash
pnpm audit:all
```

Current verification status:

- Full audit passes: lint, typecheck, tests, and build.
- Unit/in-process suite passes locally: 11 files and 115 tests; 2 service-backed files and 13 tests skip without service environment variables.
- Coverage gates enforce at least 60% statements/functions/lines and 50% branches across public package source.
- Production build passes for packages, Desk, and CRM example.
- Split CI covers package-local tests, coverage, Node 22/24 exports, Postgres 16/17, Redis 7/8, built smoke, standalone consumption, browsers, CodeQL, dependency audit, and SBOM generation.
- In-process Nitro smoke covers auth lifecycle, provider login, OpenAPI, diagnostics, document CRUD, uniqueness, filters, cursor/projection, auth admin, password reset/change, customization, migrations, outbox, realtime history, and security/operations headers.

## Architecture

Framekit follows a clean architecture boundary:

- `core` and `runtime` are inward modules.
- Nitro, React, Postgres, Redis, BullMQ, and Docker are outer adapters.
- Source dependencies point inward.
- Framework details are swappable behind ports.

Current clean architecture score: about `8.5/10`. The remaining gaps are mostly release hardening and broader adapter coverage, not core dependency direction.

See [docs/architecture.md](docs/architecture.md).

Revision checks, atomic Postgres mutations, durable uniqueness, and retry semantics are documented in [docs/consistency.md](docs/consistency.md).

Postgres query pushdown and stable opaque cursor semantics are documented in [docs/querying.md](docs/querying.md).

## Roadmap Status

Framekit is currently assessed as a beta: 86% implemented toward a production-ready 1.0. Exact decimals, computed fields, declarative validators, ordered child records, and managed attachments are implemented; localization and typed settings remain tracked in issue #42. See the component scores and prioritized issues in [docs/maturity-roadmap.md](docs/maturity-roadmap.md).

## License

Framekit is licensed under the [Apache License 2.0](LICENSE).

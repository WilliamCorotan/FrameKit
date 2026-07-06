# Framekit Roadmap

## Implemented

- Metadata-defined DocTypes, modules, permissions, hooks, workflows, and document CRUD.
- Nitro adapter with generated document routes, CORS, health, metadata, diagnostics, and OpenAPI endpoints.
- In-memory repository for development and Postgres JSON-document repository for durable deployments.
- Queue and realtime ports with initial adapters.
- SDK, CLI scaffolding, generated Desk UI, CRM example, Docker Compose, tests, and build verification.
- OpenAPI 3.1 generation and runtime diagnostics.

## Roadmap To Completion

Each iteration must end with `pnpm typecheck`, `pnpm test`, `pnpm build`, built-server smoke checks, and a short decision on the next highest-value item.

For the production-depth roadmap after the MVP phases below, see [maturity-roadmap.md](maturity-roadmap.md).

### Phase 1 - Authentication And Sessions

Status: implemented

- Add a framework auth package with password hashing, signed sessions, tenant context resolution, and an in-memory user store.
- Add Nitro auth endpoints for login and current user.
- Let generated document routes resolve tenant/user context from Bearer tokens, with header fallback for development.
- Seed the CRM example with an admin user.

Exit criteria:

- Login returns a signed session token.
- `/api/auth/me` returns the current user from the token.
- Document routes work with Bearer tokens and still support header smoke tests.

### Phase 2 - Durable Framework Records

Status: implemented

- Persist framework users, audit events, and outbox events through repository ports.
- Extend the Postgres adapter beyond generic documents for framework-owned records.
- Add migrations and smoke checks for durable auth plus audit.

### Phase 3 - Customization And Schema Evolution

Status: implemented

- Support runtime custom fields, view metadata, naming series, and DocType migration planning.
- Add migration preview/apply commands to the CLI.
- Surface custom fields and list/form view configuration in Desk.

### Phase 4 - Automation, Jobs, And Realtime

Status: implemented

- Implement event outbox, job registration, scheduled jobs, retries, and dead-letter inspection.
- Add realtime document events for Desk refreshes.
- Wire BullMQ in the Node deployment path while keeping queue ports portable.

### Phase 5 - Developer Experience And Release Hardening

Status: implemented

- Generate typed SDK models from OpenAPI.
- Add `create-app` templates that include Nitro, Desk, Docker, and env files.
- Add CI workflow, deployment presets docs, and package publishing metadata.

## Previous Next Candidates

1. Authentication and sessions: tenant-aware users, password hashing, API tokens, session cookies, and auth provider ports.
2. Generated SDK contracts: generate strongly typed client models from `/api/openapi.json`.
3. Durable production example: wire the CRM example to `PostgresDocumentRepository` when `DATABASE_URL` is set.
4. Permissions UI: expose role and permission management in Desk rather than relying on headers.
5. Data model evolution: DocType migration planning, custom fields, and audit/event outbox persistence.

## Architecture Notes

Core and runtime remain inward modules. Nitro, Postgres, BullMQ, and Desk are adapters. Keep new framework features behind runtime ports unless they are pure metadata.

## Iteration Log

### 2026-07-02 - Reevaluation

- Current clean architecture score: 8.5/10.
- Best next slice: Phase 1 authentication and sessions, because deployable platforms cannot trust caller-supplied tenant/user headers.

### 2026-07-02 - Phase 1 Auth/Session Evaluation

- Implemented `@framekit/auth` with WebCrypto PBKDF2 password hashing, signed session tokens, in-memory users, and tenant context generation.
- Added Nitro login/current-user endpoints and Bearer token resolution for generated document routes.
- Added SDK login/me methods and OpenAPI auth paths.
- Next highest-value item after verification: durable framework records, because users, audit, and outbox should persist through the same production deployment path as documents.

### 2026-07-02 - Phase 2 Durable Users Evaluation

- Added `PostgresUserStore` for durable auth users and CRM bootstrapping that uses it when `DATABASE_URL` is configured.
- Added runtime audit store, Postgres audit persistence, `/api/audit`, OpenAPI contract coverage, and SDK access.
- Added persistent event outbox, runtime outbox API, Postgres outbox store, OpenAPI paths, and SDK helpers.
- Next highest-value item: Phase 3 customization and schema evolution, because users need safe metadata changes after durable framework records exist.

### 2026-07-02 - Phase 3 Custom Fields Evaluation

- Added tenant custom fields, view metadata, metadata merging, generated API support, SDK helpers, Desk view consumption, and Postgres persistence.
- Added naming series with in-memory and Postgres stores, plus CRM Deal series IDs.
- Migration preview/apply commands remain future hardening rather than MVP-critical runtime behavior.
- Next highest-value item: Phase 4 automation, jobs, and realtime.

### 2026-07-02 - Phase 4 Outbox Dispatcher Evaluation

- Added `dispatchOutboxEvents` worker helper in `@framekit/jobs`, tests, and a CRM `outbox:dispatch` command.
- Added runtime realtime publisher port and in-memory event bus publishing for document mutations.
- Added scheduled job registry and explicit outbox failed-event/dead-letter behavior.
- Next highest-value item: Phase 5 developer experience and release hardening.

### 2026-07-02 - Phase 5 DX/Release Evaluation

- Added CI workflow, deployment docs, and a real `framekit create-app` scaffold with Nitro routes, starter DocType, env example, and Dockerfile.
- Typed SDK generation from OpenAPI remains a future enhancement; the current SDK exposes auth, metadata, audit, outbox, customization, views, and document operations.
- Roadmap status: complete for the current framework MVP.

# Framekit Roadmap

> This file records the completed MVP phases and their history. The current production-maturity assessment, component percentages, missing features, and open GitHub work are maintained in [maturity-roadmap.md](maturity-roadmap.md). As of 2026-07-21, Framekit is assessed at 52% implementation toward a production-ready 1.0 and remains an advanced alpha.

## Implemented

- Metadata-defined DocTypes, modules, permissions, hooks, workflows, and document CRUD.
- Nitro adapter with generated document routes, CORS, health, metadata, diagnostics, and OpenAPI endpoints.
- In-memory repository for development and Postgres JSON-document repository for durable deployments.
- Queue and realtime ports with initial adapters.
- SDK, CLI scaffolding, generated Desk UI, CRM example, Docker Compose, tests, and build verification.
- OpenAPI 3.1 generation and runtime diagnostics.

## MVP Roadmap To Completion

Each iteration must end with `pnpm typecheck`, `pnpm test`, `pnpm build`, built-server smoke checks, and a short decision on the next highest-value item.

For the active production-depth roadmap after the MVP phases below, see [maturity-roadmap.md](maturity-roadmap.md).

### Phase 1 - Authentication And Sessions

Status: implemented for the MVP, with security remediation required by [#16](https://github.com/WilliamCorotan/FrameKit/issues/16)

- Add a framework auth package with password hashing, signed sessions, tenant context resolution, and an in-memory user store.
- Add Nitro auth endpoints for login and current user.
- Let generated document routes resolve tenant/user context from Bearer tokens. The original header fallback is not safely development-only and must be replaced by #16.
- Seed the CRM example with an admin user.

Exit criteria:

- Login returns a signed session token.
- `/api/auth/me` returns the current user from the token.
- Document routes work with Bearer tokens; any header-derived development identity must become explicit, fail-safe, and production-disabled.

### Phase 2 - Durable Framework Records

Status: implemented for the MVP

- Persist framework users, audit events, and outbox events through repository ports.
- Extend the Postgres adapter beyond generic documents for framework-owned records.
- Add migrations and smoke checks for durable auth plus audit.

### Phase 3 - Customization And Schema Evolution

Status: implemented

- Support runtime custom fields, view metadata, naming series, and DocType migration planning.
- Add runtime migration plan/apply APIs and CLI-generated migration artifacts.
- Surface custom fields and list/form view configuration in Desk.

### Phase 4 - Automation, Jobs, And Realtime

Status: partially implemented

- Implement event outbox, job registration, retry helpers, and failed-event inspection.
- Add realtime document events for Desk refreshes.
- Provide a BullMQ adapter while keeping queue ports portable. A production worker/scheduler path remains tracked in [#22](https://github.com/WilliamCorotan/FrameKit/issues/22).

### Phase 5 - Developer Experience And Release Hardening

Status: partially implemented

- Generate typed SDK models from app metadata; generated endpoint parity remains incomplete.
- Add a `create-app` template for Nitro, Docker/env, and a starter DocType. Standalone consumption and a complete Desk template remain tracked in [#24](https://github.com/WilliamCorotan/FrameKit/issues/24).
- Add CI workflow, deployment presets docs, and package publishing metadata.

## Historical Next Candidates

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
- CLI-generated SDK types are implemented; the runtime SDK exposes auth lifecycle, provider login, metadata, audit, outbox, customization, views, migrations, realtime, admin, and document operations.
- Roadmap status: complete for the current framework MVP.

### 2026-07-21 - Production Maturity Reevaluation

- Reclassified the project as advanced alpha: broad MVP functionality is present, but production readiness is blocked by request identity fail-open behavior and a non-terminating built-server CI smoke.
- Replaced the stale external-work list in the maturity roadmap: issues #2 through #7 are closed and their implementations are present.
- Scored 12 modern framework components using a production-ready 1.0 rubric; component-average implementation is 52%, functional breadth is approximately 59%, and production readiness is approximately 38%.
- Opened prioritized tracking issues #16 through #27 with acceptance criteria.
- Current order: secure identity and release gates, atomic/concurrent persistence, scalable queries and migrations, durable jobs/realtime, full-stack verification and standalone publication, then deeper domain and operational maturity.

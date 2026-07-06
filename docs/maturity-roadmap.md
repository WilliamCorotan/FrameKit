# Framekit Maturity Roadmap

Framekit now has the main framework skeleton in place: metadata, runtime services, Nitro APIs, auth/RBAC management, Postgres adapters, OpenAPI, SDK, CLI, jobs, realtime, Desk, and deployment proof. Most local framework-depth items are implemented; the remaining maturity work is service-backed verification, concrete third-party auth adapters, and package publication output hardening.

## Overall Maturity

- Local framework core: about 70% implemented.
- Release-candidate maturity: about 60% implemented.
- Primary blockers: external verification, concrete auth adapters, executable migration tooling, browser coverage, and publishable package outputs.

## Modern Framework Component Matrix

| Component | Estimate | In Place | Major Gaps |
| --- | ---: | --- | --- |
| Core metadata/domain model | 85% | DocTypes, modules, fields, permissions, workflows, hooks, indexes, views | More domain constraints and richer settings/config model |
| Runtime application services | 85% | CRUD, validation, permissions, hooks, audit, outbox, realtime, customization, naming series | More transaction boundaries and cross-store consistency |
| Data/query/persistence | 75% | In-memory and Postgres stores, filters, sorting, cursor, projection, unique/link enforcement | Service-backed tests, query pushdown, stronger relational/index semantics |
| HTTP/API/OpenAPI | 85% | Nitro routes, auth/admin/system/document/customization APIs, OpenAPI 3.1 | Built-server smoke and versioned API compatibility policy |
| Auth/IAM | 70% | Password auth, signed sessions, refresh/logout, revocation, lockout, API tokens, audit, provider port | Cookie sessions, concrete OAuth/OIDC adapters, MFA/invite flows |
| Schema evolution | 65% | Plans, checksums, rollback metadata, destructive guard, CLI migration artifact | Actual DDL generation/execution, replay tooling, reversible apply/rollback commands |
| Jobs/events/realtime | 65% | Outbox, BullMQ adapter, dispatch helpers, in-memory realtime, SSE | Redis integration tests, retry dashboards, durable realtime/event replay |
| Desk/admin UI | 60% | Metadata-driven Desk, auth/admin/ops/customization screens | Browser verification, UX polish, accessibility, responsive QA |
| SDK/CLI/devex | 70% | SDK client, generated SDK types, scaffolding, migration generation | Published templates, richer CLI workflows, typed endpoint coverage parity |
| Ops/security/release | 55% | Request IDs, headers, rate limiting, health checks, deployment/release docs | Package `dist` output, publish metadata, release automation, production observability adapters |
| Testing/CI | 55% | Unit tests, local Nitro smoke, build/typecheck audit | Postgres/Redis service matrix, built-server smoke, browser tests |
| Docs/examples | 70% | README, architecture, deployment, roadmap, release policy, CRM example | More production recipes and SDK/CLI workflow examples |

## Phase 1 - Data Semantics

Status: implemented

- Add rich list filters: equality, `in`, comparison, contains, and null checks. Implemented.
- Enforce `link` field integrity before document writes. Implemented.
- Enforce `unique` field constraints before create/update. Implemented.
- Add stable cursor pagination and field projection after the first operator pass. Implemented with document-id cursors and data-field projection.
- Keep behavior consistent between in-memory and Postgres JSON-document repositories. Implemented through shared list option handling.

Exit criteria:

- Runtime tests cover filter operators, invalid operators, link failures, and unique conflicts. Implemented.
- SDK and OpenAPI document the query shape. Implemented for filters, sort, cursor, offset, limit, and fields.
- `pnpm audit:all` passes. Implemented.

## Phase 2 - Integration Verification

Status: implemented for local runtime; external adapters pending

- Add built CRM API smoke tests for login, CRUD, auth admin, migrations, outbox, and realtime history. In-process Nitro handler smoke implemented; built-server smoke remains.
- Add Postgres-backed tests for documents, users, audit, outbox, custom fields, naming series, and migrations.
- Add Redis/BullMQ-backed tests for queue and retry behavior.
- Add browser verification for Desk login, document CRUD, admin screens, operations screens, and responsive layouts.
- Add CLI smoke coverage for generated SDK output. Implemented.

Exit criteria:

- CI can run unit tests without services and integration tests with service containers.
- A production-like smoke command verifies the built Nitro server.

## Phase 3 - Auth Lifecycle

Status: implemented for framework core; concrete cookie/OIDC adapters pending

- Add refresh tokens or short-lived cookie sessions. Signed session rotation implemented through `/api/auth/refresh`; cookie transport remains pending.
- Add session revocation and user disable/lockout. Implemented with in-memory and Postgres persistence.
- Add password change/reset workflows. Implemented with self-service password change and admin reset endpoints.
- Add auth audit events for user, role, and token management. Implemented with an auth-owned audit sink and `/api/auth/audit`.
- Add provider ports for OAuth/OIDC. Provider-independent login port implemented; concrete OAuth/OIDC adapters remain pending.

Exit criteria:

- Session and token lifecycle tests cover revocation, expiry, disabled users, and provider-independent context creation. Implemented for in-memory verification.

## Phase 4 - Schema Evolution

Status: implemented

- Convert migration plans into versioned migration records with checksums. Implemented with checksum verification on apply.
- Add generated migration files through CLI. Implemented through `generate-migration <current> <next> [--out file]`.
- Add rollback metadata for reversible changes. Implemented on each planned migration change.
- Add index and unique constraint migration planning from DocType metadata. Implemented in runtime migration plans.
- Add operator confirmation for destructive changes. Implemented through `allowDestructive` apply guard.

Exit criteria:

- Migration plan/apply can be audited and replayed safely across environments. Implemented through checksums, rollback metadata, destructive guards, and generated migration artifacts.

## Phase 5 - Operations And Release Hardening

Status: partially implemented

- Add request IDs, structured logging, metrics hooks, and dependency health checks. Implemented in the Nitro adapter, including optional `/health/dependencies` checks.
- Add rate-limiting and security-header adapters. Optional in-memory/custom rate limiting and baseline security headers implemented in the Nitro adapter.
- Add package build outputs and publishing metadata.
- Add changelog/versioning policy. Implemented in `docs/release.md`.
- Add deployment docs for Node/Postgres/Redis and serverless constraints. Implemented in `docs/deployment.md`.

Exit criteria:

- `pnpm audit:all` plus integration smoke checks are enough to cut a release candidate.

## Remaining External Work

- Built-server CRM, Postgres, and Redis verification: [#2](https://github.com/WilliamCorotan/FrameKit/issues/2).
- Browser verification and Desk UX hardening: [#3](https://github.com/WilliamCorotan/FrameKit/issues/3).
- Concrete OAuth/OIDC and cookie session adapters: [#4](https://github.com/WilliamCorotan/FrameKit/issues/4).
- Executable migration apply/replay/rollback tooling: [#5](https://github.com/WilliamCorotan/FrameKit/issues/5).
- Package publication output hardening: [#6](https://github.com/WilliamCorotan/FrameKit/issues/6).
- Public documentation sync and examples: [#7](https://github.com/WilliamCorotan/FrameKit/issues/7).

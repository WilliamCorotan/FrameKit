# Framekit Maturity Roadmap

Framekit now has the main framework skeleton in place: metadata, runtime services, Nitro APIs, auth/RBAC management, Postgres adapters, OpenAPI, SDK, CLI, jobs, realtime, Desk, and deployment proof. Most local framework-depth items are implemented; the remaining maturity work is service-backed verification, concrete third-party auth adapters, and package publication output hardening.

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

- Built-server CRM smoke test against `.output/server/index.mjs`.
- Postgres-backed integration suite with a real database service.
- Redis/BullMQ integration suite with a real Redis service.
- Browser verification for Desk login, document CRUD, admin screens, operations screens, and responsive layouts.
- Concrete OAuth/OIDC provider adapters on top of the provider login port.
- Package publication output hardening: emitted `dist` artifacts, package `files`, publish config, and release automation.

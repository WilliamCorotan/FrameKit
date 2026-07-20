# Framekit Maturity Roadmap

Last reevaluated: 2026-07-21

Framekit is an advanced-alpha, metadata-driven TypeScript business application framework. The framework skeleton is broad and credible: metadata, runtime services, Nitro APIs, authentication, Postgres adapters, migrations, jobs, realtime, OpenAPI, SDK, CLI, Desk, deployment, and release artifacts are all present. It is not release-candidate ready because request identity currently fails open, the built-server CI gate does not terminate, and durable mutations are not atomic.

## Scoring Model

Each implementation percentage measures progress toward a production-ready 1.0 in that component:

- 0%: absent.
- 25%: contract or proof of concept.
- 50%: usable MVP path.
- 75%: release-candidate depth and verification.
- 100%: production-hardened behavior, operations, compatibility, and documentation.

The estimates are evidence-based engineering judgments, not line coverage or issue completion. They should be revised when an acceptance criterion below is verified.

## Overall Assessment

- Component-average implementation: **52%**.
- Functional breadth: approximately **59%**.
- Production readiness: approximately **38%**.
- Current stage: **advanced alpha**.
- Release blockers: authenticated identity enforcement, safe HTTP/auth defaults, and a terminating built-server CI gate.

## Modern Framework Component Matrix

| Component | Implementation | In place | Missing or incomplete |
| --- | ---: | --- | --- |
| Core metadata and domain model | 68% | DocTypes, modules, ten field types, permissions, hooks, workflows, naming, indexes, navigation, and views | Cross-reference invariants, child records, attachments, computed fields, decimal semantics, ownership/row permissions, localization, typed settings |
| Runtime and command lifecycle | 60% | CRUD, validation, permissions, hooks, transitions, customization, audit, outbox, naming, realtime, and diagnostics | Atomic unit of work, optimistic concurrency, idempotency, submit/cancel commands, consistent hook validation, bulk/cross-document commands, start/stop/dispose lifecycle |
| Data, query, and persistence | 50% | In-memory and Postgres adapters for documents and framework records; filters, sorting, projection, cursors, links, and uniqueness checks | Query pushdown, stable opaque cursors, adapter-enforced uniqueness, locking/revisions, atomic document/outbox persistence, load/performance evidence |
| HTTP API and OpenAPI | 58% | Broad Nitro route surface, OpenAPI 3.1, framework errors, request IDs, headers, rate-limit and telemetry ports | Authenticated-by-default routing, operations authorization, hardened CORS, version/compatibility policy, idempotency, pagination envelopes |
| Authentication and IAM | 40% | Password sessions, cookies, refresh/logout/revocation, lockout, API tokens, roles, audit, provider port, OIDC introspection | Critical request-identity bypass, CSRF model, secure production defaults, persistent identity links, authorization-code/PKCE, recovery/invites, MFA policy |
| Schema evolution | 60% | Plans, checksums, rollback metadata, destructive guard, SQL generation, CLI apply/replay/rollback, Postgres verification | Consistent HTTP/CLI semantics, full DocType removal, locking, drift detection, duplicate/idempotent apply policy, safe conversions |
| Jobs, events, and realtime | 45% | Queue port, BullMQ adapter, retry helper, scheduled registry, outbox dispatcher, SSE, in-memory history | Worker/scheduler lifecycle, atomic outbox leasing, deduplication, durable multi-instance fanout and replay, graceful shutdown |
| Desk and admin UI | 55% | Metadata lists/forms, workflow controls, auth administration, customization, audit/outbox/diagnostics screens, responsive smoke | Real-backend E2E, delete/pagination/filter UX, field errors, accessibility audit, keyboard coverage, multi-browser verification |
| SDK, CLI, and developer experience | 55% | Broad HTTP client, generated model types, app/module/DocType scaffolding, migration commands | Generated endpoint parity, typed/retriable client errors, safe scaffold overwrite policy, standalone templates, upgrade/config workflows |
| Operations, security, and release | 35% | Health checks, logger/metrics hooks, rate limiting, deployment docs, dist outputs, publish metadata, RC notes | Secure defaults, resource lifecycle, production observability adapters, secret/config validation, publish workflow, SBOM/security scanning |
| Testing and CI | 55% | 52 unit/in-process tests, service-backed suites, built-server smoke assertions, five mocked browser journeys | Green terminating CI, browser job in CI, full-stack Desk test, tenant/security tests, fault/concurrency tests, coverage thresholds, working package-local test scripts |
| Documentation and adoption | 45% | README, architecture, deployment, release policy, two roadmaps, CRM example | Standalone install guide, security model, compatibility/support matrix, contribution/security policies, API reference, verified external-consumer tutorial |

## Priority 0 - Release Blockers

No release candidate should be cut until all P0 items are closed and their acceptance criteria are verified.

1. [#16 Enforce authenticated request identity and operations authorization](https://github.com/WilliamCorotan/FrameKit/issues/16)
2. [#17 Harden HTTP, cookie, secret, and bootstrap security defaults](https://github.com/WilliamCorotan/FrameKit/issues/17)
3. [#18 Make the built-server smoke release gate terminate reliably](https://github.com/WilliamCorotan/FrameKit/issues/18)

Exit criteria:

- Authenticated deployments never accept caller-asserted roles, permissions, users, or tenants.
- Public and privileged operations have an explicit, tested authorization policy.
- Production HTTP, cookie, secret, and bootstrap defaults fail safely.
- The complete default-branch CI finishes green within bounded time.

## Priority 1 - Release-Candidate Depth

1. [#19 Add atomic mutations, optimistic concurrency, and durable uniqueness](https://github.com/WilliamCorotan/FrameKit/issues/19)
2. [#20 Push query operations and stable cursor pagination into Postgres](https://github.com/WilliamCorotan/FrameKit/issues/20)
3. [#21 Harden executable migrations, drift detection, and route semantics](https://github.com/WilliamCorotan/FrameKit/issues/21)
4. [#22 Provide durable job execution, outbox claiming, and realtime replay](https://github.com/WilliamCorotan/FrameKit/issues/22)
5. [#23 Add real full-stack Desk CI, accessibility, and browser coverage](https://github.com/WilliamCorotan/FrameKit/issues/23)
6. [#24 Prove standalone packages, scaffolding, and automated publication](https://github.com/WilliamCorotan/FrameKit/issues/24)
7. [#25 Complete production identity lifecycle and OIDC flow](https://github.com/WilliamCorotan/FrameKit/issues/25)

Exit criteria:

- Durable commands are atomic, concurrency-safe, and retry-safe.
- Postgres query and migration behavior is bounded, deterministic, and verified under contention.
- Jobs and realtime work across multiple processes with recoverable delivery semantics.
- A standalone consumer can install packed artifacts, scaffold an app, authenticate, build, and run.
- Desk behavior is verified against the real built stack in CI.

## Priority 2 - Production Maturity

1. [#26 Deepen metadata invariants and business document semantics](https://github.com/WilliamCorotan/FrameKit/issues/26)
2. [#27 Add production lifecycle, observability, compatibility, and supply-chain gates](https://github.com/WilliamCorotan/FrameKit/issues/27)

Exit criteria:

- Metadata contracts cover the selected 1.0 business semantics consistently across every adapter and generated surface.
- Runtime resources expose lifecycle and cancellation contracts.
- Supported platforms and compatibility guarantees are published and tested.
- Observability, dependency security, contribution, disclosure, and support workflows are usable by operators and contributors.

## Highest-Risk Technical Findings

1. `tenantFromRequest` accepts caller-controlled tenant, user, role, and permission headers and defaults to administrator access even when auth exists.
2. Document persistence happens before hook, audit, outbox, and realtime work completes, so an error can be returned after partial durable success.
3. Postgres document lists materialize the tenant/DocType result set before applying filters, sort, projection, and pagination.
4. Unique checks are list-then-write and updates have no expected revision, so concurrent requests can duplicate or overwrite data.
5. Runtime migration apply and CLI executable migration behavior are not one consistent contract; removal, drift, locking, and replay policies remain incomplete.
6. Outbox dispatch has no atomic claim/lease and realtime history is process-local.
7. The built CRM smoke reaches successful assertions but leaves open handles, which blocks CI completion.
8. Package-local test scripts fail to discover tests because their package working directory conflicts with the root Vitest include pattern.

## Verification Snapshot

Reevaluation checks on 2026-07-21:

- `pnpm audit:all`: lint/typecheck passed, 52 tests passed and 2 service tests skipped without service environment variables, and all packages plus the CRM and Desk built.
- `pnpm test:desk:browser`: 5 Chromium journeys passed against mocked API routes.
- `pnpm smoke:crm:built`: assertions passed, but the process did not terminate until interrupted; tracked by #18.
- Package-local core, runtime, and OpenAPI test commands: failed with no tests discovered; tracked by #27.
- GitHub issues #2 through #7 are closed and their implemented work is present; older pending references were stale.

## Score Update Policy

When an issue closes, update only the affected rows. A score should increase only when source behavior, focused tests, production-like verification, and user/operator documentation all support the new level. Functional code without integration evidence should not be scored as release-candidate complete.

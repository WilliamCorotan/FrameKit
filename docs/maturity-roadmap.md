# Framekit Maturity Roadmap

Last reevaluated: 2026-07-21

Framekit is a beta, metadata-driven TypeScript business application framework. Its production path now covers secure HTTP/auth defaults, atomic durable mutations, pushed-down queries, executable migrations, durable jobs and realtime, standalone package verification, full-stack browser checks, bounded business-document lifecycle semantics, resource lifecycle, observability adapters, compatibility testing, and supply-chain automation. Deferred metadata primitives are tracked separately in #39 through #42.

## Scoring Model

Each implementation percentage measures progress toward a production-ready 1.0 in that component:

- 0%: absent.
- 25%: contract or proof of concept.
- 50%: usable MVP path.
- 75%: release-candidate depth and verification.
- 100%: production-hardened behavior, operations, compatibility, and documentation.

The estimates are evidence-based engineering judgments, not line coverage or issue completion. They should be revised when an acceptance criterion below is verified.

## Overall Assessment

- Component-average implementation: **83%**.
- Functional breadth: approximately **89%**.
- Production readiness: approximately **79%**.
- Current stage: **beta**.
- Remaining 1.0 decisions: the explicitly deferred metadata primitives in #39 through #42.

## Modern Framework Component Matrix

| Component | Implementation | In place | Missing or incomplete |
| --- | ---: | --- | --- |
| Core metadata and domain model | 76% | DocTypes, modules, field/link/index/naming/view/workflow invariants, dependency-cycle checks, permissions, hooks, naming, navigation, and views | Child records, attachments, computed fields, exact decimal semantics, ownership/row permissions, localization, typed settings |
| Runtime and command lifecycle | 92% | CRUD, ordered validation/hooks, draft-submit-cancel lifecycle, post-submit immutability, atomic durable commands, revisions, idempotency, audit/outbox/realtime, diagnostics, and ordered start/close/dispose | Bulk/cross-document commands and deeper cancellation propagation |
| Data, query, and persistence | 84% | In-memory and Postgres adapters, pushed-down filters/sorts/projections, opaque cursors, durable uniqueness, revisions, locking, and atomic document/outbox persistence | Load/performance evidence, sharding/partition guidance, broader physical schema modeling |
| HTTP API and OpenAPI | 82% | Secure routing defaults, broad Nitro/OpenAPI surface, operation permissions, idempotency, request IDs, rate limiting, telemetry ports, and split health probes | Version negotiation, pagination envelopes, generated error schemas |
| Authentication and IAM | 78% | Password sessions, cookies, refresh/logout/revocation, lockout, API tokens, roles, durable audit and identity links, OIDC discovery/JWKS authorization-code/PKCE, single-use invitations and recovery, forged-header and cross-tenant protection | Native WebAuthn/TOTP enrollment and step-up assurance policy; provider-enforced MFA is the current production scope |
| Schema evolution | 85% | Executable HTTP/CLI contract, schema fingerprints, full DocType diffs, checksums, destructive and irreversible guards, advisory locking, drift/replay policy, atomic Postgres apply/rollback, and legacy uniqueness backfill | Operator-authored conversion hooks, online/zero-downtime strategies, physical-schema inspection beyond managed indexes, and approval/audit workflows |
| Jobs, events, and realtime | 85% | BullMQ queues/workers, atomic outbox leases, retry/backoff/dead-letter behavior, idempotency keys, scheduling, Postgres fanout/replay, SSE, lifecycle and cancellation | Operational load evidence, poison-message tooling, richer scheduler persistence |
| Desk and admin UI | 82% | Metadata lists/forms, workflows, auth administration, customization, operations screens, real-stack Chromium/Firefox journeys, accessibility checks | Richer field errors, keyboard depth, visual regression policy |
| SDK, CLI, and developer experience | 75% | Broad HTTP parity, generated model types, scaffolding, migration commands, packed standalone consumer proof | Typed/retriable errors, upgrade/config workflows, packaged Desk template |
| Operations, security, and release | 82% | Secure defaults, lifecycle, bounded readiness, OpenTelemetry-compatible adapters/redaction, tested compatibility, provenance publication, dependency audit, CodeQL, Dependabot, and SBOM artifacts | Alert/runbook examples, SLO guidance, sustained fault/load evidence |
| Testing and CI | 88% | Unit, service, concurrency/fault, built smoke, standalone package, full-stack browser, package-local, compatibility matrix, and enforced coverage gates | Sustained load/soak testing, more failure injection, visual regression |
| Documentation and adoption | 72% | README, architecture, deployment, security, identity, consistency, querying, migrations, observability, compatibility, contribution, disclosure, support, release, and roadmaps | Generated API reference site, versioned upgrade guides, external tutorial feedback |

## Priority 0 - Release Blockers

No release candidate should be cut until all P0 items are closed and their acceptance criteria are verified.

No open P0 issues.

Completed during this reevaluation:

- [#16 Enforce authenticated request identity and operations authorization](https://github.com/WilliamCorotan/FrameKit/issues/16)
- [#18 Make the built-server smoke release gate terminate reliably](https://github.com/WilliamCorotan/FrameKit/issues/18)
- [#17 Harden HTTP, cookie, secret, and bootstrap security defaults](https://github.com/WilliamCorotan/FrameKit/issues/17)

Exit criteria:

- Authenticated deployments never accept caller-asserted roles, permissions, users, or tenants.
- Public and privileged operations have an explicit, tested authorization policy.
- Production HTTP, cookie, secret, and bootstrap defaults fail safely.
- The complete default-branch CI finishes green within bounded time.

## Priority 1 - Release-Candidate Depth

Issues #19 through #25 are implemented and closed.

Exit criteria:

- Durable commands are atomic, concurrency-safe, and retry-safe.
- Postgres query and migration behavior is bounded, deterministic, and verified under contention.
- Jobs and realtime work across multiple processes with recoverable delivery semantics.
- A standalone consumer can install packed artifacts, scaffold an app, authenticate, build, and run.
- Desk behavior is verified against the real built stack in CI.

## Priority 2 - Production Maturity

1. [#26 Deepen metadata invariants and business document semantics](https://github.com/WilliamCorotan/FrameKit/issues/26) — bounded 1.0 contract implemented; deferred primitives are tracked by [#39](https://github.com/WilliamCorotan/FrameKit/issues/39), [#40](https://github.com/WilliamCorotan/FrameKit/issues/40), [#41](https://github.com/WilliamCorotan/FrameKit/issues/41), and [#42](https://github.com/WilliamCorotan/FrameKit/issues/42).
2. [#27 Add production lifecycle, observability, compatibility, and supply-chain gates](https://github.com/WilliamCorotan/FrameKit/issues/27) — implemented by this change; closes when merged.

Exit criteria:

- Metadata contracts cover the selected 1.0 business semantics consistently across every adapter and generated surface.
- Runtime resources expose lifecycle and cancellation contracts.
- Supported platforms and compatibility guarantees are published and tested.
- Observability, dependency security, contribution, disclosure, and support workflows are usable by operators and contributors.

## Highest-Risk Technical Findings

1. The metadata model still lacks the selected child-record, attachment, ownership, computed-field, localization, and decimal semantics required for 1.0.
2. Compatibility gates prove supported combinations functionally, but sustained load, soak, and infrastructure fault testing remain limited.
3. Nitro and H3 remain pre-release dependencies; upgrades require explicit compatibility evidence.
4. OpenTelemetry adapters are exporter-neutral and tested for redaction, but production sampling, alerting, and SLOs remain operator responsibilities.
5. Community support is best-effort; there is no commercial incident-response commitment.

## Verification Snapshot

Reevaluation checks on 2026-07-21:

- `pnpm audit:all`: lint/typecheck, 115 unit/in-process tests, enforced coverage thresholds, and all package, CRM, and Desk builds pass.
- `pnpm test:desk:browser`: 5 Chromium journeys passed against mocked API routes.
- `pnpm smoke:crm:built`: assertions and bounded cleanup regression tests pass and terminate; #18 is closed.
- CI defines bounded package-local/coverage, Node 22/24, Postgres 16/17, Redis 7/8, built-smoke, standalone, browser, CodeQL, dependency audit, Dependabot, and SBOM gates.
- Forged-header, cross-tenant, operation-permission, realtime-history, and SSE authorization checks pass; #16 is closed.
- All ten public packages expose working package-local test commands; coverage is 67.86% statements, 61.70% branches, 66.18% functions, and 69.67% lines at this reevaluation.
- GitHub issues #2 through #7 are closed and their implemented work is present; older pending references were stale.

## Score Update Policy

When an issue closes, update only the affected rows. A score should increase only when source behavior, focused tests, production-like verification, and user/operator documentation all support the new level. Functional code without integration evidence should not be scored as release-candidate complete.

The accepted metadata/lifecycle contract and compatibility policy are maintained in [metadata-compatibility.md](metadata-compatibility.md).

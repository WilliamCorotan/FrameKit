# Framekit Maturity Roadmap

Last reconciled: 2026-09-09 against security baseline `252aa7e`. Historical verification below applies only to its named commits. This document tracks implementation and release evidence separately; closed historical issues do not establish production readiness.

Framekit is a beta, metadata-driven TypeScript business application framework. The selected metadata, HTTP, persistence, migration, job/realtime, Desk, SDK, and release-gate slices are implemented. This is not a claim of an unqualified production 1.0: the explicitly delegated capabilities and operating evidence below remain necessary for that bar.

## Scoring rubric

Scores are evidence-based engineering estimates, not issue-completion percentages or line coverage. Each component is assessed against this common scale:

- **0%** absent; **25%** contract/prototype; **50%** usable path; **75%** release-candidate depth with focused verification; **100%** production-hardened behavior, operations, compatibility, and documentation.
- **Implemented** means the bounded repository contract is present and tested. **Partial** means a supported path exists but the stated production depth or evidence is missing. **Delegated** means Framekit intentionally exposes a port or operator responsibility rather than pretending to supply that facility.
- A score may rise only with source behavior, focused tests, production-like verification, and user/operator documentation. Coverage is a guardrail, not a score.

## Current implementation plan

Stage: **beta**. The historical 88% estimate is retained below as context, not used as a completion gate. A production-ready release requires every applicable acceptance gate below to pass on a named commit. Public deployment, package publication, and a 1.0 release require separate authorization.

The initial supported production target is a Node server, PostgreSQL, Redis/BullMQ, and durable attachment storage. Deployment-specific secrets, domains, capacity targets, and external identity-provider credentials must be supplied by the operator. Edge/serverless support is not inferred from Nitro compatibility.

| Milestone | Status | Implementation and acceptance gate |
| --- | --- | --- |
| S0 — Security baseline | Complete (`252aa7e`) | Patch dependency advisories; browser-bound OIDC, verified-email linking, credential-bound sessions, owner-bound API tokens, and atomic auth mutations. Unit, real PostgreSQL, browser, built-server, and dependency checks pass. |
| P1 — Durable production composition | Implemented and locally verified | Bounded shared PostgreSQL connections with explicit ownership; production secret encryption and rotation; durable attachment adapter with leases and conditional cleanup; reject accidental ephemeral production stores. Restart, isolation, cleanup-race, and shutdown tests pass. |
| P2 — Operating and recovery evidence | Local evidence complete; staging qualification pending | Reproducible load/soak and fault harness; backup/restore drill; retention and dead-letter recovery; readiness and shutdown behavior; operator runbooks with measured capacity and recovery results. No unmeasured performance claims. |
| P3 — Durable automation and native MFA | Implemented and locally verified | Crash-resumable saga state, lease fencing, deterministic compensation and idempotency; durable scheduler ownership; native MFA enrollment/challenge/recovery/step-up with rate limits and replay protection. Integrate HTTP/SDK/Desk and test cross-instance recovery. |
| P4 — Safe evolution and public contracts | Framework contracts implemented; deployment upgrade qualification pending | Physical schema drift inspection, supported online migration/rollback boundaries, explicit API compatibility and pagination contracts, generated API reference, and versioned upgrade examples. Upgrade a previous supported installation and verify rollback/recovery. |
| P5 — Distributable Desk and consumer experience | Implemented and locally verified | Packaged Desk assets with runtime configuration and version/upgrade contract; scaffold integration; error summaries and keyboard/accessibility coverage. Install, authenticate, perform business workflows, and upgrade outside this monorepo. |
| P6 — Release qualification | Local checks passed; hosted/staging gates pending | All supported Node/service/browser matrices, packed consumers, security/CodeQL/SBOM checks, restore/load/fault evidence, and a representative external application pass against one release candidate. Outstanding limitations are explicit and accepted; release artifacts remain unpublished until authorized. |

The framework is not marked production-ready while any applicable gate is pending. Native MFA, durable saga recovery, and Desk distribution are part of the expanded capability work; third-party services and an unlimited set of domain modules are not implied by "fully capable".

### Current implementation evidence (working tree, September 2026)

- P1: `@framekit/storage` provides context-bound AES-GCM keyrings and PostgreSQL/S3 immutable attachment generations. Cleanup uses revision snapshots and atomic leases; failed deletions rotate through repair. CRM enforces durable production configuration, preserves existing bootstrap users/roles, and owns shutdown. Shared PostgreSQL connections use separate raw/ORM codec pools under one explicit aggregate budget.
- P1 checks: full lint/typecheck/coverage/build passed (**203 passed / 26 skipped**) before subsequent scheduler/MFA additions; live S3 **4/4**, mixed-codec PostgreSQL regressions, packed standalone consumer with **11 packages**, package exports, and built smoke passed. The final combined candidate still needs qualification.
- P2: `verify:operations` ran **8,281** create/replay/update/read cycles in **30 seconds**, eight workers and four aggregate query connections; local cycle p95 **38.8 ms**. A subsequent five-second run recreated clients/adapters and verified durable replay (**1,404 cycles**). This is local component evidence, not an HTTP SLO or process-crash/failover result. The isolated `pg_dump`/`pg_restore` drill passed for a new database, tenant isolation, historical settings keys, and restored attachment registry/bytes. A ten-minute rerun passed **135,721 cycles**, p95 **60.6 ms**, after fixing truncated-UUID collisions. An actual SIGKILL probe passed committed-receipt replay and uncommitted transaction rollback. Managed-service failover, deployment-specific soak and operator SLO qualification remain open.
- P3: Redis-backed `BullMqScheduler` persists schedules, supports bounded job-history retention, and passed restart/upsert/execution/removal tests. Native TOTP/recovery MFA is integrated across password/provider sign-in, HTTP, SDK and Desk, with session invalidation, recent-auth checks and atomic rate/replay limits. Auth tests **142**, PostgreSQL MFA **5**, retention **3**, and mocked Desk journeys **15** passed. Browser OIDC challenge forms passed HTTP integration tests; durable saga recovery passed **8** live PostgreSQL fault/fencing cases. Runtime unit/configuration checks passed **57**. Final combined qualification remains active.
- Combined checks so far: **332 passed / 46 skipped** without external services, **67.19%** statement coverage; PostgreSQL 17 coverage **39 tests**, **78.79%** statements; PostgreSQL 16 adapter suite **38 tests**, Redis 7/8 **3 tests each**, PostgreSQL/S3 **4 tests** on both database majors. Later saga assertions may increase service counts. Skipped unit-run cases are exercised by explicit service commands.
- P4: Structural PostgreSQL catalog inspection passed isolated schema/index/default regressions; a generated reference indexes all **12** public packages. Existing online migration tests cover approved conversion checkpoints, interruptions, concurrent operators and guarded rollback.
- P5: A packed **12-package** standalone consumer passed installation, typecheck, build, authentication and CRUD, including `create-app --desk` and configuration-preserving Desk upgrade. The packaged `/desk/` browser journey passed. PostgreSQL-backed Chromium/Firefox passed **10/10** journeys including native MFA. All **12** public package export surfaces passed on Node **22** and **24**.

### Final local qualification (September working tree)

- `pnpm audit:all`: lint, recursive typechecks, coverage and builds passed; **352 passed / 46 skipped**, **67.19%** statement coverage. The service-dependent cases are checked separately.
- PostgreSQL **16/17** adapter suites: **38 tests** each; PostgreSQL 17 coverage including CRM bootstrap: **39 tests**, **78.79%** statements. Redis **7/8**: **3 tests** each. PostgreSQL/S3 storage: **4 tests** on each database major.
- Desk mocked browser **15/15**; durable PostgreSQL Chromium/Firefox **10/10** including MFA. Packaged Desk **1/1**; actual OIDC MFA form **2/2** across Chromium/Firefox. The browser check caught and fixed null-Origin form submissions by applying a strict-origin policy specifically to the MFA page.
- Server bridge request limits, streaming/SSE, disconnect cancellation and bounded shutdown: **20 tests**, also passed on Node **22**. CLI combined suite **48 tests**. Final Nitro suite **31 tests**, root TypeScript check, CRM build and built smoke **2/2** passed after the form fix.
- All **12** public packages passed export checks on Node **22/24**. Packed consumer installation, typecheck, build, authentication, CRUD and Desk install/upgrade passed.
- Ten-minute component soak: **135,721 cycles**, p95 **60.6 ms**, eight workers/four aggregate query connections. Real SIGKILL after commit and during an uncommitted transaction passed, including a fresh database and zero remaining probe rows. Isolated database/keyring/object restoration passed.
- Dependency audit: **zero known vulnerabilities**. Hosted CI/CodeQL/SBOM, external-provider deployment tests, previous deployed application upgrade, and the operator's staging capacity/failover/backup chain remain unverified. These checks cover the implementation submitted for review, not a published or deployed release candidate.

The next action requires the staging target/domain and a reference to its existing credential source. Production deployment and release publication remain outside this implementation PR.

### Latest completed evidence

Security baseline `252aa7e`: `pnpm audit:all` passed on Node 24 with **188 passed / 20 skipped**, including lint, typechecks, coverage and builds. PostgreSQL 17 service coverage passed **20/20**, mocked Desk browser journeys **12/12**, PostgreSQL-backed Chromium/Firefox journeys **8/8**, and built-server smoke **2/2**. Dependency audit reported zero known vulnerabilities. Hosted CodeQL and external-provider browser OIDC were not run in that local verification.

## Historical component matrix (July baseline)

These estimates predate the September implementation above. They are retained as historical context; current acceptance is tracked by the P1–P6 gates, not these percentages.

| Component | Score | Status and evidence | Remaining boundary |
| --- | ---: | --- | --- |
| Core metadata and domain model | 95% | **Implemented:** DocTypes/modules, exact decimals/currency, computed fields, validators, child records, attachment metadata, localization, typed settings, ownership/row policies, commands, invariants, workflows, permissions, hooks, navigation, and views. | Broader production-adoption evidence. |
| Runtime and command lifecycle | 94% | **Implemented:** CRUD/lifecycle, hooks, atomic bulk commands, compensation, revisions, idempotency, audit/outbox/realtime, and ordered start/close/dispose. | **Partial:** no durable long-running saga coordinator or deeper cancellation propagation. |
| Data, query, and persistence | 88% | **Implemented:** in-memory/Postgres adapters, exact JSONB values, pushed-down numeric query paths, opaque cursors, uniqueness, settings, sealed-secret boundary, revisions, locking, and atomic document/outbox persistence. | **Partial:** load evidence, sharding/partition guidance, and deeper physical-schema modelling. |
| HTTP API and OpenAPI | 92% | **Implemented:** secure routes, localized metadata/settings, commands, fields/children/attachments, operation permissions, idempotency, request IDs, rate limiting, telemetry ports, and split health probes. | **Partial:** version negotiation and pagination envelopes. |
| Authentication and IAM | 78% | **Implemented:** password sessions, cookies, refresh/logout/revocation, lockout, API tokens, roles, audit, identity links, OIDC discovery/JWKS authorization-code/PKCE, invitations, recovery, and tenant/header protections. | **Delegated/partial:** provider-enforced MFA is supported scope; native WebAuthn/TOTP and step-up policy are absent. |
| Schema evolution | 94% | **Implemented:** HTTP/CLI plans, compatibility detection, fingerprints/diffs/checksums, guarded atomic apply/rollback, approved conversion registry, durable approvals/checkpoints, locks, drift/replay guards, and legacy uniqueness backfill. | **Partial:** inspection beyond managed indexes, coordinated dual-read/write rollout, and production-scale migration performance. |
| Jobs, events, and realtime | 85% | **Implemented:** BullMQ, atomic outbox leases, retries/dead letters, idempotency, scheduling, Postgres fanout/replay, SSE, lifecycle, and cancellation. | **Partial:** sustained load/fault evidence, poison-message tooling, and richer scheduler persistence. |
| Desk and admin UI | 90% | **Implemented:** HttpOnly cookie sessions without browser token storage, metadata lists/forms, exact/validator constraints, computed controls, child/attachment lifecycle, localized UI, settings redaction, workflows/admin/customization/operations, and real-stack browser/accessibility journeys. | **Partial:** richer error summaries, keyboard depth, visual-regression policy. |
| SDK, CLI, and developer experience | 88% | **Implemented:** broad HTTP parity, typed errors/safe retries, generated domain types, configuration upgrades, scaffolding, migration commands, and packed standalone consumer proof. | **Delegated:** a packaged Desk template awaits a stable asset/configuration/upgrade contract. |
| Operations, security, and release | 83% | **Implemented:** secure defaults, local/reference Compose data services bound to loopback with a raw-password and percent-encoded connection-URL override contract, resource lifecycle, readiness, OpenTelemetry-compatible adapters/redaction, compatibility testing, provenance publication, dependency audit, CodeQL, Dependabot, and SBOM artifacts. | **Delegated/partial:** production deployments must provision private/managed data services, credentials, exporter configuration, and alert/runbook/SLO policy; sustained fault/load proof is absent. |
| Testing and CI | 90% | **Implemented:** unit, service matrices, service-backed Postgres coverage thresholds, concurrency/fault, built smoke, default/development package-export parity, packed standalone, mocked and full-stack browsers, compatibility matrix, immutable action pins, and coverage gates. | **Partial:** long load/soak, broader failure injection, and visual regression. |
| Documentation and adoption | 76% | **Implemented:** README plus architecture, deployment, security, identity, consistency, querying, migrations, observability, compatibility, contribution, disclosure, support, and release docs. | **Partial:** generated API reference, versioned upgrade guides, and external tutorial feedback. |

## Historical milestone reconciliation (July 2026)

- **P0:** closed, **4/4** issues: #16, #17, #18, and #28.
- **P1:** closed, **8/8** issues: #19 through #25 and #41.
- **P2 Production Maturity:** #26, #27, #39, #40, #42, #45, #46, and #47 were recorded closed; #60 tracked the documentation reconciliation. These are historical records, not a current GitHub issue query.

The expanded P1–P6 implementation plan above now tracks work outside that historical feature scope.

## Verification record

The following evidence was collected for the exact merged baseline above on 2026-07-28. Results are recorded separately from this documentation-only change so they remain auditable:

| Check | Exact result |
| --- | --- |
| `pnpm audit:all` | Node 24; passed lint, recursive typecheck, coverage test run, and all package/CRM/Desk builds. |
| Unit/in-process | **161 passed, 18 skipped**; runtime **37/37** and Nitro **22/22**. |
| Coverage | **68.15% statements, 62.08% branches, 68.93% functions, 70.62% lines** (all above the configured 60/50/60/60 gates). |
| `DATABASE_URL=postgres://framekit:framekit@localhost:5432/framekit REDIS_URL=redis://localhost:6379 pnpm test:services` | Passed against live PostgreSQL 16/Redis 7 and PostgreSQL 17/Redis 8: DB **17/17**, jobs **1/1** in each matrix entry. |
| `pnpm test:smoke:crm:built` | Built CRM assertion suite passed **2/2**. |
| `pnpm smoke:crm:built` | Built CRM smoke passed and terminated cleanly. |
| `pnpm test:desk:browser` | Mocked Desk browser journeys passed **7/7**. |
| `DATABASE_URL=postgres://framekit:framekit@localhost:5432/framekit_desk pnpm test:desk:fullstack` | Live Postgres-backed Desk full-stack suite passed in Chromium and Firefox (**8** journeys; exit 0). |
| `pnpm --filter './packages/**' build && pnpm verify:package-exports` | Passed under Node **22** and Node **24**; verified exports for all **10** public packages in each run. |
| `pnpm verify:standalone` | Packed standalone consumer passed install, typecheck, build, authentication, and built-Nitro CRUD proof. |
| Hosted gates | CI [30332849761](https://github.com/WilliamCorotan/FrameKit/actions/runs/30332849761), CodeQL [30332849759](https://github.com/WilliamCorotan/FrameKit/actions/runs/30332849759), Dependency Security [30332849780](https://github.com/WilliamCorotan/FrameKit/actions/runs/30332849780), and SBOM [30332849774](https://github.com/WilliamCorotan/FrameKit/actions/runs/30332849774) succeeded. |

`pnpm audit:all` does not itself start service containers, run both browser engines, switch Node majors, pack a consumer, or invoke hosted CodeQL/SBOM. Those commands are independently wired in [CI](../.github/workflows/ci.yml), [release](../.github/workflows/release.yml), and the linked successful hosted runs.

### 2026-07-29 stabilization verification

| Check | Exact result |
| --- | --- |
| `pnpm audit:all` | Passed lint, recursive typecheck, unit coverage, and all package/CRM/Desk builds; **178 passed, 19 skipped** without service environment variables. |
| `pnpm test:services:coverage` | Against PostgreSQL 16: **19/19 passed**; DB coverage was **77.04% statements, 68.27% branches, 78.93% functions, and 79.85% lines**. |
| `pnpm test:services` | Against PostgreSQL 16 and Redis 7: DB **17/17** and jobs **1/1** passed. |
| Desk browser verification | Mocked Chromium **12/12**; live PostgreSQL-backed Chromium/Firefox **8/8**, including guarded session bootstrap, cookie-session restoration with empty browser storage, durable logout across rapid reauthentication, expired-session reset, and stale-request isolation across reauthentication. |
| Package/consumer verification | All **10** default/development export surfaces matched on local Node 24; the packed standalone consumer passed install, typecheck, build, authentication, and CRUD smoke. CI retains Node 22/24 export coverage. |
| Frontend templates | All five standalone templates passed install, typecheck, and build; browser journeys passed **6/6**. |
| Compose | Required-variable and special-character password config validation passed; rendered Postgres and Redis host bindings are loopback-only, while Postgres receives the raw password and CRM receives the percent-encoded connection URL. |

Hosted CI, CodeQL, dependency-security, release, and SBOM runs remain required before release promotion; no hosted result is claimed for these stabilization changes.

## Remaining production qualification boundaries

1. Durable sagas fence local PostgreSQL mutations and receipts. External side effects need idempotent outbox consumers; arbitrary hooks are not an external distributed transaction.
2. Local service matrices, a ten-minute component soak, process-kill recovery and an isolated restore drill do not establish a deployment's HTTP capacity, managed-service failover, RPO or RTO.
3. Nitro and H3 remain pre-release dependencies. Keep the locked versions and run compatibility evidence for every upgrade.
4. Operators must provision and rotate real encryption keys and service credentials, preserve historical keys for recovery, and test their actual database/object-store backup chain.
5. Physical inspection covers explicit relational contracts. Application compatibility-window coordination and previous deployed binary upgrades remain application responsibilities.
6. Hosted CI/CodeQL/SBOM and independent production-shaped application acceptance must pass on a named release candidate before promotion.

The accepted metadata/lifecycle and version policy remain in [metadata-compatibility.md](metadata-compatibility.md); deployment responsibilities are in [deployment.md](deployment.md) and [children-and-attachments.md](children-and-attachments.md).

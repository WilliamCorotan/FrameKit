# Framekit Maturity Roadmap

Last reconciled: 2026-07-28, against `515ffdca734d61142539c903b0f35b284f67a18b` (merged #42 baseline).

Framekit is a beta, metadata-driven TypeScript business application framework. The selected metadata, HTTP, persistence, migration, job/realtime, Desk, SDK, and release-gate slices are implemented. This is not a claim of an unqualified production 1.0: the explicitly delegated capabilities and operating evidence below remain necessary for that bar.

## Scoring rubric

Scores are evidence-based engineering estimates, not issue-completion percentages or line coverage. Each component is assessed against this common scale:

- **0%** absent; **25%** contract/prototype; **50%** usable path; **75%** release-candidate depth with focused verification; **100%** production-hardened behavior, operations, compatibility, and documentation.
- **Implemented** means the bounded repository contract is present and tested. **Partial** means a supported path exists but the stated production depth or evidence is missing. **Delegated** means Framekit intentionally exposes a port or operator responsibility rather than pretending to supply that facility.
- A score may rise only with source behavior, focused tests, production-like verification, and user/operator documentation. Coverage is a guardrail, not a score.

## Overall assessment

- Component-average implementation: **88%**.
- Functional breadth: approximately **92%**; production readiness: approximately **82%**.
- Stage: **beta**. The P0 and P1 milestones and all feature issues are closed. [#60](https://github.com/WilliamCorotan/FrameKit/issues/60) is the only open P2 issue and closes with this reconciliation after its reviewed PR is merged.

## Modern framework component matrix

| Component | Score | Status and evidence | Remaining boundary |
| --- | ---: | --- | --- |
| Core metadata and domain model | 95% | **Implemented:** DocTypes/modules, exact decimals/currency, computed fields, validators, child records, attachment metadata, localization, typed settings, ownership/row policies, commands, invariants, workflows, permissions, hooks, navigation, and views. | Broader production-adoption evidence. |
| Runtime and command lifecycle | 94% | **Implemented:** CRUD/lifecycle, hooks, atomic bulk commands, compensation, revisions, idempotency, audit/outbox/realtime, and ordered start/close/dispose. | **Partial:** no durable long-running saga coordinator or deeper cancellation propagation. |
| Data, query, and persistence | 88% | **Implemented:** in-memory/Postgres adapters, exact JSONB values, pushed-down numeric query paths, opaque cursors, uniqueness, settings, sealed-secret boundary, revisions, locking, and atomic document/outbox persistence. | **Partial:** load evidence, sharding/partition guidance, and deeper physical-schema modelling. |
| HTTP API and OpenAPI | 92% | **Implemented:** secure routes, localized metadata/settings, commands, fields/children/attachments, operation permissions, idempotency, request IDs, rate limiting, telemetry ports, and split health probes. | **Partial:** version negotiation and pagination envelopes. |
| Authentication and IAM | 78% | **Implemented:** password sessions, cookies, refresh/logout/revocation, lockout, API tokens, roles, audit, identity links, OIDC discovery/JWKS authorization-code/PKCE, invitations, recovery, and tenant/header protections. | **Delegated/partial:** provider-enforced MFA is supported scope; native WebAuthn/TOTP and step-up policy are absent. |
| Schema evolution | 94% | **Implemented:** HTTP/CLI plans, compatibility detection, fingerprints/diffs/checksums, guarded atomic apply/rollback, approved conversion registry, durable approvals/checkpoints, locks, drift/replay guards, and legacy uniqueness backfill. | **Partial:** inspection beyond managed indexes, coordinated dual-read/write rollout, and production-scale migration performance. |
| Jobs, events, and realtime | 85% | **Implemented:** BullMQ, atomic outbox leases, retries/dead letters, idempotency, scheduling, Postgres fanout/replay, SSE, lifecycle, and cancellation. | **Partial:** sustained load/fault evidence, poison-message tooling, and richer scheduler persistence. |
| Desk and admin UI | 90% | **Implemented:** metadata lists/forms, exact/validator constraints, computed controls, child/attachment lifecycle, localized UI, settings redaction, workflows/admin/customization/operations, and real-stack browser/accessibility journeys. | **Partial:** richer error summaries, keyboard depth, visual-regression policy. |
| SDK, CLI, and developer experience | 88% | **Implemented:** broad HTTP parity, typed errors/safe retries, generated domain types, configuration upgrades, scaffolding, migration commands, and packed standalone consumer proof. | **Delegated:** a packaged Desk template awaits a stable asset/configuration/upgrade contract. |
| Operations, security, and release | 83% | **Implemented:** secure defaults, resource lifecycle, readiness, OpenTelemetry-compatible adapters/redaction, compatibility testing, provenance publication, dependency audit, CodeQL, Dependabot, and SBOM artifacts. | **Delegated/partial:** applications supply exporter configuration, alert/runbook/SLO policy; sustained fault/load proof is absent. |
| Testing and CI | 90% | **Implemented:** unit, service matrices, concurrency/fault, built smoke, package exports, packed standalone, mocked and full-stack browsers, compatibility matrix, and coverage gates. | **Partial:** long load/soak, broader failure injection, and visual regression. |
| Documentation and adoption | 76% | **Implemented:** README plus architecture, deployment, security, identity, consistency, querying, migrations, observability, compatibility, contribution, disclosure, support, and release docs. | **Partial:** generated API reference, versioned upgrade guides, and external tutorial feedback. |

## Milestone reconciliation

- **P0:** closed; #16, #17, and #18 are closed.
- **P1:** closed; #19 through #25 are closed.
- **P2 Production Maturity:** #26, #27, #39, #40, #42, #45, #46, and #47 are closed. #60 is its sole remaining open issue; no feature issue remains open.

The remaining 1.0 work is deliberately outside that closed feature scope: durable saga coordination, native MFA, load/soak/fault evidence, deeper physical-schema drift detection, generated API/versioned upgrade documentation, packaged Desk, and production object-storage/secret adapters.

## Verification record

The following evidence was collected for the exact merged baseline above on 2026-07-28. Results are recorded separately from this documentation-only change so they remain auditable:

| Check | Exact result |
| --- | --- |
| `pnpm audit:all` | Passed lint, recursive typecheck, coverage test run, and all package/CRM/Desk builds. |
| Unit/in-process | **161 passed, 18 skipped**; runtime **37/37** and Nitro **22/22**. |
| Coverage | **68.15% statements, 62.08% branches, 68.93% functions, 70.62% lines** (all above the configured 60/50/60/60 gates). |
| Service matrix | Live PostgreSQL 16 DB **17/17** and Redis 8 jobs **1/1** passed; CI also gates PostgreSQL 17 and Redis 7. |
| Built and browser | Built CRM smoke passed; Desk mocked browser **7/7** and live full-stack Chromium/Firefox **8/8** passed. |
| Packaging/compatibility | Node 22/24 package exports and packed standalone-consumer verification passed. |
| Hosted gates | CI [30332849761](https://github.com/WilliamCorotan/FrameKit/actions/runs/30332849761), CodeQL [30332849759](https://github.com/WilliamCorotan/FrameKit/actions/runs/30332849759), Dependency Security [30332849780](https://github.com/WilliamCorotan/FrameKit/actions/runs/30332849780), and SBOM [30332849774](https://github.com/WilliamCorotan/FrameKit/actions/runs/30332849774) succeeded. |

`pnpm audit:all` does not itself start service containers, run both browser engines, switch Node majors, pack a consumer, or invoke hosted CodeQL/SBOM. Those commands are independently wired in [CI](../.github/workflows/ci.yml), [release](../.github/workflows/release.yml), and the linked successful hosted runs.

## Highest-risk findings

1. Sagas compensate local completed steps but cannot survive a crash as a durable coordinator across external systems.
2. Compatibility tests prove selected functional combinations, not sustained production load, soak behavior, or infrastructure-fault tolerance.
3. Nitro and H3 are pre-release dependencies and need explicit compatibility evidence for every upgrade.
4. Secret and attachment ports fail closed but are not production secret-manager or object-storage implementations; operators must provide those adapters.
5. Physical-schema drift outside managed indexes and automatic compatibility-window coordination are intentionally incomplete.

The accepted metadata/lifecycle and version policy remain in [metadata-compatibility.md](metadata-compatibility.md); deployment responsibilities are in [deployment.md](deployment.md) and [children-and-attachments.md](children-and-attachments.md).

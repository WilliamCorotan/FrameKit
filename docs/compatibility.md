# Compatibility Policy

Framekit tests the following production compatibility matrix. Versions outside these ranges may work, but are not release gates.

| Surface | Supported | Continuous verification |
| --- | --- | --- |
| Node.js | 22 LTS and 24 LTS | Package builds and export checks run on both majors |
| PostgreSQL | 16 and 17 | Durable adapter suites run against both majors |
| Redis | 7 and 8 | BullMQ integration runs against both majors |
| Browsers | Current Chromium and Firefox releases supported by Playwright | Desk smoke and full-stack journeys run in both engines |
| Nitro | `^3.0.260610-beta` | CRM build, standalone consumer, and built-server smoke use the locked version |
| H3 | `^2.0.1-rc.22` | Nitro adapter unit, type, build, and smoke checks use the locked version |

All public packages declare `node >=22 <26`. A change to a supported major, runtime range, protocol, or public TypeScript contract requires tests, release notes, and a semver assessment. Pre-1.0 releases may contain breaking changes only when called out in the changelog and migration notes.

Database migrations must support rolling forward from the latest published minor. Operators should test backups and rollback artifacts before promotion. Browser support means functional behavior and accessibility checks, not pixel-identical rendering.

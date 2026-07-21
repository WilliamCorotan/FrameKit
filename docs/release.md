# Release Policy

Framekit packages are versioned together while the framework is pre-1.0.

Supported package consumers run Node 22 or Node 24. CI imports every public package on both versions and verifies every declared root export exists in the packed artifact.

## Versioning

- Patch: bug fixes, documentation, tests, and compatible internal hardening.
- Minor: new framework features, new APIs, and compatible package capabilities.
- Major: reserved for post-1.0 breaking changes.

Pre-1.0 breaking changes may ship in minor versions, but release notes must call them out explicitly.

## Changelog

Each release should include:

- Added: new framework capabilities.
- Changed: behavior or API changes.
- Fixed: bugs and regressions.
- Migration: required operator or code changes.
- Verification: commands and service-backed smoke checks that passed.

## Candidate Checklist

- `pnpm audit:all` passes.
- Built Nitro server smoke passes.
- Postgres-backed integration checks pass when database behavior changed.
- Redis/BullMQ checks pass when job behavior changed.
- Browser verification passes when Desk UI behavior changed.
- Documentation is updated for new commands, routes, deployment requirements, and migration behavior.
- `pnpm verify:standalone` packs all ten public packages, rejects retained `workspace:` references, installs the tarballs into a disposable generated app, then typechecks, builds, authenticates, and performs CRUD through the built Nitro adapter.

## Scaffold Contract

`framekit create-app <name>` generates a self-contained Nitro server app with published semver ranges matching the CLI version and an independent TypeScript configuration. It is non-destructive by default; `--dry-run` previews writes and `--force` replaces only known generated paths. The starter uses random password salts and production credential validation.

The scaffold does not include Desk. Desk remains a repository application until Framekit can publish a coherent frontend template with stable asset, environment, and upgrade contracts. Documentation must not describe Desk as part of `create-app` before that work exists.

## SDK HTTP Parity

`FRAMEKIT_HTTP_ENDPOINTS` is the explicit parity matrix. A unit test compares it with all public `FramekitClient` methods, covering:

| Surface | Contract |
| --- | --- |
| System | root health, dependency health, metadata, diagnostics, OpenAPI |
| Documents | list/get/create/PATCH/delete/transition, query options, revision and idempotency headers |
| Migrations | typed history, plan input/output, destructive apply option and applied record |
| Auth/admin | password/provider login, refresh/logout, users, roles, tokens, password changes and audit |
| Operations | audit, outbox actions, custom fields, views, realtime history and stream |

## Automated Release

1. Preview a version/changelog update with `pnpm release:prepare -- --version <semver>`.
2. Apply it with `--write`; add `--tag` only from a clean worktree to commit the manifests/changelog and create annotated `v<semver>`.
3. Push the commit and tag. The tag-only Release workflow repeats the Node 22/24 export checks, full audit, and standalone consumer proof.
4. The publish job runs only after those jobs pass, requires the protected `npm` environment, verifies tag/version/changelog agreement, and publishes packages in dependency order with npm provenance.

Normal CI and dry-run commands never invoke `npm publish`. A real release requires both a matching version tag and `NODE_AUTH_TOKEN`; this repository task does not create or publish either.

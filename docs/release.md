# Release Policy

Framekit packages are versioned together while the framework is pre-1.0.

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

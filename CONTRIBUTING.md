# Contributing To Framekit

Framekit requires Node.js 22 or 24 and pnpm 11.9.0. Fork the repository, create a focused branch, and install with `pnpm install --frozen-lockfile`.

Before submitting a pull request, run:

```sh
pnpm lint
pnpm typecheck
pnpm -r --if-present test
pnpm test:coverage
pnpm build
```

Changes to Postgres, Redis, packaging, or the built server should also run the relevant verification commands in `README.md` and `docs/release.md`. Keep public contracts documented and tested, add a changelog entry for user-visible behavior, and avoid unrelated rewrites. Pull requests should explain the problem, approach, compatibility impact, and verification evidence.

Report vulnerabilities through `SECURITY.md`, not a public issue.

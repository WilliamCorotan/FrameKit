# Frontend templates

These five examples are small, idiomatic clients for the same Framekit CRM
backend. Each is deliberately self-contained so its directory can be copied
into an application instead of depending on a shared demo component.

| Template | Package | Start command |
| --- | --- | --- |
| React | `@framekit/example-frontend-react` | `pnpm dev:frontend:react` |
| Vue | `@framekit/example-frontend-vue` | `pnpm dev:frontend:vue` |
| Svelte | `@framekit/example-frontend-svelte` | `pnpm dev:frontend:svelte` |
| Solid | `@framekit/example-frontend-solid` | `pnpm dev:frontend:solid` |
| Vanilla TypeScript | `@framekit/example-frontend-vanilla` | `pnpm dev:frontend:vanilla` |

## Run one

From the repository root, start the in-memory CRM API:

```bash
pnpm dev
```

In a second terminal, start the frontend you want:

```bash
pnpm dev:frontend:react
```

Every template uses same-origin browser requests. Its Vite server proxies
`/api` and `/health` to `FRAMEKIT_PROXY_TARGET`, which defaults to
`http://localhost:3000`. Use `VITE_FRAMEKIT_API_URL` only when deploying
against a separate, CORS-enabled API origin.

The examples use the public `@framekit/sdk` to check API health, authenticate,
read metadata, list customers, and create a customer with an idempotency key.
For the repository CRM example, sign in as `admin@example.com` with the local
development password `admin12345`. The bearer token and password stay in memory
and are discarded on reload or logout.

Replace the demo identity and tenant selection with your application's
production policy. Never ship the development password or persist it in browser
storage.

## Verify all five

```bash
pnpm verify:frontends
pnpm verify:frontends:standalone
```

This runs each framework's strict type checker and production Vite build. The
standalone proof copies every template to a temporary directory, installs
packed Framekit packages, then repeats its typecheck and build without the
monorepo. Root CI runs both checks.

The browser integration suite starts the CRM API plus all five Vite apps, signs
in, and creates a customer through each framework:

```bash
pnpm test:frontends:browser
```

## Copying a template

Copy one framework directory, replace its `workspace:*` SDK dependency with the
published Framekit version used by your server, and keep the environment
contract. The UI is intentionally a compact reference rather than the packaged
Framekit Desk: it owns no server schema, secret storage, or production auth
policy.

# Framekit Vue frontend template

A small, independently copyable Vue 3 + TypeScript client for the Framekit CRM example. It uses the v2 SDK client with an explicit default tenant context and keeps its bearer token only in memory.

## Run it

From the repository root, start the CRM API first:

```sh
pnpm --filter @framekit/example-crm dev
```

Then in a second terminal:

```sh
pnpm --filter @framekit/example-frontend-vue dev
```

Browser requests use the same origin. In development, Vite proxies `/api` and
`/health` to `http://localhost:3000`. Copy `.env.example` to `.env` to change
that target:

```sh
FRAMEKIT_PROXY_TARGET=http://localhost:3000
```

Set `VITE_FRAMEKIT_API_URL` only for a separate API origin whose CORS policy
allows the frontend.

Sign in with the development CRM account:

```text
Email: admin@example.com
Password: admin12345
```

The email is prefilled; neither the password nor bearer token is written to browser storage. Signing out calls the SDK logout endpoint and replaces the in-memory client.

## What it demonstrates

- Public `health()` on initial load, then authenticated `meta()` and `listPage("customer")` after sign-in.
- An accessible customer intake form with name, status, owner, and annual revenue.
- A unique idempotency key for every customer creation request.
- Loading, empty, populated, refresh, success, and typed `FramekitSdkError` states.
- A Vite environment variable with no token or password persistence.

## Checks

```sh
pnpm --filter @framekit/example-frontend-vue typecheck
pnpm --filter @framekit/example-frontend-vue build
```

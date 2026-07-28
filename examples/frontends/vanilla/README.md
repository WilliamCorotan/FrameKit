# Framekit vanilla frontend

A copyable Vite + vanilla TypeScript customer ledger using `@framekit/sdk` v2. It signs in with an in-memory bearer token only; no credentials are persisted in browser storage.

## Run

From the repository root, start the CRM API in one terminal:

```sh
pnpm --filter @framekit/example-crm dev
```

Then start this frontend in another:

```sh
pnpm --filter @framekit/example-frontend-vanilla dev
```

Browser requests use the same origin. In development, Vite proxies `/api` and
`/health` to `http://localhost:3000`. To change that target, copy `.env.example`
to `.env.local` and set `FRAMEKIT_PROXY_TARGET`. Set `VITE_FRAMEKIT_API_URL`
only for a separate, CORS-enabled API origin.

For the development CRM example, sign in with `admin@example.com` and password `admin12345`.

## Checks

```sh
pnpm --filter @framekit/example-frontend-vanilla typecheck
pnpm --filter @framekit/example-frontend-vanilla build
```

The page checks public live health first. After sign-in it reads metadata, fetches the first customer page, and can create a customer with a fresh idempotency key. Signing out calls the API and clears the in-memory client session even if that request fails.

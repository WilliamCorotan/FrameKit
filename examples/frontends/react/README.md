# Framekit React frontend

A copyable Vite + React + TypeScript example for the Framekit CRM app. It uses the SDK's version 2 bearer client with an explicit tenant context. Login tokens and passwords are kept only in memory and are cleared when signing out.

## Run it

From the repository root, first make sure workspace dependencies are installed, then run:

```sh
pnpm --filter @framekit/example-frontend-react dev
```

Browser requests use the same origin. In development, Vite proxies `/api` and
`/health` to `http://localhost:3000`. Copy `.env.example` to `.env.local` to
change the proxy target:

```sh
FRAMEKIT_PROXY_TARGET=http://localhost:3000
```

Set `VITE_FRAMEKIT_API_URL` only for a separate, CORS-enabled API origin. The
target API must expose the CRM `customer` doctype. Sign in with
`admin@example.com`; the CRM demo password is `admin12345`.

## Checks

```sh
pnpm --filter @framekit/example-frontend-react typecheck
pnpm --filter @framekit/example-frontend-react build
```

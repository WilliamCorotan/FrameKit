# Framekit Solid customer ledger

A copyable Vite + SolidJS + TypeScript frontend for the Framekit CRM example. It uses the v2 SDK client with an explicit default tenant context. Browser requests use the same origin; Vite proxies `/api` and `/health` to `FRAMEKIT_PROXY_TARGET` (default: `http://localhost:3000`) in development. Set `VITE_FRAMEKIT_API_URL` only for a separate, CORS-enabled API origin.

```sh
cp .env.example .env
pnpm dev
```

Run the CRM API separately, then open the Vite URL. The template first checks health, then signs in before loading metadata and the first page of `customer` records. The demo account is `admin@example.com` with password `admin12345`. The creation form sends an idempotency key with every request. Its bearer token is kept only in memory and is discarded on sign-out or page reload.

Available commands:

- `pnpm dev`
- `pnpm build`
- `pnpm typecheck`

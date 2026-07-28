# Framekit Svelte customer ledger

A small Vite + Svelte 5 + TypeScript frontend for the Framekit CRM example. It calls the v2 SDK directly, with a deliberate, in-memory bearer session and tenant context—there is no token or password browser storage in this template.

## Run

From the repository root, start the CRM API in one terminal, then start this example in another:

```sh
pnpm --filter @framekit/example-crm dev
pnpm --filter @framekit/example-frontend-svelte dev
```

Browser requests default to the same origin and Vite proxies `/api` and `/health` to `http://localhost:3000` in development. Copy `.env.example` to `.env.local` to change that proxy target, use a CORS-enabled API origin directly, or change its explicit tenant display/context values.

At the sign-in screen, the email defaults to `admin@example.com`. The bundled CRM demo password is `admin12345`.

## What it exercises

- `FramekitClient` configuration version 2
- public `health()` on load, then `login()`, `meta()`, and paginated `listPage("customer")`
- `create("customer", data, { idempotencyKey })`
- `logout()` and in-memory session clearing
- Typed SDK error details for unavailable, invalid, forbidden, conflict, and server responses

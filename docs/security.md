# Deployment Security

Framekit assumes the public API may receive hostile browser and network traffic. The primary threats addressed by the Nitro adapter are forged cross-origin requests, session theft over plaintext transport, untrusted proxy headers, caller-controlled identity, and deployments that accidentally retain example credentials.

## Required Production Settings

Set `NODE_ENV=production` and provision these values through a secret manager or deployment platform, not a committed environment file:

- `FRAMEKIT_AUTH_SECRET`: at least 32 characters from a cryptographically random source. Rotating it invalidates existing signed sessions.
- `FRAMEKIT_ADMIN_EMAIL`: a real, non-example bootstrap administrator address.
- `FRAMEKIT_ADMIN_PASSWORD`: a unique bootstrap passphrase of at least 14 characters. Rotate or disable the bootstrap account after creating named administrator accounts.
- `FRAMEKIT_ALLOWED_ORIGINS`: comma-separated, exact browser origins such as `https://desk.example.com`. Origins include scheme and port and must not contain paths.

The CRM example and generated apps reject missing, weak, placeholder, or example production credentials during startup. `.env.example` is explicitly development-only; `.env.production.example` intentionally leaves secrets blank.

## CORS And Browser Credentials

Credentialed CORS reflects an origin only when it exactly matches the configured allowlist and emits `Access-Control-Allow-Credentials: true`. Framekit rejects a wildcard origin combined with credentials. Requests without an `Origin` header receive no CORS headers, and a disallowed preflight receives `403 CORS_ORIGIN_DENIED`.

Do not treat CORS as authentication. Every protected route still requires a bearer token or signed session cookie and its operation or DocType permissions.

## Cookies And CSRF

Session cookies default to `HttpOnly` and `SameSite=Lax`. In production they default to `Secure`, and Framekit rejects an explicit insecure cookie. `SameSite=None` is also rejected unless `Secure` is enabled.

For every state-changing request authenticated by the session cookie, the adapter requires an `Origin` matching either the canonical request origin or an explicitly trusted/CORS origin. Missing origins receive `403 CSRF_ORIGIN_REQUIRED`; mismatches receive `403 CSRF_ORIGIN_DENIED`. Bearer-authenticated requests are not subject to this cookie-origin check because browsers do not attach bearer tokens automatically.

Use these deployment patterns:

- Same-site Desk and API: retain `SameSite=Lax` or choose `Strict` if the login/navigation flow permits it.
- Cross-site Desk and API: set `FRAMEKIT_COOKIE_SAME_SITE=none`, serve both endpoints over HTTPS, and list the Desk origin explicitly.
- Non-browser clients: prefer bearer tokens. Do not copy browser session cookies into background jobs.

## Reverse Proxies

Forwarded host and protocol headers are ignored for CSRF origin decisions by default. Set `FRAMEKIT_TRUST_PROXY=true` only when the app is reachable exclusively through a trusted reverse proxy that removes client-supplied `X-Forwarded-Host` and `X-Forwarded-Proto` and writes its own values. Otherwise an attacker may forge the canonical origin.

The public proxy must terminate HTTPS, redirect HTTP to HTTPS, preserve the request `Origin`, and use the public host/protocol in its forwarded headers. Production responses include HSTS; validate the `includeSubDomains` policy before sharing a parent domain with HTTP-only services.

## Operational Checklist

1. Generate the auth secret with a cryptographically secure generator and store it outside source control.
2. Provision unique bootstrap credentials and an exact HTTPS origin allowlist.
3. Keep `FRAMEKIT_TRUST_PROXY=false` unless the proxy boundary is controlled and sanitizes forwarded headers.
4. Verify login, cookie attributes, CORS preflight, CSRF rejection, logout, and least-privilege authorization against the deployed public URL.
5. Replace or disable the bootstrap administrator after named accounts and recovery access exist.
6. Restrict Postgres and Redis to private networks, back up durable stores, and monitor authentication failures and audit events.

The adapter also emits `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Cross-Origin-Resource-Policy`, and `Permissions-Policy`; production responses add `Strict-Transport-Security`.

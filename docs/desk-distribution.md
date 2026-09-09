# Distributing Desk

`@framekit/desk-assets` contains prebuilt browser assets and the Node helper `deskAssetsDirectory()`. The package version follows the framework release. Install the same version of Desk and your Framekit backend; the runtime configuration contract is version 1.

Run `framekit install-desk public/desk` from your application directory. Nitro serves this directory at `/desk/`. For a separate API origin, use `--api-url https://api.example.com` and configure that backend's exact allowed browser origin. Desk uses credentialed cookies; configure HTTPS and the appropriate SameSite policy when origins differ. Never put credentials or signing keys in the browser configuration.

The generated `framekit-config.js` loads before the application and contains `window.__FRAMEKIT_CONFIG__ = { version: 1, apiUrl: "..." }`. With no API URL, production defaults to the same origin. Development and full-stack test builds can supply `VITE_FRAMEKIT_API_URL`. The script is external so deployment CSP does not need an inline-script exception. Serve the config and HTML without long-lived immutable caching; hashed assets may be cached immutably.

To upgrade, update the package and run `framekit install-desk public/desk --force`. This replaces generated assets and records `framekit-desk-version.json`, preserving the existing configuration unless `--api-url` is supplied. Keep a copy of the previous generated directory for rollback. Old hashed assets remain so already-open tabs can finish requests; remove them later under your cache/rollback retention policy. `--dry-run` previews writes, and the installer refuses symlink paths and targets outside the current directory.

When hosting assets yourself, use a trailing-slash mount (`/desk/`), serve `index.html`, and keep its relative scripts and assets together. The packaged browser verification mounts the assets at `/desk/` and verifies the configured API origin. Deployment-specific cookie, reverse-proxy, and authentication flows still need verification against your backend.

New server scaffolds can include the same assets with `framekit create-app my-app --desk`; Nitro serves them from `/desk/`. The starter uses development memory adapters and deliberately refuses production startup until durable runtime and authentication stores are configured. Use the CRM production composition and deployment guide as the integration reference.

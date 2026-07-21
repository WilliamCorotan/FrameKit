# SDK Errors, Retries, And Configuration Upgrades

The SDK maps the OpenAPI error envelope and response headers into `FramekitSdkError`. Every SDK error preserves `status`, framework `code`, `details`, `requestId`, and parsed `retryAfterMs` when supplied. Status-specific subclasses are exported for validation, authentication, authorization, not-found, conflict, rate-limit, server, response, transport, protocol, and cancellation failures. `FramekitResponseError` represents a received but otherwise unclassified non-success response. `FramekitProtocolError` represents a successful response that violates its declared protocol, such as malformed SSE data. Once a streaming response exists, protocol, body-read transport, and cancellation errors retain that response's status and request ID. Generated SDK type files re-export this hierarchy.

Retries are disabled by default. Opt in with `retry.maxAttempts` from 1 through 5. Only GET/HEAD/OPTIONS or mutations carrying an `Idempotency-Key` may retry. The SDK retries transport failures, 408, 425, 429, 500, 502, 503, and 504; it never implicitly retries validation, authentication, authorization, not-found, conflict, or a non-idempotent mutation. `Retry-After` takes precedence over exponential delay and is bounded by `maxDelayMs`.

```ts
import { createClient, FramekitValidationError } from "@framekit/sdk";

const client = createClient({
  version: 2,
  baseUrl: "https://app.example",
  retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 2_000 }
});
const controller = new AbortController();
try {
  await client.create("customer", { name: "Acme" }, { idempotencyKey: crypto.randomUUID(), signal: controller.signal });
} catch (error) {
  if (error instanceof FramekitValidationError) console.error(error.code, error.details, error.requestId);
}
```

Version 1 and legacy unversioned configuration remain accepted. Use `upgradeFramekitClientConfig` to produce a deterministic version 2 object plus actionable diagnostics. The upgrade never enables retries automatically. Persist the returned object after review; unsupported future versions fail with an explicit upgrade-order message.

# Lifecycle And Observability

## Resource Lifecycle

`FramekitRuntime.start(signal)` starts configured resources in declaration order. A startup failure closes already-started resources in reverse order. `close()` and `dispose()` shut resources down in reverse order and are idempotent. Postgres stores, Redis queues and workers, outbox/scheduled workers, and realtime publishers expose the same public lifecycle shape.

Pass an `AbortSignal` during startup and to long-running subscriptions or dispatch operations. Shutdown stops new work, aborts active worker contexts where supported, then waits for owned work and connections to close. A closed resource is not restartable; construct a new resource for a new lifecycle.

## Health Endpoints

- `GET /health/live` confirms that the process can serve HTTP. It never probes dependencies.
- `GET /health/ready` runs configured dependency checks and returns `503` when any check fails or exceeds `healthCheckTimeoutMs` (default 2 seconds, maximum 30 seconds).
- `/health` and `/health/dependencies` remain compatibility aliases.

Each dependency check receives an `AbortSignal`. Checks must stop promptly when it aborts and should return only operator-safe details.

## Telemetry

The Nitro adapter emits request logs, duration/count metrics, and spans only when sinks are configured. `createOpenTelemetryAdapters` accepts logger, tracer, and meter objects shaped like OpenTelemetry APIs without adding an exporter dependency. Applications remain responsible for SDK/exporter setup, sampling, batching, network destinations, and shutdown.

Built-in telemetry includes request ID, HTTP method, route path, status, and duration. Error telemetry omits stack traces and recursively redacts authorization, cookies, passwords, secrets, tokens, API keys, bearer values, and JWT-shaped strings. Do not add request bodies, session material, personal data, or tenant data to telemetry attributes. No telemetry leaves the process by default.

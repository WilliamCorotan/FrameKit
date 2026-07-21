# Durable Jobs And Realtime

FrameKit's production delivery contract is **at least once**. `PostgresOutboxStore.claim` atomically leases eligible rows with `FOR UPDATE SKIP LOCKED`, so competing workers do not own the same event concurrently. An expired lease can be reclaimed after a worker crash, which means handlers must remain idempotent.

`dispatchOutboxEvents` passes `{ idempotencyKey: event.id }` to every handler. Use that stable key when calling an external API or enqueueing a BullMQ job. Do not treat a successful side effect followed by a lost acknowledgement as impossible: the event will be delivered again after its lease expires.

Failures use exponential backoff from `baseBackoffMs`. Events become `dead_letter` after `maxAttempts`; operators should alert on and inspect that state before explicitly redriving or resolving the underlying failure. `OutboxDispatcher`, `ScheduledJobRunner`, `BullMqQueue`, and `BullMqWorker` expose `health()` and `close()` so deployments can stop timers and connections during graceful shutdown.

`PostgresRealtimePublisher` persists events before notification. PostgreSQL `LISTEN/NOTIFY` provides low-latency cross-instance fanout, while the table's monotonic cursor provides recovery. Subscription readiness is awaited before replay, notifications trigger an ascending durable-history pump, and only the latest delivered cursor is retained, so fresh and reconnecting streams remain ordered without an unbounded deduplication set. List history with `after=<cursor>` or reconnect SSE with `Last-Event-ID`.

Production wiring should:

1. Run `migrate()` for the outbox and realtime adapters before accepting traffic.
2. Give each dispatcher process a unique `ownerId` and use a lease longer than the normal handler duration.
3. Pass event IDs through every downstream idempotency boundary.
4. Monitor dispatcher, queue, worker, and realtime health plus `failed` and `dead_letter` counts.
5. Call `close()` on shutdown and allow in-flight handlers to settle before the process exits.

The in-memory adapters preserve the same API for tests, but they are not durable and do not coordinate across processes.

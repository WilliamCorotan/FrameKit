# Mutation consistency

Framekit document records expose an integer `revision` that starts at `1`. Every update and workflow transition increments it. Update, delete, and transition commands accept an expected revision; HTTP clients send it in `If-Match`. A stale revision fails with `REVISION_CONFLICT` and does not write document, audit, or outbox state.

Production Postgres runtimes should configure `PostgresMutationUnitOfWork` alongside the read stores. It commits the document change, durable unique-value reservations, audit event, outbox event, and idempotency result in one transaction. Post-write hook failures abort that transaction. Realtime publication happens only after commit; a publication failure is returned to the caller while the pending durable outbox event remains available for dispatch.

## Idempotent retries

Send `Idempotency-Key` for commands that may be retried. Keys are scoped to a tenant and retained in `framekit_idempotency_keys` until explicitly removed by an operator retention policy.

- Create retries use the key and request data as their command identity.
- Update, delete, and transition retries must also send `If-Match`; requests without it fail with `IDEMPOTENCY_REQUIRES_REVISION`.
- Reusing a key with different command data fails with `IDEMPOTENCY_KEY_REUSED`.
- A completed retry returns the original document result without creating another audit or outbox event. A completed delete retry returns success.
- Concurrent requests with the same key are serialized by a transaction-scoped advisory lock. Pre-write hooks may run in each concurrent request, so hooks that call external systems must provide their own idempotency. Durable database effects run once.

The default in-memory runtime follows the same revision, uniqueness, rollback, and retry behavior for local development and tests. Custom combinations of unrelated repository, audit, and outbox implementations do not become atomic automatically; provide a `MutationUnitOfWork` implementation for that backend.

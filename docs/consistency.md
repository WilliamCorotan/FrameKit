# Mutation consistency

Framekit document records expose an integer `revision` that starts at `1`. Every update and workflow transition increments it. Update, delete, and transition commands accept an expected revision; HTTP clients send it in `If-Match`. A stale revision fails with `REVISION_CONFLICT` and does not write document, audit, or outbox state.

Production Postgres runtimes should configure `PostgresMutationUnitOfWork` alongside the read stores. It commits the document change, durable unique-value reservations, audit event, outbox event, and idempotency result in one transaction. Post-write hook failures abort that transaction. Realtime publication happens only after commit; a publication failure is returned to the caller while the pending durable outbox event remains available for dispatch.

The mutation migration creates the durable unique-reservation table for new UOW writes. It cannot infer DocType metadata to backfill rows written by older releases. Before enabling concurrent writes on an upgraded database, retain the existing generated JSONB unique indexes or backfill reservations for legacy records.

## Idempotent retries

Send `Idempotency-Key` for commands that may be retried. Keys are scoped to a tenant and retained in `framekit_idempotency_keys` until explicitly removed by an operator retention policy.

- Create retries use the key and request data as their command identity.
- Update, delete, and transition retries must also send `If-Match`; requests without it fail with `IDEMPOTENCY_REQUIRES_REVISION`.
- Reusing a key with different command data fails with `IDEMPOTENCY_KEY_REUSED`.
- A completed retry returns the original document result without creating another audit or outbox event. A completed delete retry returns success.
- Concurrent requests with the same key are serialized by a transaction-scoped advisory lock. Pre-write hooks may run in each concurrent request, so hooks that call external systems must provide their own idempotency. Durable database effects run once.

The default in-memory runtime follows the same revision, uniqueness, rollback, and retry behavior for local development and tests. Custom combinations of unrelated repository, audit, and outbox implementations do not become atomic automatically; provide a `MutationUnitOfWork` implementation for that backend.

## Bulk and cross-document commands

Modules register command metadata with a stable ID, required permission, allowed DocTypes and operations, execution mode, and operation limit. The HTTP route is `POST /api/commands/{command}` and the SDK method is `executeDocumentCommand()`. Update and delete operations always require an explicit `expectedRevision`; every operation is checked against the command allowlist, DocType permission rules, validation/hooks, uniqueness/link rules, and the optional runtime `commandRowPolicy` before execution.

`atomic` commands require a batch-capable `MutationUnitOfWork`. Postgres writes every affected document, normalized unique reservation, audit event, outbox event, and the command idempotency result in one database transaction. Any revision conflict, hook error, constraint failure, or injected durable-stage failure rolls the whole batch back. Framekit fails with `COMMAND_ATOMICITY_UNAVAILABLE` instead of silently falling back to partial writes. Realtime publication occurs only after commit and is not part of database atomicity.

`saga` commands are explicitly non-atomic. Every operation must declare an allowed compensation operation. Each local step retains its own mutation transaction, revision check, audit, outbox, and derived idempotency key. On failure, completed steps are compensated in reverse order; `COMMAND_SAGA_FAILED` reports the original error and every compensation failure. This is not a durable distributed workflow engine: a process crash between a step and its compensation requires operator recovery from audit/outbox evidence. External systems invoked by hooks are never rolled back by a database transaction and must be independently idempotent.

Operational guidance:

- Keep commands small; metadata defaults to 100 operations and cannot exceed 1,000. Split larger workloads into independently retryable command IDs/keys and monitor database transaction duration and lock waits.
- Use a unique `Idempotency-Key` for each logical command. Reusing it with different operations is rejected; a completed atomic replay returns the original ordered results without duplicate audit/outbox writes.
- Do not target the same document twice in one command. Cross-record ordering dependencies and forward links to records created later in the same batch are intentionally unsupported.
- For saga recovery, inspect `COMMAND_SAGA_FAILED.details.compensationFailures`, the per-record audit trail, and pending outbox events. Repair or replay failed compensations with their expected current revisions; never assume the original command was all-or-nothing.

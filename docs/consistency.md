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

`saga` commands are explicitly non-atomic. Every operation declares an allowed compensation operation. Each local step commits its document, revision check, audit, outbox, and deterministic receipt in its own transaction. Configure `PostgresSagaStore` and `PostgresMutationUnitOfWork` against the same database:

```ts
const sagas = new PostgresSagaStore({ connection });
await sagas.migrate();
const runtime = createRuntime(app, {
  // Include the remaining production adapters as usual.
  repository,
  mutations: new PostgresMutationUnitOfWork({ connection }),
  sagas,
  sagaLeaseMs: 30_000,
});
```

The runtime starts and closes the saga adapter with its other owned resources. A supplied shared PostgreSQL connection remains owned by the composition. Production apps declaring saga commands reject a missing durable journal or a mutation adapter without transactional saga fencing. Development without a journal retains the older in-memory compensation behavior and provides no crash recovery.

## Saga recovery contract

Journaled sagas require an idempotency key. `framekit_sagas` records the tenant/key, initiating user's command fingerprint, original operations, phase, active step, compensation cursor, owner lease, and final receipt. The fingerprint binds the initiating user and original operations; roles and permissions are checked from the current authenticated context on every retry. Modifying the request or changing the initiating user fails with `IDEMPOTENCY_KEY_REUSED`. Successful receipt replay also checks current row visibility and command row policy.

Before a step starts, the runtime records its active index. The mutation transaction locks that journal row and checks owner, unexpired lease, phase, and step before reading a receipt or writing any document. It holds the lock through commit. A new claim or phase transition waits for this lock, so it cannot overtake an uncertain old transaction. A lease may expire while a transaction holds the lock; recovery waits for that transaction, then consults its committed receipt. The old owner cannot checkpoint or start another step after losing its lease.

If forward execution fails, the journal enters `compensating` under the same row lock before inspecting receipts. Recovery includes the active step, even if its commit succeeded but its response or progress checkpoint was lost. Committed steps are compensated in reverse order. Already committed compensation receipts are replayed before preparing another compensation. A failed compensation stops reverse execution, retains its cursor and failure, and releases the lease for a later retry. It never restarts forward execution.

`completed` and `compensated` records are terminal. Completed retries return an authorized receipt; compensated retries fail with `COMMAND_SAGA_TERMINAL`. A post-completion realtime publication failure cannot initiate compensation. Durable outbox events remain available for delivery.

Recovery is triggered by repeating `executeDocumentCommand()` with the same key and original request as the same initiating user, using current authorization. There is no autonomous saga recovery worker. Leases default to 30 seconds and can be configured from 1 millisecond to 15 minutes; use a duration that accommodates normal preparation and hook latency. Each progress checkpoint renews the lease. `COMMAND_SAGA_BUSY` means another owner is active; `COMMAND_SAGA_LEASE_LOST` means this attempt must stop and retry after the current lease becomes available.

The guarantee covers local PostgreSQL document mutations, audit/outbox writes, and receipts. Hooks that contact external systems must implement their own idempotency and recovery. Pre-write hooks can run again after a crash, and a database compensation does not reverse external effects. This coordinator is not a cross-database transaction or a distributed workflow engine.

Operational guidance:

- Keep commands small; metadata defaults to 100 operations and cannot exceed 1,000. Monitor database transaction duration and journal lock waits.
- Use a unique idempotency key for each logical command. Do not target the same document twice; forward links to records created later in a batch remain unsupported.
- Inspect `PostgresSagaStore.get(tenantId, key)`, `COMMAND_SAGA_FAILED.details.compensationFailures`, audit records, and outbox events before retrying a failed saga. Retry the original request after resolving transient failures or restoring the initiating user's required permissions.
- Compensations use the declared expected revisions. A concurrent business change may prevent compensation. Reconcile that conflict through separately authorized business actions; do not silently overwrite newer data, alter the journal's fingerprint, or delete its receipt to force a retry. Such reconciliation is an operator action, not an automatic compensation rewrite.
- Retain saga journals together with their forward and compensation mutation receipts for the entire supported retry period. No automatic saga pruning is provided. Deleting a terminal journal or a mutation receipt can make old keys executable again or make committed outcomes unverifiable. Never prune running or compensating sagas. Expiring replay protection requires an explicit application retention policy and coordinated archival of the journal and its receipts.

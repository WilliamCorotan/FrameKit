# Executable migrations

Framekit uses one executable migration contract for the authenticated HTTP apply route and the CLI `apply-migration`/`replay-migration` commands. Planning is read-only. Applying a plan executes its supported database changes and records history in the same transaction; it never records an unsupported or partially applied plan. `MigrationStore.record()` is a history-import primitive, not the apply path. CLI execution requires independent `--tenant-id` and `--app-name` operator inputs (or `FRAMEKIT_MIGRATION_TENANT_ID` and `FRAMEKIT_MIGRATION_APP_NAME`); identity is never inferred from the artifact being validated.

## Plan and apply state machine

A generated plan includes its tenant and app identity, source and target schema fingerprints, source and target unique-field metadata, ordered changes, and a checksum over that contract. Planning rejects broken metadata references, including unknown link targets and fields referenced by indexes, naming, or workflows. It emits explicit `add_doctype` and `remove_doctype` changes.

Postgres apply proceeds in this order:

1. Validate the artifact shape and checksum, tenant/app identity, destructive-change approval, and supported conversion set.
2. Acquire a transaction-scoped advisory lock for the tenant and app. History, drift, and migration IDs use that same tenant-plus-app scope.
3. Return the existing record for an identical migration ID and checksum, or reject the ID if its checksum differs.
4. Compare the plan's source fingerprint with the latest target fingerprint and reject drift.
5. Detect conflicting legacy values for every target unique field.
6. Execute statements, resynchronize affected normalized unique reservations, preserve or create the generated JSONB unique indexes, and insert the migration record in one transaction.

Concurrent identical applies serialize and become an idempotent replay. Any statement, backfill, or record failure rolls the transaction back. A database created before schema fingerprints has one compatibility transition: an empty legacy target fingerprint is accepted once, after which the hardened fingerprint chain is enforced.

## Rollback and online conversions

Rollback is itself a new, locked migration from the original target fingerprint to its source fingerprint. Adding a field or DocType can be rolled back only with destructive approval because it removes data created after apply. Removing a field or DocType cannot restore deleted values, so Framekit marks those plans as irreversible and refuses automatic rollback.

The atomic apply path still rejects field-type changes. Type-changing plans use `PostgresMigrationStore.applyOnlinePlan()` and include one `MigrationConversion` descriptor per changed field. A descriptor fixes the hook ID, positive integer version, source/target types, and reviewed code digest into the plan checksum. The supplied hook must match all three identity fields. Framekit executes each conversion twice against isolated copies and stops if the results differ; hooks must be deterministic and free of network, clock, random, or cross-document dependencies.

Online apply requires durable approval evidence: approver identity, approval timestamp, outcome, and the exact plan digest. Rejected outcomes are recorded and never execute. `framekit_migration_runs` records the approval, conversion digest, status, error, and a per-conversion document cursor. A changed plan or hook digest is rejected before resume, so an interrupted run must be resumed with the exact reviewed artifact and code.

Documents are transformed in configurable chunks (100 by default) using short transactions and a bounded tenant-plus-app advisory lock. Each chunk and its checkpoint commit together. Concurrent operators serialize, already-completed chunks are not repeated, other tenants and apps have independent run state, and transient serialization/deadlock/lock/connection failures can be retried. A completed transform then applies the remaining metadata/index work and migration-history record atomically. The hook should be idempotent as an additional defense, even though committed checkpoints prevent ordinary replay.

### Safe rollout and recovery

1. Back up the affected tenant data, test the conversion against a production-shaped copy, and record row counts plus representative before/after values.
2. Deploy code that can read both old and new field representations. Pause incompatible writers or make writes dual-compatible before starting the run.
3. Review the generated plan and hook source, calculate the immutable code digest, and issue approval for the exact `plan.checksum`. Never reuse approval after editing either artifact.
4. Start with a conservative `chunkSize`, `lockTimeoutMs`, and `maxRetries`. Monitor `framekit_migration_runs.status`, `checkpoint.processed`, `updated_at`, and `error`, together with database lock wait, transaction latency, deadlock, replication-lag, and application-error metrics.
5. On interruption, keep the compatibility reader deployed, correct the operational cause, and replay the same plan and hook. `failed` is resumable; plan or conversion drift is not. Do not edit checkpoints or digests manually.
6. After `completed`, compare transformed counts and application invariants, then remove compatibility reads in a later deployment.

Online field conversion has no automatic data rollback because the reverse operation requires its own reviewed semantics. Recovery before completion is restore-from-backup or a separately planned, versioned reverse conversion. Retain the run row and approval evidence for audit even after the migration history record is written.

## Upgrade procedure

Before the first hardened apply, back up the database and keep the application on the old write path. Run a generated no-change migration for the deployed app to establish schema fingerprints and resynchronize normalized unique reservations. Apply reports `LEGACY_UNIQUE_CONFLICT` with the DocType, field, value, and document IDs when old rows conflict; resolve those rows and replay the same migration. Existing compatible generated JSONB unique indexes remain in place, and replay does not recreate or duplicate reservations. Missing or legacy predicates are normalized to the runtime contract: absent, null, and empty-string values do not reserve a unique key.

Do not edit migration IDs, checksums, fingerprints, or history rows. The first migration in a database with no prior history cannot prove an arbitrary physical baseline; use a no-change baseline migration after backup and schema review. Continue to require `--allow-destructive` (or `allowDestructive: true`) only during an approved maintenance window.

Generated document indexes are shared physical indexes even though document rows and migration history are tenant-scoped. Deployments that share one document table across tenants must keep DocType schemas aligned and coordinate destructive index changes across every tenant. JSON fields cannot be normalized unique keys; model a scalar canonical key instead.

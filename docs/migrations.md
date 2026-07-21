# Executable migrations

Framekit uses one executable migration contract for the authenticated HTTP apply route and the CLI `apply-migration`/`replay-migration` commands. Planning is read-only. Applying a plan executes its supported database changes and records history in the same transaction; it never records an unsupported or partially applied plan. `MigrationStore.record()` is a history-import primitive, not the apply path.

## Plan and apply state machine

A generated plan includes its tenant and app identity, source and target schema fingerprints, source and target unique-field metadata, ordered changes, and a checksum over that contract. Planning rejects broken metadata references, including unknown link targets and fields referenced by indexes, naming, or workflows. It emits explicit `add_doctype` and `remove_doctype` changes.

Postgres apply proceeds in this order:

1. Validate the artifact shape and checksum, tenant/app identity, destructive-change approval, and supported conversion set.
2. Acquire a transaction-scoped advisory lock for the tenant and app.
3. Return the existing record for an identical migration ID and checksum, or reject the ID if its checksum differs.
4. Compare the plan's source fingerprint with the latest target fingerprint and reject drift.
5. Detect conflicting legacy values for every target unique field.
6. Execute statements, resynchronize affected normalized unique reservations, preserve or create the generated JSONB unique indexes, and insert the migration record in one transaction.

Concurrent identical applies serialize and become an idempotent replay. Any statement, backfill, or record failure rolls the transaction back. A database created before schema fingerprints has one compatibility transition: an empty legacy target fingerprint is accepted once, after which the hardened fingerprint chain is enforced.

## Rollback and conversions

Rollback is itself a new, locked migration from the original target fingerprint to its source fingerprint. Adding a field or DocType can be rolled back only with destructive approval because it removes data created after apply. Removing a field or DocType cannot restore deleted values, so Framekit marks those plans as irreversible and refuses automatic rollback.

Automatic field-type conversion is not supported. Such a plan fails before any SQL or history write. Operators must create and review a purpose-built data migration, verify it against a backup, and then establish the new metadata baseline.

## Upgrade procedure

Before the first hardened apply, back up the database and keep the application on the old write path. Run a generated no-change migration for the deployed app to establish schema fingerprints and resynchronize normalized unique reservations. Apply reports `LEGACY_UNIQUE_CONFLICT` with the DocType, field, value, and document IDs when old rows conflict; resolve those rows and replay the same migration. Existing generated JSONB unique indexes remain in place, and replay does not recreate or duplicate reservations.

Do not edit migration IDs, checksums, fingerprints, or history rows. The first migration in a database with no prior history cannot prove an arbitrary physical baseline; use a no-change baseline migration after backup and schema review. Continue to require `--allow-destructive` (or `allowDestructive: true`) only during an approved maintenance window.

Generated document indexes are shared physical indexes even though document rows and migration history are tenant-scoped. Deployments that share one document table across tenants must keep DocType schemas aligned and coordinate destructive index changes across every tenant. JSON fields cannot be normalized unique keys; model a scalar canonical key instead.

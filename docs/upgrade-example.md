# Versioned application upgrade example

This example describes a v1 → v2 application metadata rollout using the current Framekit APIs. It does not claim compatibility with an untested historical framework binary. The PostgreSQL integration suite exercises the matching additive apply/replay/rollback and approved online-conversion paths.

## Add an optional field

For v1, define a customer with a required text `name`. For v2, keep that contract and add an optional text `region` with default `APAC`. Keep the app name, module ID, and DocType name unchanged. Deploy a compatibility release that tolerates `region` being absent before migrating.

```ts
const planner = createRuntime(v1App, { idGenerator: () => "customer-region-v2" });
const plan = await planner.planMigration(operator, v2App);
const applied = await migrations.applyPlan(operator, plan);
```

Here `operator` is the authenticated tenant context and `migrations` is a migrated `PostgresMigrationStore`. Persist the exact generated artifact/checksum for review and replay. Concurrent application of that same artifact returns one durable migration record. Existing records receive the declared default. New v2 writers should be enabled only after every participating runtime supports the new metadata. Physical generated indexes are shared across tenants, so coordinate schema changes across those tenants.

To recover before v2 writes are enabled, restore the rehearsed backup or explicitly approve rollback:

```ts
await migrations.rollback(operator, applied, {
  id: "customer-region-v2-rollback",
  allowDestructive: true
});
```

Rollback removes `region`, including values written after apply. It is therefore destructive even for this additive upgrade. Return to the v1 write path first. A stale v2 migration plan is rejected after rollback; generate a new reviewed plan from the actual current baseline.

## Convert a field representation

A v2 text `score` → v3 numeric `score` change needs an approved online conversion, not the atomic apply path. Install a frozen conversion-registry entry with an immutable artifact SHA-256, ID, version and self-contained conversion function. Bind `fromType`, `toType`, DocType, field and JSON parameters into the generated plan and recalculate its checksum. Supply durable approval whose `planDigest` equals that checksum to `applyOnlinePlan`.

The compatibility reader must accept both representations until completion. Pause incompatible writers; Framekit does not automatically coordinate application dual writes. A chunk and its checkpoint commit together. After an interruption, restart with the same registry artifact, plan and approval; editing any of them requires a new reviewed run. The integration suite injects interruption and contention, verifies durable checkpoints, and rejects changed artifacts and stale approval.

There is no automatic reverse conversion. Recover from the tested backup or deploy a separately reviewed reverse conversion. See [migration contracts](migrations.md), [backup and recovery](deployment.md), and [the executable PostgreSQL scenarios](../packages/db/src/index.integration.test.ts).

Run the executable scenarios against disposable PostgreSQL with `DATABASE_URL=... pnpm --filter @framekit/db test:integration`. A deployment promotion also requires running its own previous-version application binary against a restored production-shaped dataset.

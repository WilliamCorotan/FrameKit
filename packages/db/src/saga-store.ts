import { FramekitError } from "@framekit/core";
import type { SagaProgress, SagaRecord, SagaStore } from "@framekit/runtime";
import type postgres from "postgres";
import type { Sql } from "postgres";
import { closeAdapterSql, postgresForOptions, runBootstrapMigrations } from "./connection.js";
import type { PostgresRepositoryOptions } from "./types.js";

type SagaRow = {
  tenant_id: string; key: string; command: string; fingerprint: string;
  operations: SagaRecord["operations"]; progress: SagaProgress;
  owner: string | null; lease_until: Date | null; revision: number;
};

/** Uses the same PostgreSQL database as PostgresMutationUnitOfWork. */
export class PostgresSagaStore implements SagaStore {
  private readonly sql: Sql;
  private closePromise?: Promise<void>;

  constructor(options: PostgresRepositoryOptions) { this.sql = postgresForOptions(options); }

  async migrate(): Promise<void> {
    await runBootstrapMigrations(this.sql, `
      create table if not exists framekit_sagas (
        tenant_id text not null, key text not null, command text not null,
        fingerprint text not null, operations jsonb not null, progress jsonb not null,
        owner text, lease_until timestamptz, revision integer not null,
        primary key (tenant_id, key)
      )
    `);
  }

  async start(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); await this.sql`select 1 from framekit_sagas limit 0`; }
  close(): Promise<void> { return this.closePromise ??= closeAdapterSql(this.sql); }
  describe() { return { kind: "postgres-sagas", durable: true, features: ["saga-journal", "mutation-fencing", "terminal-receipts"] }; }

  async get(tenantId: string, key: string): Promise<SagaRecord | undefined> {
    const [row] = await this.sql<SagaRow[]>`select * from framekit_sagas where tenant_id = ${tenantId} and key = ${key}`;
    return row && record(row);
  }

  async claim(input: Parameters<SagaStore["claim"]>[0]): Promise<SagaRecord> {
    const request = structuredClone(input);
    validateLease(request.leaseMs);
    if (!request.tenantId || !request.key || !request.owner || !request.command || !request.fingerprint || request.operations.length === 0) {
      throw new TypeError("Saga claims require identity, command, operations, and fingerprint.");
    }
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([request.tenantId, request.key])}, 7342))`;
      const [current] = await tx<SagaRow[]>`
        select * from framekit_sagas where tenant_id = ${request.tenantId} and key = ${request.key} for update
      `;
      if (current) {
        if (current.fingerprint !== request.fingerprint || current.command !== request.command) {
          throw new FramekitError("IDEMPOTENCY_KEY_REUSED", "Saga key was already used for another command.", 409);
        }
        if (current.progress.phase === "completed" || current.progress.phase === "compensated") return record(current);
        const [claimed] = await tx<SagaRow[]>`
          update framekit_sagas set owner = ${request.owner},
            lease_until = clock_timestamp() + (${request.leaseMs} * interval '1 millisecond'), revision = revision + 1
          where tenant_id = ${request.tenantId} and key = ${request.key}
            and (owner is null or lease_until <= clock_timestamp()) returning *
        `;
        if (!claimed) throw new FramekitError("COMMAND_SAGA_BUSY", "Another worker owns this saga. Retry after its lease expires.", 409);
        return record(claimed);
      }
      const progress: SagaProgress = { phase: "running", nextStep: 0, documents: [] };
      const [created] = await tx<SagaRow[]>`
        insert into framekit_sagas (tenant_id, key, command, fingerprint, operations, progress, owner, lease_until, revision)
        values (${request.tenantId}, ${request.key}, ${request.command}, ${request.fingerprint},
          ${tx.json(request.operations as unknown as postgres.JSONValue)}, ${tx.json(progress as unknown as postgres.JSONValue)}, ${request.owner},
          clock_timestamp() + (${request.leaseMs} * interval '1 millisecond'), 1)
        returning *
      `;
      return record(created!);
    });
  }

  async save(input: Parameters<SagaStore["save"]>[0]): Promise<SagaRecord> {
    const request = structuredClone(input);
    validateLease(request.leaseMs);
    return this.sql.begin(async (tx) => {
      const [current] = await tx<SagaRow[]>`
        select * from framekit_sagas where tenant_id = ${request.tenantId} and key = ${request.key} for update
      `;
      if (!current || current.owner !== request.owner || current.revision !== request.expectedRevision
        || current.progress.phase === "completed" || current.progress.phase === "compensated") throw lostLease();
      validateProgress(request.progress, current.operations.length);
      if (current.progress.phase === "compensating" && !["compensating", "compensated"].includes(request.progress.phase)) {
        throw new TypeError("A compensating saga cannot resume forward execution.");
      }
      if (current.progress.phase === "running" && request.progress.phase === "compensated") {
        throw new TypeError("A saga must enter compensation before becoming compensated.");
      }
      const release = request.release === true || request.progress.phase === "completed" || request.progress.phase === "compensated";
      const [updated] = await tx<SagaRow[]>`
        update framekit_sagas set progress = ${tx.json(request.progress as unknown as postgres.JSONValue)},
          owner = ${release ? null : request.owner},
          lease_until = case when ${release} then null else clock_timestamp() + (${request.leaseMs} * interval '1 millisecond') end,
          revision = revision + 1
        where tenant_id = ${request.tenantId} and key = ${request.key}
          and owner = ${request.owner} and revision = ${request.expectedRevision} and lease_until > clock_timestamp()
        returning *
      `;
      if (!updated) throw lostLease();
      return record(updated);
    });
  }
}

function record(row: SagaRow): SagaRecord {
  return {
    ...row.progress, tenantId: row.tenant_id, key: row.key, command: row.command, fingerprint: row.fingerprint,
    operations: row.operations, owner: row.owner ?? undefined, leaseUntil: row.lease_until?.toISOString(), revision: row.revision
  };
}

function validateLease(leaseMs: number): void {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 900_000) throw new TypeError("Saga lease must be 1 to 900000 milliseconds.");
}

function validateProgress(progress: SagaProgress, length: number): void {
  if (!["running", "compensating", "completed", "compensated"].includes(progress.phase)
    || !Number.isSafeInteger(progress.nextStep) || progress.nextStep < 0 || progress.nextStep > length
    || progress.documents.length > length) throw new TypeError("Invalid saga progress.");
  if (progress.phase === "running" && progress.activeStep !== undefined
    && (progress.activeStep !== progress.nextStep || progress.activeStep >= length)) throw new TypeError("Invalid active saga step.");
  if ((progress.phase === "compensating" || progress.phase === "compensated")
    && (!Number.isSafeInteger(progress.compensationIndex) || progress.compensationIndex! < -1 || progress.compensationIndex! >= length)) throw new TypeError("Invalid saga compensation cursor.");
  if (progress.phase === "completed" && (progress.nextStep !== length || progress.documents.length !== length)) throw new TypeError("Incomplete saga receipt.");
  if (progress.phase === "compensated" && progress.compensationIndex !== -1) throw new TypeError("Incomplete saga compensation.");
}

function lostLease(): FramekitError {
  return new FramekitError("COMMAND_SAGA_LEASE_LOST", "Saga ownership expired or changed. Resume with the original command request.", 409);
}

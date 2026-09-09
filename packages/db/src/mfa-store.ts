import type { MfaFactor, MfaStore } from "@framekit/auth";
import type { Sql } from "postgres";
import { closeAdapterSql, postgresForOptions } from "./connection.js";
import type { PostgresRepositoryOptions } from "./types.js";
const DEFAULT_ATTEMPT_LIMIT = 5;
const DEFAULT_ATTEMPT_WINDOW_MS = 5 * 60_000;

/** Durable, shared MFA factor state. Call migrate before serving requests. */
export class PostgresMfaStore implements MfaStore {
  private readonly sql: Sql;
  private closed = false;

  constructor(
    options: PostgresRepositoryOptions,
    private readonly limit = DEFAULT_ATTEMPT_LIMIT,
    private readonly windowMs = DEFAULT_ATTEMPT_WINDOW_MS
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("MFA attempt limit must be a positive safe integer.");
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new TypeError("MFA attempt window must be a positive safe integer.");
    this.sql = postgresForOptions(options);
  }

  async migrate(): Promise<void> {
    await this.sql`create table if not exists framekit_mfa_factors (tenant_id text not null, user_id text not null, revision integer not null, factor jsonb not null, expires_at timestamptz, primary key (tenant_id, user_id))`;
    await this.sql`create table if not exists framekit_mfa_attempts (tenant_id text not null, user_id text not null, count integer not null, expires_at timestamptz not null, primary key (tenant_id, user_id))`;
  }

  async start(): Promise<void> { await this.sql`select 1`; }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await closeAdapterSql(this.sql);
  }

  describe() { return { kind: "postgres-mfa", durable: true, features: ["cas", "rate-limit"] }; }

  async get(tenantId: string, userId: string): Promise<MfaFactor | undefined> {
    const [row] = await this.sql<{ factor: MfaFactor }[]>`select factor from framekit_mfa_factors where tenant_id = ${tenantId} and user_id = ${userId}`;
    return row?.factor;
  }
  async compareAndSet(next: MfaFactor, expectedRevision: number | undefined, expiresAt?: number): Promise<boolean> {
    if (!Number.isSafeInteger(next.revision)) return false;
    if (expectedRevision !== undefined && !Number.isSafeInteger(expectedRevision)) return false;
    if (next.revision !== (expectedRevision ?? 0) + 1) return false;
    if (expiresAt !== undefined && !Number.isSafeInteger(expiresAt)) return false;

    const factor = structuredClone(next);
    const deadline = expiresAt === undefined ? null : new Date(expiresAt).toISOString();
    return this.sql.begin(async (tx) => {
      // Serialize absent-row creation too, then wait for any existing row lock
      // before evaluating the write deadline. A pre-lock WHERE can expire while waiting.
      await tx`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([factor.tenantId, factor.userId])}, 7341))`;
      const [current] = await tx<{ revision: number }[]>`
        select revision from framekit_mfa_factors where tenant_id = ${factor.tenantId} and user_id = ${factor.userId} for update
      `;
      if (current?.revision !== expectedRevision) return false;
      if (expectedRevision === undefined) {
        const rows = await tx`
          insert into framekit_mfa_factors (tenant_id, user_id, revision, factor, expires_at)
          select ${factor.tenantId}, ${factor.userId}, ${factor.revision}, ${tx.json(factor)}, null
          where (${deadline}::timestamptz is null or clock_timestamp() < ${deadline}::timestamptz)
          on conflict do nothing returning revision
        `;
        return rows.length === 1;
      }
      const rows = await tx`
        update framekit_mfa_factors set revision = ${factor.revision}, factor = ${tx.json(factor)}, expires_at = null
        where tenant_id = ${factor.tenantId} and user_id = ${factor.userId} and revision = ${expectedRevision}
          and (${deadline}::timestamptz is null or clock_timestamp() < ${deadline}::timestamptz)
        returning revision
      `;
      return rows.length === 1;
    });
  }

  async allowAttempt(tenantId: string, userId: string): Promise<boolean> {
    const [row] = await this.sql<{ count: number }[]>`
      insert into framekit_mfa_attempts (tenant_id, user_id, count, expires_at)
      values (${tenantId}, ${userId}, 1, clock_timestamp() + (${this.windowMs} * interval '1 millisecond'))
      on conflict (tenant_id, user_id) do update
      set count = case when framekit_mfa_attempts.expires_at <= clock_timestamp() then 1 else framekit_mfa_attempts.count + 1 end,
          expires_at = case when framekit_mfa_attempts.expires_at <= clock_timestamp() then clock_timestamp() + (${this.windowMs} * interval '1 millisecond') else framekit_mfa_attempts.expires_at end
      where framekit_mfa_attempts.expires_at <= clock_timestamp() or framekit_mfa_attempts.count < ${this.limit}
      returning count`;
    return row !== undefined;
  }

  /** Operational retention task; factor tombstones are deliberately never pruned. */
  async pruneExpiredAttempts(limit = 1000): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new TypeError("Retention limit must be a safe integer from 1 through 10000.");
    }
    const rows = await this.sql`
      with expired as (
        select ctid from framekit_mfa_attempts
        where expires_at <= clock_timestamp()
        order by expires_at
        limit ${limit}
        for update skip locked
      )
      delete from framekit_mfa_attempts as attempts
      using expired
      where attempts.ctid = expired.ctid
      returning attempts.tenant_id`;
    return rows.length;
  }
}

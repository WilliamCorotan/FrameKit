import postgres, { type Sql } from "postgres";
import type { PostgresRepositoryOptions } from "./types.js";

const sharedSql = new WeakSet<Sql>();

export type PostgresConnection = {
  sql: Sql;
  /** Separate codec profile; both pools together are bounded by max. */
  drizzleSql: Sql;
  close(): Promise<void>;
};

export function createPostgresConnection(input: { connectionString: string; max: number; listenerConnections?: number; totalBudget?: number }): PostgresConnection {
  if (!Number.isInteger(input.max) || input.max < 2) throw new Error("Postgres connection max must be an integer of at least two for raw and ORM codec profiles.");
  const listeners = input.listenerConnections ?? 0;
  if (!Number.isInteger(listeners) || listeners < 0) throw new Error("Postgres listener connections must be a non-negative integer.");
  const total = input.max + listeners;
  if (input.totalBudget !== undefined && (!Number.isInteger(input.totalBudget) || input.totalBudget < total)) {
    throw new Error("Postgres connection budget is smaller than the requested query and listener connections.");
  }
  assertPostgresUrl(input.connectionString);
  let sql: Sql;
  let drizzleSql: Sql;
  try {
    sql = postgres(input.connectionString, { max: Math.ceil(input.max / 2) });
    drizzleSql = postgres(input.connectionString, { max: Math.floor(input.max / 2) });
  }
  catch { throw new Error("Invalid Postgres connection configuration."); }
  sharedSql.add(sql);
  sharedSql.add(drizzleSql);
  let closing: Promise<void> | undefined;
  return {
    sql,
    drizzleSql,
    close() {
      closing ??= Promise.allSettled([sql.end({ timeout: 5 }), drizzleSql.end({ timeout: 5 })]).then((results) => {
        const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason);
        if (errors.length) throw new AggregateError(errors, "Postgres connection shutdown failed.");
      });
      return closing;
    }
  };
}

export function postgresForOptions(options: PostgresRepositoryOptions): Sql {
  if (options.connection) return options.connection.sql;
  assertPostgresUrl(options.connectionString);
  return postgres(options.connectionString, { max: options.max ?? 5 });
}

export async function closeAdapterSql(sql: Sql, timeout = 5): Promise<void> {
  if (!sharedSql.has(sql)) await sql.end({ timeout });
}

/** Static framework bootstrap DDL only; application migrations retain their own locking. */
export async function runBootstrapMigrations(sql: Sql, ...statements: string[]): Promise<void> {
  await sql.begin(async (tx) => {
    // Shared with other Framekit bootstrap adapters, including S3 lease storage.
    await tx`select pg_advisory_xact_lock(1718774644, 1)`;
    for (const statement of statements) await tx.unsafe(statement);
  });
}

/** Require an explicit host and database instead of allowing an absent URL to select driver defaults. */
export function assertPostgresUrl(value: string): void {
  try {
    if (typeof value !== "string" || !value.trim()) throw new Error();
    const parts = value.match(/^(postgres(?:ql)?:\/\/)([^/?#]+)(\/[^?#]+)(?:[?#].*)?$/);
    if (!parts) throw new Error();
    const authority = parts[2]!;
    const credentialsEnd = authority.lastIndexOf("@") + 1;
    const credentials = authority.slice(0, credentialsEnd);
    for (const host of authority.slice(credentialsEnd).split(",")) {
      const url = new URL(parts[1] + credentials + host + parts[3]);
      if (!host || !url.hostname || url.pathname.length <= 1) throw new Error();
    }
  } catch { throw new Error("An explicit PostgreSQL connection URL with a host and database name is required."); }
}

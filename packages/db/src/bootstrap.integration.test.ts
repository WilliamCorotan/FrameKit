import postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  createPostgresConnection, PostgresDocumentRepository, PostgresMutationUnitOfWork,
  PostgresUserStore, PostgresRoleStore, PostgresApiTokenStore, PostgresSessionRevocationStore,
  PostgresAuthIdentityLinkStore, PostgresAuthLifecycleTokenStore, PostgresOidcAuthorizationStateStore,
  PostgresAuthAuditStore, PostgresAuditStore, PostgresOutboxStore, PostgresRealtimePublisher,
  PostgresCustomizationStore, PostgresNamingSeriesStore, PostgresMigrationStore,
  PostgresMfaStore, PostgresSagaStore
} from "./index.js";
import { runBootstrapMigrations } from "./connection.js";

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("concurrent framework bootstrap", () => {
  async function fixture(run: (url: string) => Promise<void>) {
    const admin = postgres(connectionString!, { max: 1, onnotice: () => undefined });
    const schema = `bootstrap_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      await admin`create schema ${admin(schema)}`;
      const url = new URL(connectionString!);
      url.searchParams.set("search_path", schema);
      await run(url.toString());
    } finally {
      await admin`drop schema if exists ${admin(schema)} cascade`;
      await admin.end();
    }
  }

  it("serializes independent startup groups in an empty schema without needing an ORM connection", async () => {
    await fixture(async (url) => {
      const groups = Array.from({ length: 3 }, () => createPostgresConnection({ connectionString: url, max: 2 }));
      try {
        await Promise.all(groups.map(async (connection) => {
          const options = { connectionString: url, connection };
          const repository = new PostgresDocumentRepository(options);
          const adapters = [
            new PostgresMutationUnitOfWork(options), new PostgresUserStore(options), new PostgresRoleStore(options),
            new PostgresApiTokenStore(options), new PostgresSessionRevocationStore(options),
            new PostgresAuthIdentityLinkStore(options), new PostgresAuthLifecycleTokenStore(options),
            new PostgresOidcAuthorizationStateStore(options), new PostgresAuthAuditStore(options),
            new PostgresAuditStore(options), new PostgresOutboxStore(options), new PostgresRealtimePublisher(options),
            new PostgresCustomizationStore(options), new PostgresNamingSeriesStore(options),
            new PostgresMigrationStore(options), new PostgresMfaStore(options), new PostgresSagaStore(options)
          ];
          const heldOrm = await connection.drizzleSql.reserve();
          try {
            // Document bootstrap remains the prerequisite for mutation bookkeeping.
            await repository.migrate();
            await Promise.all(adapters.map((adapter) => adapter.migrate()));
          } finally {
            heldOrm.release();
            await Promise.all([repository, ...adapters].map((adapter) => adapter.close()));
          }
          // Borrowers must not close their shared connection while bootstrapping.
          expect((await connection.sql`select count(*)::int as count from framekit_documents`)[0]?.count).toBe(0);
          expect((await connection.sql`select count(*)::int as count from framekit_mfa_factors`)[0]?.count).toBe(0);
          expect((await connection.sql`select count(*)::int as count from framekit_sagas`)[0]?.count).toBe(0);
        }));
      } finally {
        await Promise.all(groups.map((group) => group.close()));
      }
    });
  }, 20_000);

  it("rolls back partial bootstrap and releases the lock for another connection after failure", async () => {
    await fixture(async (url) => {
      const first = postgres(url, { max: 1 });
      const second = postgres(url, { max: 1 });
      try {
        await expect(runBootstrapMigrations(first, "create table bootstrap_partial (id int)", "select 1 / 0")).rejects.toMatchObject({ code: "22012" });
        expect((await first`select to_regclass('bootstrap_partial') as table_name`)[0]?.table_name).toBeNull();
        await runBootstrapMigrations(second, "create table bootstrap_partial (id int)");
        expect((await second`select count(*)::int as count from bootstrap_partial`)[0]?.count).toBe(0);
      } finally {
        await Promise.all([first.end(), second.end()]);
      }
    });
  }, 10_000);
});

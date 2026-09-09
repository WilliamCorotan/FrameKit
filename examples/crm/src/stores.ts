import { configuredDatabaseUrl } from "./database.js";
import { InMemoryMfaStore, InMemoryApiTokenStore, InMemoryOidcAuthorizationStateStore, InMemoryRoleStore, InMemoryUserStore } from "@framekit/auth";
import {
  type PostgresConnection,
  PostgresMfaStore,
  PostgresSagaStore,
  PostgresApiTokenStore,
  PostgresAuthAuditStore,
  PostgresAuthIdentityLinkStore,
  PostgresAuthLifecycleTokenStore,
  PostgresAuditStore,
  PostgresCustomizationStore,
  PostgresDocumentRepository,
  PostgresMigrationStore,
  PostgresMutationUnitOfWork,
  PostgresNamingSeriesStore,
  PostgresOidcAuthorizationStateStore,
  PostgresOutboxStore,
  PostgresRealtimePublisher,
  PostgresRoleStore,
  PostgresSessionRevocationStore,
  PostgresUserStore
} from "@framekit/db";
import { InMemoryEventBus } from "@framekit/realtime";
import { createBootstrapAdmin } from "./bootstrap.js";

export function storageMode(): "memory" | "postgres" {
  return configuredDatabaseUrl() ? "postgres" : "memory";
}

type StoreOptions = { connection?: PostgresConnection; register?: (resource: { close(): Promise<void> }) => void };

export async function createRuntimePersistence(options: StoreOptions = {}) {
  const databaseUrl = configuredDatabaseUrl();
  if (!databaseUrl) return {};
  const repository = new PostgresDocumentRepository({ connectionString: databaseUrl, connection: options.connection });
  const audit = new PostgresAuditStore({ connectionString: databaseUrl, connection: options.connection });
  const outbox = new PostgresOutboxStore({ connectionString: databaseUrl, connection: options.connection });
  const customization = new PostgresCustomizationStore({ connectionString: databaseUrl, connection: options.connection });
  const namingSeries = new PostgresNamingSeriesStore({ connectionString: databaseUrl, connection: options.connection });
  const migrations = new PostgresMigrationStore({ connectionString: databaseUrl, connection: options.connection });
  const mutations = new PostgresMutationUnitOfWork({ connectionString: databaseUrl, connection: options.connection });
  const sagas = new PostgresSagaStore({ connectionString: databaseUrl, connection: options.connection });
  for (const resource of [repository, audit, outbox, customization, namingSeries, migrations, mutations, sagas]) options.register?.(resource);
  await repository.migrate();
  await audit.migrate();
  await outbox.migrate();
  await customization.migrate();
  await namingSeries.migrate();
  await migrations.migrate();
  await mutations.migrate();
  await sagas.migrate();
  return { repository, audit, outbox, customization, namingSeries, migrations, mutations, sagas };
}

export async function createRealtimePublisher(options: StoreOptions = {}) {
  const databaseUrl = configuredDatabaseUrl();
  if (!databaseUrl) return new InMemoryEventBus();
  const realtime = new PostgresRealtimePublisher({ connectionString: databaseUrl, connection: options.connection });
  options.register?.(realtime);
  await realtime.migrate();
  return realtime;
}

export async function createAuthStores(email: string, password: string, options: StoreOptions = {}) {
  const databaseUrl = configuredDatabaseUrl();
  const administrator = { id: "administrator", tenantId: "default", name: "Administrator", permissions: ["*"] };
  const admin = await createBootstrapAdmin(email, password);
  if (!databaseUrl) {
    const attempts = new Map<string, { count: number; expiresAt: number }>();
    const mfaStore = new InMemoryMfaStore();
    const allowMfaAttempt = (tenantId: string, userId: string) => {
      const key = JSON.stringify([tenantId, userId]);
      const current = attempts.get(key);
      const row = current && current.expiresAt > Date.now() ? current : { count: 0, expiresAt: Date.now() + 300_000 };
      if (row.count >= 5) return false;
      row.count++;
      attempts.set(key, row);
      return true;
    };
    return {
      mfaStore, allowMfaAttempt,
      userStore: new InMemoryUserStore([admin]), roleStore: new InMemoryRoleStore([administrator]),
      apiTokenStore: new InMemoryApiTokenStore([]), oidcStateStore: new InMemoryOidcAuthorizationStateStore()
    };
  }
  const mfaStore = new PostgresMfaStore({ connectionString: databaseUrl, connection: options.connection });
  const userStore = new PostgresUserStore({ connectionString: databaseUrl, connection: options.connection });
  const roleStore = new PostgresRoleStore({ connectionString: databaseUrl, connection: options.connection });
  const apiTokenStore = new PostgresApiTokenStore({ connectionString: databaseUrl, connection: options.connection });
  const sessionRevocations = new PostgresSessionRevocationStore({ connectionString: databaseUrl, connection: options.connection });
  const identityLinks = new PostgresAuthIdentityLinkStore({ connectionString: databaseUrl, connection: options.connection });
  const lifecycleTokens = new PostgresAuthLifecycleTokenStore({ connectionString: databaseUrl, connection: options.connection });
  const audit = new PostgresAuthAuditStore({ connectionString: databaseUrl, connection: options.connection });
  const oidcStateStore = new PostgresOidcAuthorizationStateStore({ connectionString: databaseUrl, connection: options.connection });
  for (const resource of [mfaStore, userStore, roleStore, apiTokenStore, sessionRevocations, identityLinks, lifecycleTokens, audit, oidcStateStore]) options.register?.(resource);
  await mfaStore.migrate();
  await userStore.migrate();
  await roleStore.migrate();
  await apiTokenStore.migrate();
  await sessionRevocations.migrate();
  await identityLinks.migrate();
  await lifecycleTokens.migrate();
  await audit.migrate();
  await oidcStateStore.migrate();
  await userStore.insertIfAbsent(admin);
  await roleStore.insertIfAbsent(administrator);
  return { mfaStore, allowMfaAttempt: (tenantId: string, userId: string) => mfaStore.allowAttempt(tenantId, userId), userStore, roleStore, apiTokenStore, sessionRevocations, identityLinks, lifecycleTokens, audit, oidcStateStore };
}

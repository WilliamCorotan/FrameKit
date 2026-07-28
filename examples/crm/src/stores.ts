import { InMemoryApiTokenStore, InMemoryOidcAuthorizationStateStore, InMemoryRoleStore, InMemoryUserStore } from "@framekit/auth";
import {
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

const databaseUrl = process.env.DATABASE_URL;

export async function createRuntimePersistence() {
  if (!databaseUrl) return {};
  const repository = new PostgresDocumentRepository({ connectionString: databaseUrl });
  const audit = new PostgresAuditStore({ connectionString: databaseUrl });
  const outbox = new PostgresOutboxStore({ connectionString: databaseUrl });
  const customization = new PostgresCustomizationStore({ connectionString: databaseUrl });
  const namingSeries = new PostgresNamingSeriesStore({ connectionString: databaseUrl });
  const migrations = new PostgresMigrationStore({ connectionString: databaseUrl });
  const mutations = new PostgresMutationUnitOfWork({ connectionString: databaseUrl });
  await repository.migrate();
  await audit.migrate();
  await outbox.migrate();
  await customization.migrate();
  await namingSeries.migrate();
  await migrations.migrate();
  await mutations.migrate();
  return { repository, audit, outbox, customization, namingSeries, migrations, mutations };
}

export async function createRealtimePublisher() {
  if (!databaseUrl) return new InMemoryEventBus();
  const realtime = new PostgresRealtimePublisher({ connectionString: databaseUrl });
  await realtime.migrate();
  return realtime;
}

export async function createAuthStores(email: string, password: string) {
  const administrator = { id: "administrator", tenantId: "default", name: "Administrator", permissions: ["*"] };
  const admin = await createBootstrapAdmin(email, password);
  if (!databaseUrl) {
    return {
      userStore: new InMemoryUserStore([admin]), roleStore: new InMemoryRoleStore([administrator]),
      apiTokenStore: new InMemoryApiTokenStore([]), oidcStateStore: new InMemoryOidcAuthorizationStateStore()
    };
  }
  const userStore = new PostgresUserStore({ connectionString: databaseUrl });
  const roleStore = new PostgresRoleStore({ connectionString: databaseUrl });
  const apiTokenStore = new PostgresApiTokenStore({ connectionString: databaseUrl });
  const sessionRevocations = new PostgresSessionRevocationStore({ connectionString: databaseUrl });
  const identityLinks = new PostgresAuthIdentityLinkStore({ connectionString: databaseUrl });
  const lifecycleTokens = new PostgresAuthLifecycleTokenStore({ connectionString: databaseUrl });
  const audit = new PostgresAuthAuditStore({ connectionString: databaseUrl });
  const oidcStateStore = new PostgresOidcAuthorizationStateStore({ connectionString: databaseUrl });
  await userStore.migrate();
  await roleStore.migrate();
  await apiTokenStore.migrate();
  await sessionRevocations.migrate();
  await identityLinks.migrate();
  await lifecycleTokens.migrate();
  await audit.migrate();
  await oidcStateStore.migrate();
  if (!(await userStore.findByEmail(admin.email))) await userStore.upsert(admin);
  await roleStore.upsert(administrator);
  return { userStore, roleStore, apiTokenStore, sessionRevocations, identityLinks, lifecycleTokens, audit, oidcStateStore };
}

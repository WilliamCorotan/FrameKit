import { S3Client } from "@aws-sdk/client-s3";
import { createPostgresConnection } from "@framekit/db";
import { createAesGcmSettingsSecrets, S3AttachmentStorage } from "@framekit/storage";
import { productionConfiguration } from "./production.js";
import { assertSecureProductionCredentials } from "@framekit/nitro";
import { createRuntime } from "@framekit/runtime";
import { createAuth } from "./auth.js";
import { app } from "./domain.js";
import { createDemoSeeder } from "./seed.js";
import { createRealtimePublisher, createRuntimePersistence } from "./stores.js";

const environment = process.env.NODE_ENV ?? "development";
const authSecret = process.env.FRAMEKIT_AUTH_SECRET ?? "development-secret-change-me";
const bootstrapEmail = process.env.FRAMEKIT_ADMIN_EMAIL ?? "admin@example.com";
const bootstrapPassword = process.env.FRAMEKIT_ADMIN_PASSWORD ?? "admin12345";

assertSecureProductionCredentials({
  environment,
  authSecret,
  bootstrap: { email: bootstrapEmail, password: bootstrapPassword }
});

const configuration = productionConfiguration(process.env);
const connection = configuration.databaseUrl ? createPostgresConnection({
  connectionString: configuration.databaseUrl, max: configuration.poolMax,
  listenerConnections: 1, totalBudget: configuration.connectionBudget
}) : undefined;
const resources: Array<{ close(): Promise<void> }> = [];
const register = (resource: { close(): Promise<void> }) => { resources.push(resource); };
let closing: Promise<void> | undefined;
export function closeApplication(): Promise<void> {
  closing ??= (async () => {
    const failures: unknown[] = [];
    for (const resource of [...resources].reverse()) {
      try { await resource.close(); } catch (error) { failures.push(error); }
    }
    try { await connection?.close(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "Application shutdown failed.");
  })();
  return closing;
}

async function initialize() {
  try {
    const storeOptions = { connection, register };
    const persistence = await createRuntimePersistence(storeOptions);
    const eventBus = await createRealtimePublisher(storeOptions);
    let attachmentStorage: S3AttachmentStorage | undefined;
    if (configuration.bucket && connection) {
      const client = new S3Client({ region: configuration.region, endpoint: configuration.endpoint, forcePathStyle: Boolean(configuration.endpoint) });
      register({ async close() { client.destroy(); } });
      attachmentStorage = new S3AttachmentStorage({ sql: connection.sql, client, bucket: configuration.bucket, namespace: app.name });
      register(attachmentStorage);
      await attachmentStorage.migrate();
    }
    const runtime = createRuntime(app, { ...persistence, deployment: configuration.production ? "production" : "development", realtime: eventBus, attachmentStorage, settingsSecrets: configuration.settingsSecrets });
    // Runtime owns adapter lifecycle after construction; auth stores remain separately owned.
    const runtimeResources = new Set<unknown>([...Object.values(persistence), eventBus, attachmentStorage]);
    for (let index = resources.length - 1; index >= 0; index--) {
      if (runtimeResources.has(resources[index])) resources.splice(index, 1);
    }
    register(runtime);
    const auth = await createAuth({ secret: authSecret, email: bootstrapEmail, password: bootstrapPassword, storeOptions, mfaSecrets: configuration.settingsSecrets ?? (connection ? undefined : createAesGcmSettingsSecrets({ activeKeyId: "development", keys: { development: crypto.getRandomValues(new Uint8Array(32)) } })) });
    await runtime.start();
    return { runtime, eventBus, auth };
  } catch (error) {
    try { await closeApplication(); } catch (closeError) { throw new AggregateError([error, closeError], "Application startup failed."); }
    throw error;
  }
}

export const { runtime, eventBus, auth } = await initialize();
export const seedDemo = configuration.production ? async () => {} : createDemoSeeder(runtime);

export { app, contactDocType, crmModule, customerDocType, dealDocType } from "./domain.js";

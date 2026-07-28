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

const persistence = await createRuntimePersistence();
export const eventBus = await createRealtimePublisher();
export const runtime = createRuntime(app, { ...persistence, realtime: eventBus });
export const auth = await createAuth({ secret: authSecret, email: bootstrapEmail, password: bootstrapPassword });

export const seedDemo = createDemoSeeder(runtime);

export { app, contactDocType, crmModule, customerDocType, dealDocType } from "./domain.js";

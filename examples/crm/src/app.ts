import { hashPassword, InMemoryApiTokenStore, InMemoryRoleStore, InMemoryUserStore, PasswordAuthService } from "@framekit/auth";
import { defineApp, defineDocType, defineModule, type TenantContext } from "@framekit/core";
import { createRuntime } from "@framekit/runtime";
import {
  PostgresApiTokenStore,
  PostgresAuditStore,
  PostgresCustomizationStore,
  PostgresDocumentRepository,
  PostgresMigrationStore,
  PostgresMutationUnitOfWork,
  PostgresNamingSeriesStore,
  PostgresOutboxStore,
  PostgresRoleStore,
  PostgresSessionRevocationStore,
  PostgresUserStore
} from "@framekit/db";
import { InMemoryEventBus } from "@framekit/realtime";

export const customerDocType = defineDocType({
  name: "customer",
  label: "Customer",
  description: "Companies and people you sell to.",
  naming: { field: "name" },
  fields: [
    { name: "name", label: "Name", type: "text", required: true, inList: true },
    { name: "status", label: "Status", type: "select", options: ["active", "paused"], default: "active", inList: true },
    { name: "owner", label: "Owner", type: "text", default: "Sales", inList: true },
    { name: "annual_revenue", label: "Annual Revenue", type: "currency", default: 0, inList: true },
    { name: "notes", label: "Notes", type: "long_text" }
  ],
  permissions: [
    { action: "create", permissions: ["crm.customer.write"] },
    { action: "read", permissions: ["crm.customer.read"] },
    { action: "update", permissions: ["crm.customer.write"] },
    { action: "delete", roles: ["administrator"] }
  ]
});

export const contactDocType = defineDocType({
  name: "contact",
  label: "Contact",
  description: "People attached to customers.",
  fields: [
    { name: "full_name", label: "Full Name", type: "text", required: true, inList: true },
    { name: "email", label: "Email", type: "text", inList: true },
    { name: "customer", label: "Customer", type: "link", linkTo: "customer", inList: true },
    { name: "is_primary", label: "Primary", type: "boolean", default: false, inList: true }
  ],
  permissions: [
    { action: "create", permissions: ["crm.contact.write"] },
    { action: "read", permissions: ["crm.contact.read"] },
    { action: "update", permissions: ["crm.contact.write"] }
  ]
});

export const dealDocType = defineDocType({
  name: "deal",
  label: "Deal",
  description: "Revenue opportunities with a workflow.",
  naming: { prefix: "DEAL", series: true, digits: 5 },
  fields: [
    { name: "title", label: "Title", type: "text", required: true, inList: true },
    { name: "customer", label: "Customer", type: "link", linkTo: "customer", inList: true },
    { name: "amount", label: "Amount", type: "currency", default: 0, inList: true },
    { name: "stage", label: "Stage", type: "select", options: ["open", "qualified", "won", "lost"], default: "open", readOnly: true, inList: true }
  ],
  permissions: [
    { action: "create", permissions: ["crm.deal.write"] },
    { action: "read", permissions: ["crm.deal.read"] },
    { action: "update", permissions: ["crm.deal.write"] },
    { action: "transition", permissions: ["crm.deal.write"] }
  ],
  workflow: {
    field: "stage",
    initialState: "open",
    states: ["open", "qualified", "won", "lost"],
    transitions: [
      { action: "qualify", from: ["open"], to: "qualified", permissions: ["crm.deal.write"] },
      { action: "win", from: ["open", "qualified"], to: "won", permissions: ["crm.deal.write"] },
      { action: "lose", from: ["open", "qualified"], to: "lost", permissions: ["crm.deal.write"] }
    ]
  }
});

export const crmModule = defineModule({
  id: "crm",
  name: "CRM",
  version: "0.1.0",
  description: "A compact sales workspace proving Framekit metadata, CRUD, permissions, and workflows.",
  doctypes: [customerDocType, contactDocType, dealDocType],
  permissions: ["crm.customer.read", "crm.customer.write", "crm.contact.read", "crm.contact.write", "crm.deal.read", "crm.deal.write"],
  navigation: [
    { label: "Customers", path: "/doctype/customer", icon: "building", order: 10 },
    { label: "Contacts", path: "/doctype/contact", icon: "user", order: 20 },
    { label: "Deals", path: "/doctype/deal", icon: "pipeline", order: 30 }
  ],
  hooks: {
    beforeInsert: {
      customer: [
        ({ input }) => {
          if (input && typeof input.name === "string") {
            input.name = input.name.trim();
          }
        }
      ]
    }
  }
});

export const app = defineApp({
  name: "Framekit CRM",
  version: "0.1.0",
  modules: [crmModule]
});

const repository = await createRepository();
const audit = await createAuditStore();
const outbox = await createOutboxStore();
const customization = await createCustomizationStore();
const namingSeries = await createNamingSeriesStore();
const migrations = await createMigrationStore();
const mutations = await createMutationUnitOfWork();
const userStore = await createUserStore();
const roleStore = await createRoleStore();
const apiTokenStore = await createApiTokenStore();
const sessionRevocations = await createSessionRevocationStore();
export const eventBus = new InMemoryEventBus();
export const runtime = createRuntime(app, {
  ...(repository ? { repository } : {}),
  ...(audit ? { audit } : {}),
  ...(outbox ? { outbox } : {}),
  ...(customization ? { customization } : {}),
  ...(namingSeries ? { namingSeries } : {}),
  ...(migrations ? { migrations } : {}),
  ...(mutations ? { mutations } : {}),
  realtime: eventBus
});
export const auth = new PasswordAuthService({
  secret: process.env.FRAMEKIT_AUTH_SECRET ?? "development-secret-change-me",
  userStore,
  roleStore,
  apiTokenStore,
  sessionRevocations
});

const admin: TenantContext = {
  tenantId: "default",
  userId: "seed",
  roles: ["administrator"],
  permissions: ["*"]
};

let seeded = false;

export async function seedDemo(): Promise<void> {
  if (seeded) {
    return;
  }
  seeded = true;
  const existing = await runtime.list(admin, "customer", { search: "Acme Manufacturing", limit: 1 });
  if (existing.length > 0) {
    return;
  }
  const acme = await runtime.create(admin, "customer", {
    name: "Acme Manufacturing",
    status: "active",
    owner: "Mina Torres",
    annual_revenue: 1200000,
    notes: "Pilot customer for the metadata desk."
  });
  await runtime.create(admin, "contact", {
    full_name: "Rowan Ibarra",
    email: "rowan@example.com",
    customer: acme.id,
    is_primary: true
  });
  await runtime.create(admin, "deal", {
    title: "Factory rollout",
    customer: acme.id,
    amount: 84000
  });
}

async function createRepository() {
  if (!process.env.DATABASE_URL) {
    return undefined;
  }
  const postgres = new PostgresDocumentRepository({
    connectionString: process.env.DATABASE_URL
  });
  await postgres.migrate();
  return postgres;
}

async function createAuditStore() {
  if (!process.env.DATABASE_URL) {
    return undefined;
  }
  const audit = new PostgresAuditStore({
    connectionString: process.env.DATABASE_URL
  });
  await audit.migrate();
  return audit;
}

async function createOutboxStore() {
  if (!process.env.DATABASE_URL) {
    return undefined;
  }
  const outbox = new PostgresOutboxStore({
    connectionString: process.env.DATABASE_URL
  });
  await outbox.migrate();
  return outbox;
}

async function createCustomizationStore() {
  if (!process.env.DATABASE_URL) {
    return undefined;
  }
  const customization = new PostgresCustomizationStore({
    connectionString: process.env.DATABASE_URL
  });
  await customization.migrate();
  return customization;
}

async function createNamingSeriesStore() {
  if (!process.env.DATABASE_URL) {
    return undefined;
  }
  const namingSeries = new PostgresNamingSeriesStore({
    connectionString: process.env.DATABASE_URL
  });
  await namingSeries.migrate();
  return namingSeries;
}

async function createMigrationStore() {
  if (!process.env.DATABASE_URL) {
    return undefined;
  }
  const migrations = new PostgresMigrationStore({
    connectionString: process.env.DATABASE_URL
  });
  await migrations.migrate();
  return migrations;
}

async function createMutationUnitOfWork() {
  if (!process.env.DATABASE_URL) return undefined;
  const mutations = new PostgresMutationUnitOfWork({ connectionString: process.env.DATABASE_URL });
  await mutations.migrate();
  return mutations;
}

async function createUserStore() {
  const admin = {
    id: "admin",
    tenantId: "default",
    email: process.env.FRAMEKIT_ADMIN_EMAIL ?? "admin@example.com",
    name: "Framekit Admin",
    passwordHash: await hashPassword(process.env.FRAMEKIT_ADMIN_PASSWORD ?? "admin12345", "framekit-dev-salt"),
    roles: ["administrator"],
    permissions: ["*"]
  };
  if (!process.env.DATABASE_URL) {
    return new InMemoryUserStore([admin]);
  }
  const store = new PostgresUserStore({
    connectionString: process.env.DATABASE_URL
  });
  await store.migrate();
  if (!(await store.findByEmail(admin.email))) {
    await store.upsert(admin);
  }
  return store;
}

async function createRoleStore() {
  const administrator = {
    id: "administrator",
    tenantId: "default",
    name: "Administrator",
    permissions: ["*"]
  };
  if (!process.env.DATABASE_URL) {
    return new InMemoryRoleStore([administrator]);
  }
  const store = new PostgresRoleStore({
    connectionString: process.env.DATABASE_URL
  });
  await store.migrate();
  await store.upsert(administrator);
  return store;
}

async function createApiTokenStore() {
  if (!process.env.DATABASE_URL) {
    return new InMemoryApiTokenStore([]);
  }
  const store = new PostgresApiTokenStore({
    connectionString: process.env.DATABASE_URL
  });
  await store.migrate();
  return store;
}

async function createSessionRevocationStore() {
  if (!process.env.DATABASE_URL) {
    return undefined;
  }
  const store = new PostgresSessionRevocationStore({
    connectionString: process.env.DATABASE_URL
  });
  await store.migrate();
  return store;
}

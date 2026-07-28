import type { TenantContext } from "@framekit/core";
import { createRuntime } from "@framekit/runtime";

type Runtime = ReturnType<typeof createRuntime>;
type DemoRuntime = Pick<Runtime, "create" | "list">;

const admin: TenantContext = { tenantId: "default", userId: "seed", roles: ["administrator"], permissions: ["*"] };

export function createDemoSeeder(runtime: DemoRuntime): () => Promise<void> {
  let seeded = false;
  let seeding: Promise<void> | undefined;

  return async () => {
    if (seeded) return;
    if (seeding) return seeding;
    seeding = seedDemoData(runtime).then(() => {
      seeded = true;
    }).finally(() => {
      seeding = undefined;
    });
    return seeding;
  };
}

export async function seedDemoData(runtime: DemoRuntime): Promise<void> {
  const customer = await findOrCreateCustomer(runtime);
  await findOrCreateContact(runtime, customer.id);
  await findOrCreateDeal(runtime, customer.id);
}

async function findOrCreateCustomer(runtime: DemoRuntime) {
  const [existing] = await runtime.list(admin, "customer", { filters: { name: "Acme Manufacturing" }, limit: 1 });
  return existing ?? runtime.create(admin, "customer", {
    name: "Acme Manufacturing", status: "active", owner: "Mina Torres", annual_revenue: "1200000.00", notes: "Pilot customer for the metadata desk."
  });
}

async function findOrCreateContact(runtime: DemoRuntime, customer: string) {
  const [existing] = await runtime.list(admin, "contact", { filters: { customer, email: "rowan@example.com" }, limit: 1 });
  if (!existing) {
    await runtime.create(admin, "contact", { full_name: "Rowan Ibarra", email: "rowan@example.com", customer, is_primary: true });
  }
}

async function findOrCreateDeal(runtime: DemoRuntime, customer: string) {
  const [existing] = await runtime.list(admin, "deal", { filters: { customer, title: "Factory rollout" }, limit: 1 });
  if (!existing) {
    await runtime.create(admin, "deal", { title: "Factory rollout", customer, amount: "84000.00" });
  }
}

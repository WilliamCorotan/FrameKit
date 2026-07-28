import type { TenantContext } from "@framekit/core";
import { createRuntime } from "@framekit/runtime";

type Runtime = ReturnType<typeof createRuntime>;

const admin: TenantContext = { tenantId: "default", userId: "seed", roles: ["administrator"], permissions: ["*"] };
let seeded = false;

export async function seedDemoData(runtime: Runtime): Promise<void> {
  if (seeded) return;
  seeded = true;
  const existing = await runtime.list(admin, "customer", { search: "Acme Manufacturing", limit: 1 });
  if (existing.length > 0) return;
  const acme = await runtime.create(admin, "customer", {
    name: "Acme Manufacturing", status: "active", owner: "Mina Torres", annual_revenue: "1200000.00", notes: "Pilot customer for the metadata desk."
  });
  await runtime.create(admin, "contact", { full_name: "Rowan Ibarra", email: "rowan@example.com", customer: acme.id, is_primary: true });
  await runtime.create(admin, "deal", { title: "Factory rollout", customer: acme.id, amount: "84000.00" });
}

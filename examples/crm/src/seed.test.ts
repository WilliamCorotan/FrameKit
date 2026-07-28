import { createRuntime } from "@framekit/runtime";
import { describe, expect, it } from "vitest";
import { app } from "./domain.js";
import { createDemoSeeder } from "./seed.js";

describe("createDemoSeeder", () => {
  it("shares concurrent work and repairs a partially seeded demo", async () => {
    const runtime = createRuntime(app);
    const seed = createDemoSeeder(runtime);

    await Promise.all([seed(), seed(), seed()]);
    await seed();

    const admin = { tenantId: "default", userId: "test", roles: ["administrator"], permissions: ["*"] };
    await expect(runtime.list(admin, "customer")).resolves.toHaveLength(1);
    await expect(runtime.list(admin, "contact")).resolves.toHaveLength(1);
    await expect(runtime.list(admin, "deal")).resolves.toHaveLength(1);
  });

  it("adds missing contact and deal when the demo customer already exists", async () => {
    const runtime = createRuntime(app);
    const admin = { tenantId: "default", userId: "test", roles: ["administrator"], permissions: ["*"] };
    await runtime.create(admin, "customer", {
      name: "Acme Manufacturing", status: "active", owner: "Mina Torres", annual_revenue: "1200000.00", notes: "Pilot customer for the metadata desk."
    });

    await createDemoSeeder(runtime)();

    await expect(runtime.list(admin, "customer")).resolves.toHaveLength(1);
    await expect(runtime.list(admin, "contact")).resolves.toHaveLength(1);
    await expect(runtime.list(admin, "deal")).resolves.toHaveLength(1);
  });

  it("allows retry after a failed in-flight seed", async () => {
    let attempts = 0;
    const runtime = {
      list: async () => {
        if (attempts++ === 0) throw new Error("transient failure");
        return [];
      },
      create: async (_tenant: unknown, doctype: string) => ({ id: `${doctype}-id` })
    } as unknown as ReturnType<typeof createRuntime>;
    const seed = createDemoSeeder(runtime);

    await expect(seed()).rejects.toThrow("transient failure");
    await expect(seed()).resolves.toBeUndefined();
    expect(attempts).toBeGreaterThan(1);
  });
});

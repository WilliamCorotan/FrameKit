import { describe, expect, it } from "vitest";
import { defineApp, defineDocType, defineModule, type TenantContext } from "@framekit/core";
import { createRuntime } from "@framekit/runtime";
import { dispatchOutboxEvents, retryFailedOutboxEvents, ScheduledJobRegistry } from "./index.js";

const tenant: TenantContext = {
  tenantId: "tenant_1",
  userId: "admin",
  roles: ["administrator"],
  permissions: ["crm.customer"]
};

describe("dispatchOutboxEvents", () => {
  it("dispatches pending events and marks them complete", async () => {
    const runtime = createRuntime(
      defineApp({
        name: "Jobs",
        modules: [
          defineModule({
            id: "crm",
            name: "CRM",
            doctypes: [
              defineDocType({
                name: "customer",
                label: "Customer",
                fields: [{ name: "name", label: "Name", type: "text", required: true }],
                permissions: [{ action: "create", permissions: ["crm.customer"] }]
              })
            ]
          })
        ]
      })
    );
    await runtime.create(tenant, "customer", { name: "Dispatch Co" });

    const result = await dispatchOutboxEvents(runtime, tenant, async () => undefined);
    const events = await runtime.outboxEvents(tenant);

    expect(result).toMatchObject({ inspected: 1, dispatched: 1, failed: 0, skipped: 0 });
    expect(events[0]?.status).toBe("dispatched");
  });

  it("marks failed dispatches as failed", async () => {
    const runtime = createRuntime(
      defineApp({
        name: "Failures",
        modules: [
          defineModule({
            id: "crm",
            name: "CRM",
            doctypes: [
              defineDocType({
                name: "customer",
                label: "Customer",
                fields: [{ name: "name", label: "Name", type: "text", required: true }],
                permissions: [{ action: "create", permissions: ["crm.customer"] }]
              })
            ]
          })
        ]
      })
    );
    await runtime.create(tenant, "customer", { name: "Failure Co" });

    const result = await dispatchOutboxEvents(runtime, tenant, async () => {
      throw new Error("webhook offline");
    });
    const events = await runtime.outboxEvents(tenant);

    expect(result).toMatchObject({ inspected: 1, dispatched: 0, failed: 1, skipped: 0 });
    expect(events[0]).toMatchObject({ status: "failed", attempts: 1, error: "webhook offline" });
  });

  it("retries failed dispatches until max attempts", async () => {
    const runtime = createRuntime(
      defineApp({
        name: "Retries",
        modules: [
          defineModule({
            id: "crm",
            name: "CRM",
            doctypes: [
              defineDocType({
                name: "customer",
                label: "Customer",
                fields: [{ name: "name", label: "Name", type: "text", required: true }],
                permissions: [{ action: "create", permissions: ["crm.customer"] }]
              })
            ]
          })
        ]
      })
    );
    await runtime.create(tenant, "customer", { name: "Retry Co" });
    await dispatchOutboxEvents(runtime, tenant, async () => {
      throw new Error("offline");
    });

    const retried = await retryFailedOutboxEvents(runtime, tenant, async () => undefined, { maxAttempts: 3 });
    const skipped = await retryFailedOutboxEvents(runtime, tenant, async () => undefined, { maxAttempts: 2 });

    expect(retried).toMatchObject({ inspected: 1, dispatched: 1, failed: 0, skipped: 0 });
    expect(skipped).toMatchObject({ inspected: 0, dispatched: 0, failed: 0, skipped: 0 });
  });

  it("registers and runs scheduled jobs", async () => {
    const registry = new ScheduledJobRegistry();
    let runs = 0;

    registry.register({ name: "outbox.dispatch", schedule: "*/5 * * * *", handler: () => { runs += 1; } });
    await registry.run("outbox.dispatch");

    expect(runs).toBe(1);
    expect(registry.list()).toEqual([{ name: "outbox.dispatch", schedule: "*/5 * * * *" }]);
  });
});

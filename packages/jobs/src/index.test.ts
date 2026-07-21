import { describe, expect, it } from "vitest";
import { defineApp, defineDocType, defineModule, type TenantContext } from "@framekit/core";
import { createRuntime } from "@framekit/runtime";
import { dispatchOutboxEvents, InMemoryQueue, OutboxDispatcher, retryFailedOutboxEvents, ScheduledJobRegistry, ScheduledJobRunner } from "./index.js";

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
    }, { baseBackoffMs: 0 });

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

  it("atomically leases events across competing dispatchers and supplies a stable idempotency key", async () => {
    const runtime = createJobsRuntime("Competing Workers");
    await Promise.all(Array.from({ length: 6 }, (_, index) => runtime.create(tenant, "customer", { name: `Customer ${index}` })));
    const handled: string[] = [];
    const handler = async (event: { id: string }, context: { idempotencyKey: string }) => {
      expect(context.idempotencyKey).toBe(event.id);
      handled.push(event.id);
    };

    const [left, right] = await Promise.all([
      dispatchOutboxEvents(runtime, tenant, handler, { ownerId: "left" }),
      dispatchOutboxEvents(runtime, tenant, handler, { ownerId: "right" })
    ]);

    expect(left.dispatched + right.dispatched).toBe(6);
    expect(new Set(handled).size).toBe(6);
  });

  it("backs off retries, dead-letters exhausted events, and closes runners without timers", async () => {
    const runtime = createJobsRuntime("Dead Letters");
    await runtime.create(tenant, "customer", { name: "Terminal Co" });
    const now = "2026-07-21T00:00:00.000Z";
    await dispatchOutboxEvents(runtime, tenant, async () => { throw new Error("offline"); }, {
      ownerId: "worker-a", maxAttempts: 2, baseBackoffMs: 1_000, now
    });
    expect(await dispatchOutboxEvents(runtime, tenant, async () => undefined, {
      ownerId: "worker-b", maxAttempts: 2, now: "2026-07-21T00:00:00.999Z"
    })).toMatchObject({ inspected: 0 });
    await dispatchOutboxEvents(runtime, tenant, async () => { throw new Error("still offline"); }, {
      ownerId: "worker-b", maxAttempts: 2, baseBackoffMs: 1_000, now: "2026-07-21T00:00:01.000Z"
    });
    expect((await runtime.outboxEvents(tenant))[0]).toMatchObject({ status: "dead_letter", attempts: 2 });

    const dispatcher = new OutboxDispatcher(runtime, tenant, async () => undefined, { intervalMs: 5 });
    dispatcher.start();
    expect(await dispatcher.health()).toMatchObject({ ok: true, details: { running: true } });
    await dispatcher.close();
    expect(await dispatcher.health()).toMatchObject({ details: { running: false } });

    const registry = new ScheduledJobRegistry();
    let runs = 0;
    registry.register({ name: "minute", schedule: "*/5 * * * *", handler: () => { runs += 1; } });
    const runner = new ScheduledJobRunner(registry, 5);
    expect(await runner.runDue(new Date("2026-07-21T00:10:00.000Z"))).toEqual(["minute"]);
    expect(await runner.runDue(new Date("2026-07-21T00:10:30.000Z"))).toEqual([]);
    expect(runs).toBe(1);
    runner.start();
    await runner.close();
  });

  it("sweeps already-exhausted failed events into dead-letter state", async () => {
    const runtime = createJobsRuntime("Exhausted Failures");
    await runtime.create(tenant, "customer", { name: "Stranded Co" });
    const [event] = await runtime.outboxEvents(tenant);
    await runtime.markOutboxFailed(tenant, event!.id, "first failure");
    await runtime.markOutboxFailed(tenant, event!.id, "second failure");

    await expect(dispatchOutboxEvents(runtime, tenant, async () => undefined, {
      ownerId: "sweeper", maxAttempts: 2, now: "2026-07-21T00:00:00.000Z"
    })).resolves.toMatchObject({ inspected: 0, dispatched: 0 });
    await expect(runtime.outboxEvents(tenant)).resolves.toEqual([
      expect.objectContaining({ id: event!.id, status: "dead_letter", attempts: 2, error: "second failure" })
    ]);
  });

  it("propagates worker cancellation and supports disposable queues", async () => {
    const runtime = createJobsRuntime("Cancellation");
    await runtime.create(tenant, "customer", { name: "Abort Co" });
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    await dispatchOutboxEvents(runtime, tenant, async (_event, context) => {
      observedSignal = context.signal;
    }, { signal: controller.signal });
    expect(observedSignal).toBe(controller.signal);

    const dispatcher = new OutboxDispatcher(runtime, tenant, async () => undefined, { intervalMs: 5 });
    dispatcher.start(controller.signal);
    controller.abort();
    await dispatcher.dispose();
    expect(await dispatcher.health()).toMatchObject({ details: { running: false } });

    const queue = new InMemoryQueue();
    await queue.start();
    await queue.dispose();
    await expect(queue.enqueue("closed", {})).rejects.toThrow("closed");
  });
});

function createJobsRuntime(name: string) {
  return createRuntime(defineApp({
    name,
    modules: [defineModule({
      id: "crm",
      name: "CRM",
      doctypes: [defineDocType({
        name: "customer",
        label: "Customer",
        fields: [{ name: "name", label: "Name", type: "text", required: true }],
        permissions: [{ action: "create", permissions: ["crm.customer"] }]
      })]
    })]
  }));
}

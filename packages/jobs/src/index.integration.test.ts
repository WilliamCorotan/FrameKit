import { QueueEvents } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BullMqQueue, BullMqWorker, type JobPayload } from "./index.js";

declare const process: { env: Record<string, string | undefined>; pid: number };

const redisUrl = process.env.REDIS_URL;

describe.skipIf(!redisUrl)("BullMQ queue integration", () => {
  const queueName = `framekit-jobs-integration-${process.pid}`;
  const queue = new BullMqQueue(queueName, redisUrl!);
  const events = new QueueEvents(queueName, { connection: { url: redisUrl! } });
  const processed: Array<{ worker: string; payload: JobPayload }> = [];
  const handler = (worker: string) => async (name: string, payload: JobPayload) => {
    if (name === "fail") throw new Error("planned failure");
    processed.push({ worker, payload });
  };
  const left = new BullMqWorker(queueName, redisUrl!, handler("left"));
  const right = new BullMqWorker(queueName, redisUrl!, handler("right"));

  beforeAll(async () => {
    await Promise.all([events.waitUntilReady(), left.health(), right.health()]);
  });

  afterAll(async () => {
    await Promise.all([left.close(), right.close(), events.close()]);
    await (queue as unknown as { queue: { obliterate(options: { force: true }): Promise<void> } }).queue.obliterate({ force: true });
    await queue.close();
  });

  it("coordinates two workers without duplicate jobs and records failures", async () => {
    const failed = waitForQueueEvent(events, "failed");
    await Promise.all(Array.from({ length: 10 }, (_, index) => queue.enqueue(
      "sync.customer",
      { customerId: `cust_${index}` },
      { idempotencyKey: `customer-${index}`, attempts: 2, backoffMs: 5 }
    )));
    await queue.enqueue("sync.customer", { customerId: "duplicate" }, { idempotencyKey: "customer-0" });
    await queue.enqueue("fail", { customerId: "failure" }, { attempts: 1 });
    await failed;
    await waitFor(() => processed.length === 10);

    expect(new Set(processed.map(({ payload }) => payload.customerId)).size).toBe(10);
    expect(await queue.health()).toMatchObject({ ok: true });
    expect(await left.health()).toMatchObject({ ok: true });
    expect(await right.health()).toMatchObject({ ok: true });
  });
});

function waitForQueueEvent(events: QueueEvents, eventName: "failed") {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for BullMQ ${eventName} event`));
    }, 10_000);
    const onEvent = (event: unknown) => {
      cleanup();
      resolve(event);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      events.off(eventName, onEvent);
    };
    events.once(eventName, onEvent);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for competing BullMQ workers");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

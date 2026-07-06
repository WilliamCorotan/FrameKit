import { QueueEvents, Worker } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";
import { BullMqQueue, type JobPayload } from "./index.js";

declare const process: { env: Record<string, string | undefined>; pid: number };

const redisUrl = process.env.REDIS_URL;

describe.skipIf(!redisUrl)("BullMQ queue integration", () => {
  const queueName = `framekit-jobs-integration-${process.pid}`;
  const queue = new BullMqQueue(queueName, redisUrl!);
  const events = new QueueEvents(queueName, { connection: { url: redisUrl! } });
  const processed: JobPayload[] = [];
  const worker = new Worker(
    queueName,
    async (job) => {
      if (job.name === "fail") {
        throw new Error("planned failure");
      }
      processed.push(job.data);
      return { ok: true };
    },
    { connection: { url: redisUrl! } }
  );

  afterAll(async () => {
    await worker.close();
    await events.close();
    await (queue as unknown as { queue: { obliterate(options: { force: true }): Promise<void>; close(): Promise<void> } }).queue.obliterate({ force: true });
    await (queue as unknown as { queue: { close(): Promise<void> } }).queue.close();
  });

  it("executes successful jobs and records failures", async () => {
    await events.waitUntilReady();
    await worker.waitUntilReady();

    const queueResults = Promise.all([
      waitForQueueEvent(events, "completed"),
      waitForQueueEvent(events, "failed")
    ]);

    await queue.enqueue("sync.customer", { customerId: "cust_1" });
    await queue.enqueue("fail", { customerId: "cust_2" });
    await queueResults;

    expect(processed).toEqual([{ customerId: "cust_1" }]);
  });
});

function waitForQueueEvent(events: QueueEvents, eventName: "completed" | "failed") {
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

import { Queue, Worker } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BullMqScheduler } from "./index.js";

const redisUrl = process.env.REDIS_URL;
describe.skipIf(!redisUrl)("BullMqScheduler", () => {
  const name = `framekit-scheduler-${crypto.randomUUID()}`;
  let scheduler: BullMqScheduler;
  let queue: Queue;
  beforeAll(async () => {
    scheduler = new BullMqScheduler(name, redisUrl!);
    queue = new Queue(name, { connection: { url: redisUrl! } });
    await scheduler.start();
  });
  afterAll(async () => {
    try { await scheduler?.close(); }
    finally {
      if (queue) { try { await queue.obliterate({ force: true }); } finally { await queue.close(); } }
    }
  });
  it("persists schedules, upserts concurrently, executes, and removes future scheduling", async () => {
    await Promise.all(Array.from({ length: 4 }, () => scheduler.upsert({ id: "tick", name: "tick", payload: { value: 1 }, everyMs: 50, attempts: 1, completedRetention: 1 })));
    expect((await scheduler.list()).filter((item) => item.key === "tick")).toHaveLength(1);
    const restarted = new BullMqScheduler(name, redisUrl!);
    let worker: Worker | undefined;
    try {
      await scheduler.close();
      await restarted.start();
      expect((await restarted.list()).some((item) => item.key === "tick")).toBe(true);
      let runs = 0;
      worker = new Worker(name, async () => { runs += 1; }, { connection: { url: redisUrl! } });
      await waitFor(() => runs >= 4);
      expect(await restarted.remove("tick")).toBe(true);
      expect(await restarted.list()).toEqual([]);
      await worker.close();
      expect(await queue.getDelayedCount()).toBe(0);
      expect(await queue.getCompletedCount()).toBeLessThanOrEqual(1);
    } finally {
      await Promise.allSettled([worker?.close(), restarted.close()]);
    }
  }, 10_000);
  it("rejects invalid schedules and shares concurrent shutdown completion", async () => {
    const invalid = new BullMqScheduler(name, redisUrl!);
    try {
      await expect(invalid.upsert({ id: "bad", name: "bad", payload: {}, everyMs: 0 })).rejects.toThrow();
      await expect(invalid.upsert({ id: "bad", name: "bad", payload: {}, everyMs: 100, timezone: "UTC" })).rejects.toThrow("timezone");
      await expect(invalid.upsert({ id: "bad", name: "bad", payload: {}, cron: "* * * * *", timezone: "not-a-timezone" })).rejects.toThrow("timezone");
      const closed = invalid.close();
      expect(invalid.close()).toBe(closed);
      await closed;
      await expect(invalid.list()).rejects.toThrow("closed");
    } finally { await invalid.close(); }
  });
});
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for scheduled job");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

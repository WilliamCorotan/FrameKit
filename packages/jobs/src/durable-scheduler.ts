import { Queue } from "bullmq";
import type { QueueHealth } from "./queue.js";

export type DurableSchedule = { id: string; name: string; payload: Record<string, unknown>; cron?: string; everyMs?: number; timezone?: string; attempts?: number; backoff?: number; completedRetention?: number; failedRetention?: number };

export class BullMqScheduler {
  private readonly queue: Queue;
  private closed = false;
  private closePromise?: Promise<void>;
  constructor(name: string, connectionUrl: string) { this.queue = new Queue(name, { connection: { url: connectionUrl } }); }
  async start(signal?: AbortSignal): Promise<void> { this.assertOpen(); signal?.throwIfAborted(); await this.queue.waitUntilReady(); signal?.throwIfAborted(); this.assertOpen(); }
  close(): Promise<void> { this.closePromise ??= (async () => { this.closed = true; await this.queue.close(); })(); return this.closePromise; }
  async health(): Promise<QueueHealth> { this.assertOpen(); try { await this.queue.waitUntilReady(); return { ok: !this.closed }; } catch (error) { return { ok: false, details: { error: error instanceof Error ? error.message : "unknown" } }; } }
  async upsert(input: DurableSchedule): Promise<void> {
    this.assertOpen();
    if (!input.id || !input.name || (!input.cron && !input.everyMs) || (input.cron && input.everyMs) || (input.everyMs !== undefined && (!Number.isSafeInteger(input.everyMs) || input.everyMs < 1))) throw new Error("Schedule requires id, name, and exactly one valid cron or everyMs interval.");
    if (input.attempts !== undefined && (!Number.isSafeInteger(input.attempts) || input.attempts < 1)) throw new Error("Schedule attempts must be a positive integer.");
    if (input.backoff !== undefined && (!Number.isSafeInteger(input.backoff) || input.backoff < 0)) throw new Error("Schedule backoff must be non-negative.");
    for (const count of [input.completedRetention ?? 100, input.failedRetention ?? 1000]) {
      if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) throw new Error("Schedule history retention must be between zero and 100000 jobs.");
    }
    if (input.timezone !== undefined) {
      if (!input.cron) throw new Error("Schedule timezone requires a cron expression.");
      try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }); }
      catch { throw new Error("Invalid schedule timezone."); }
    }
    await this.queue.upsertJobScheduler(input.id, input.cron ? { pattern: input.cron, tz: input.timezone } : { every: input.everyMs! }, { name: input.name, data: input.payload, opts: { attempts: input.attempts, backoff: input.backoff, removeOnComplete: { count: input.completedRetention ?? 100 }, removeOnFail: { count: input.failedRetention ?? 1000 } } });
  }
  async remove(id: string): Promise<boolean> { this.assertOpen(); return this.queue.removeJobScheduler(id); }
  async list(start = 0, end = 99) { this.assertOpen(); if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end - start > 999) throw new Error("Scheduler pagination must be bounded."); return this.queue.getJobSchedulers(start, end, true); }
  private assertOpen(): void { if (this.closed) throw new Error("Scheduler is closed"); }
}

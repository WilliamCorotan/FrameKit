import { Queue, Worker, type Job } from "bullmq";
import type { TenantContext } from "@framekit/core";
import type { FramekitRuntime, OutboxEvent } from "@framekit/runtime";

export type JobPayload = Record<string, unknown>;

export type QueueHealth = { ok: boolean; details?: Record<string, unknown> };

export type QueuePort = {
  enqueue(name: string, payload: JobPayload, options?: QueueOptions): Promise<void>;
  health(): Promise<QueueHealth>;
  close(): Promise<void>;
};

export type QueueOptions = {
  delayMs?: number;
  attempts?: number;
  backoffMs?: number;
  idempotencyKey?: string;
};

export class InMemoryQueue implements QueuePort {
  readonly jobs: Array<{ name: string; payload: JobPayload; options?: QueueOptions }> = [];
  private closed = false;

  async enqueue(name: string, payload: JobPayload, options?: QueueOptions): Promise<void> {
    if (this.closed) throw new Error("Queue is closed");
    if (options?.idempotencyKey && this.jobs.some((job) => job.options?.idempotencyKey === options.idempotencyKey)) return;
    this.jobs.push({ name, payload, options });
  }

  async health(): Promise<QueueHealth> {
    return { ok: !this.closed, details: { kind: "memory", queued: this.jobs.length } };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

export class BullMqQueue implements QueuePort {
  private readonly queue: Queue;

  constructor(name: string, connectionUrl: string) {
    this.queue = new Queue(name, { connection: { url: connectionUrl } });
  }

  async enqueue(name: string, payload: JobPayload, options: QueueOptions = {}): Promise<void> {
    await this.queue.add(name, payload, {
      delay: options.delayMs,
      attempts: options.attempts,
      backoff: options.backoffMs === undefined ? undefined : { type: "exponential", delay: options.backoffMs },
      jobId: options.idempotencyKey
    });
  }

  async health(): Promise<QueueHealth> {
    try {
      await this.queue.waitUntilReady();
      return { ok: !this.queue.closing, details: { kind: "bullmq" } };
    } catch (error) {
      return { ok: false, details: { kind: "bullmq", error: errorMessage(error) } };
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export type WorkerHandler = (name: string, payload: JobPayload, context: { id: string; attemptsMade: number }) => Promise<unknown> | unknown;

export class BullMqWorker {
  private readonly worker: Worker;

  constructor(name: string, connectionUrl: string, handler: WorkerHandler, options: { concurrency?: number } = {}) {
    this.worker = new Worker(
      name,
      async (job: Job) => handler(job.name, job.data as JobPayload, { id: String(job.id), attemptsMade: job.attemptsMade }),
      { connection: { url: connectionUrl }, ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }) }
    );
  }

  async health(): Promise<QueueHealth> {
    try {
      await this.worker.waitUntilReady();
      return { ok: !this.worker.closing, details: { kind: "bullmq-worker", running: this.worker.isRunning() } };
    } catch (error) {
      return { ok: false, details: { kind: "bullmq-worker", error: errorMessage(error) } };
    }
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}

export type OutboxDispatchHandler = (event: OutboxEvent, context: { idempotencyKey: string }) => Promise<void> | void;

export type OutboxDispatchResult = {
  inspected: number;
  dispatched: number;
  failed: number;
  skipped: number;
};

export type OutboxDispatchOptions = {
  ownerId?: string;
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  now?: string;
};

export type ScheduledJob = {
  name: string;
  description?: string;
  schedule?: string;
  handler: () => Promise<void> | void;
};

export class ScheduledJobRegistry {
  private readonly jobs = new Map<string, ScheduledJob>();

  register(job: ScheduledJob): void {
    if (this.jobs.has(job.name)) throw new Error(`Scheduled job already registered: ${job.name}`);
    this.jobs.set(job.name, job);
  }

  list(): Array<Omit<ScheduledJob, "handler">> {
    return [...this.jobs.values()].map(({ handler: _handler, ...job }) => job).sort((a, b) => a.name.localeCompare(b.name));
  }

  entries(): ScheduledJob[] {
    return [...this.jobs.values()];
  }

  async run(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Scheduled job not found: ${name}`);
    await job.handler();
  }
}

export class ScheduledJobRunner {
  private timer?: ReturnType<typeof setInterval>;
  private readonly lastRuns = new Map<string, string>();
  private active?: Promise<void>;
  private readonly runningJobs = new Set<string>();

  constructor(private readonly registry: ScheduledJobRegistry, private readonly intervalMs = 1_000) {}

  async runDue(now = new Date()): Promise<string[]> {
    const minute = now.toISOString().slice(0, 16);
    const due = this.registry.entries().filter((job) => job.schedule && cronMatches(job.schedule, now) && this.lastRuns.get(job.name) !== minute && !this.runningJobs.has(job.name));
    for (const job of due) {
      this.runningJobs.add(job.name);
      try {
        await job.handler();
        this.lastRuns.set(job.name, minute);
      } finally {
        this.runningJobs.delete(job.name);
      }
    }
    return due.map((job) => job.name);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.active) return;
      this.active = this.runDue().then(() => undefined);
      void this.active.catch(() => undefined).finally(() => { this.active = undefined; });
    }, this.intervalMs);
  }

  async health(): Promise<QueueHealth> {
    return { ok: Boolean(this.timer), details: { kind: "scheduled-job-runner", running: Boolean(this.timer) } };
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
  }
}

export async function dispatchOutboxEvents(
  runtime: FramekitRuntime,
  tenant: TenantContext,
  handler: OutboxDispatchHandler,
  options: OutboxDispatchOptions = {}
): Promise<OutboxDispatchResult> {
  const ownerId = options.ownerId ?? `worker-${crypto.randomUUID()}`;
  const maxAttempts = options.maxAttempts ?? 5;
  const events = await runtime.claimOutboxEvents(tenant, {
    ownerId,
    limit: options.limit ?? 100,
    leaseMs: options.leaseMs,
    maxAttempts,
    now: options.now
  });
  const result: OutboxDispatchResult = { inspected: events.length, dispatched: 0, failed: 0, skipped: 0 };

  for (const event of events) {
    try {
      await handler(event, { idempotencyKey: event.id });
      await runtime.acknowledgeOutboxEvent(tenant, event.id, ownerId);
      result.dispatched += 1;
    } catch (error) {
      const backoffMs = (options.baseBackoffMs ?? 1_000) * 2 ** Math.max(0, event.attempts - 1);
      await runtime.rejectOutboxEvent(tenant, event.id, ownerId, errorMessage(error), { backoffMs, maxAttempts, now: options.now });
      result.failed += 1;
    }
  }
  return result;
}

export async function retryFailedOutboxEvents(
  runtime: FramekitRuntime,
  tenant: TenantContext,
  handler: OutboxDispatchHandler,
  options: OutboxDispatchOptions = {}
): Promise<OutboxDispatchResult> {
  return dispatchOutboxEvents(runtime, tenant, handler, options);
}

export class OutboxDispatcher {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<OutboxDispatchResult>;
  private lastResult?: OutboxDispatchResult;
  private lastError?: string;

  constructor(
    private readonly runtime: FramekitRuntime,
    private readonly tenant: TenantContext,
    private readonly handler: OutboxDispatchHandler,
    private readonly options: OutboxDispatchOptions & { intervalMs?: number } = {}
  ) {}

  async runOnce(): Promise<OutboxDispatchResult> {
    if (this.active) return this.active;
    const active = dispatchOutboxEvents(this.runtime, this.tenant, this.handler, this.options);
    this.active = active;
    try {
      this.lastResult = await active;
      this.lastError = undefined;
      return this.lastResult;
    } catch (error) {
      this.lastError = errorMessage(error);
      throw error;
    } finally {
      if (this.active === active) this.active = undefined;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce().catch(() => undefined), this.options.intervalMs ?? 1_000);
  }

  async health(): Promise<QueueHealth> {
    return { ok: !this.lastError, details: { kind: "outbox-dispatcher", running: Boolean(this.timer), lastResult: this.lastResult, lastError: this.lastError } };
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
  }
}

function cronMatches(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Invalid cron expression: ${expression}`);
  const values = [date.getUTCMinutes(), date.getUTCHours(), date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCDay()];
  return fields.every((field, index) => cronFieldMatches(field!, values[index]!));
}

function cronFieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const interval = Number(field.slice(2));
    return Number.isInteger(interval) && interval > 0 && value % interval === 0;
  }
  return field.split(",").some((candidate) => Number(candidate) === value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown dispatch failure";
}

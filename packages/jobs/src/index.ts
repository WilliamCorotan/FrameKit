import { Queue } from "bullmq";
import type { TenantContext } from "@framekit/core";
import type { FramekitRuntime, OutboxEvent } from "@framekit/runtime";

export type JobPayload = Record<string, unknown>;

export type QueuePort = {
  enqueue(name: string, payload: JobPayload, options?: QueueOptions): Promise<void>;
};

export type QueueOptions = {
  delayMs?: number;
};

export class InMemoryQueue implements QueuePort {
  readonly jobs: Array<{ name: string; payload: JobPayload; options?: QueueOptions }> = [];

  async enqueue(name: string, payload: JobPayload, options?: QueueOptions): Promise<void> {
    this.jobs.push({ name, payload, options });
  }
}

export class BullMqQueue implements QueuePort {
  private readonly queue: Queue;

  constructor(name: string, connectionUrl: string) {
    this.queue = new Queue(name, { connection: { url: connectionUrl } });
  }

  async enqueue(name: string, payload: JobPayload, options: QueueOptions = {}): Promise<void> {
    await this.queue.add(name, payload, { delay: options.delayMs });
  }
}

export type OutboxDispatchHandler = (event: OutboxEvent) => Promise<void> | void;

export type OutboxDispatchResult = {
  inspected: number;
  dispatched: number;
  failed: number;
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
    if (this.jobs.has(job.name)) {
      throw new Error(`Scheduled job already registered: ${job.name}`);
    }
    this.jobs.set(job.name, job);
  }

  list(): Array<Omit<ScheduledJob, "handler">> {
    return [...this.jobs.values()].map(({ handler: _handler, ...job }) => job).sort((a, b) => a.name.localeCompare(b.name));
  }

  async run(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Scheduled job not found: ${name}`);
    }
    await job.handler();
  }
}

export async function dispatchOutboxEvents(
  runtime: FramekitRuntime,
  tenant: TenantContext,
  handler: OutboxDispatchHandler,
  options: { limit?: number } = {}
): Promise<OutboxDispatchResult> {
  const events = await runtime.outboxEvents(tenant, { status: "pending", limit: options.limit ?? 100 });
  const result: OutboxDispatchResult = {
    inspected: events.length,
    dispatched: 0,
    failed: 0
  };

  for (const event of events) {
    try {
      await handler(event);
      await runtime.markOutboxDispatched(tenant, event.id);
      result.dispatched += 1;
    } catch (error) {
      await runtime.markOutboxFailed(tenant, event.id, error instanceof Error ? error.message : "Unknown dispatch failure");
      result.failed += 1;
    }
  }

  return result;
}

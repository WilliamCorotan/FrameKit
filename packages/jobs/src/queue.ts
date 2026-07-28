import { Queue, Worker, type Job } from "bullmq";

export type JobPayload = Record<string, unknown>;

export type QueueHealth = { ok: boolean; details?: Record<string, unknown> };

export type QueuePort = {
  start?(signal?: AbortSignal): Promise<void> | void;
  enqueue(name: string, payload: JobPayload, options?: QueueOptions): Promise<void>;
  health(): Promise<QueueHealth>;
  close(): Promise<void>;
  dispose?(): Promise<void> | void;
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

  async start(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.closed) throw new Error("Queue is closed");
  }

  async health(): Promise<QueueHealth> {
    return { ok: !this.closed, details: { kind: "memory", queued: this.jobs.length } };
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async dispose(): Promise<void> { await this.close(); }
}

export class BullMqQueue implements QueuePort {
  private readonly queue: Queue;
  private closed = false;

  constructor(name: string, connectionUrl: string) {
    this.queue = new Queue(name, { connection: { url: connectionUrl } });
  }

  async start(signal?: AbortSignal): Promise<void> {
    if (this.closed) throw new Error("Queue is closed");
    signal?.throwIfAborted();
    await this.queue.waitUntilReady();
    signal?.throwIfAborted();
  }

  async enqueue(name: string, payload: JobPayload, options: QueueOptions = {}): Promise<void> {
    if (this.closed) throw new Error("Queue is closed");
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
    if (this.closed) return;
    this.closed = true;
    await this.queue.close();
  }

  async dispose(): Promise<void> { await this.close(); }
}

export type WorkerHandler = (name: string, payload: JobPayload, context: { id: string; attemptsMade: number }) => Promise<unknown> | unknown;

export class BullMqWorker {
  private readonly worker: Worker;
  private closed = false;

  constructor(name: string, connectionUrl: string, handler: WorkerHandler, options: { concurrency?: number } = {}) {
    this.worker = new Worker(
      name,
      async (job: Job) => handler(job.name, job.data as JobPayload, { id: String(job.id), attemptsMade: job.attemptsMade }),
      { connection: { url: connectionUrl }, ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }) }
    );
  }

  async start(signal?: AbortSignal): Promise<void> {
    if (this.closed) throw new Error("Worker is closed");
    signal?.throwIfAborted();
    await this.worker.waitUntilReady();
    signal?.throwIfAborted();
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
    if (this.closed) return;
    this.closed = true;
    await this.worker.close();
  }

  async dispose(): Promise<void> { await this.close(); }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Unknown dispatch failure"; }


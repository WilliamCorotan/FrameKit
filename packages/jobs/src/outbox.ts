import type { TenantContext } from "@framekit/core";
import type { FramekitRuntime, OutboxEvent } from "@framekit/runtime";
import type { QueueHealth } from "./queue.js";

export type OutboxDispatchHandler = (event: OutboxEvent, context: { idempotencyKey: string; signal?: AbortSignal }) => Promise<void> | void;

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
  signal?: AbortSignal;
};


export async function dispatchOutboxEvents(
  runtime: FramekitRuntime,
  tenant: TenantContext,
  handler: OutboxDispatchHandler,
  options: OutboxDispatchOptions = {}
): Promise<OutboxDispatchResult> {
  options.signal?.throwIfAborted();
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
    options.signal?.throwIfAborted();
    try {
      await handler(event, { idempotencyKey: event.id, signal: options.signal });
      options.signal?.throwIfAborted();
      await runtime.acknowledgeOutboxEvent(tenant, event.id, ownerId);
      result.dispatched += 1;
    } catch (error) {
      options.signal?.throwIfAborted();
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
  private controller?: AbortController;
  private closed = false;
  private closing?: Promise<void>;
  private abortSignal?: AbortSignal;
  private abortListener?: () => void;

  constructor(
    private readonly runtime: FramekitRuntime,
    private readonly tenant: TenantContext,
    private readonly handler: OutboxDispatchHandler,
    private readonly options: OutboxDispatchOptions & { intervalMs?: number } = {}
  ) {}

  async runOnce(): Promise<OutboxDispatchResult> {
    if (this.closed) throw new Error("Outbox dispatcher is closed");
    if (this.active) return this.active;
    this.controller ??= new AbortController();
    const signal = this.options.signal
      ? AbortSignal.any([this.controller.signal, this.options.signal])
      : this.controller.signal;
    const active = dispatchOutboxEvents(this.runtime, this.tenant, this.handler, {
      ...this.options,
      signal
    });
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

  start(signal?: AbortSignal): void {
    if (this.closed) throw new Error("Outbox dispatcher is closed");
    signal?.throwIfAborted();
    if (this.timer) return;
    this.controller ??= new AbortController();
    if (signal) {
      this.abortSignal = signal;
      this.abortListener = () => { void this.close().catch(() => undefined); };
      signal.addEventListener("abort", this.abortListener, { once: true });
    }
    this.timer = setInterval(() => void this.runOnce().catch(() => undefined), this.options.intervalMs ?? 1_000);
  }

  async health(): Promise<QueueHealth> {
    return { ok: !this.lastError, details: { kind: "outbox-dispatcher", running: Boolean(this.timer), lastResult: this.lastResult, lastError: this.lastError } };
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.closed) return;
    this.closed = true;
    if (this.abortSignal && this.abortListener) this.abortSignal.removeEventListener("abort", this.abortListener);
    this.abortSignal = undefined;
    this.abortListener = undefined;
    const operation = (async () => {
      this.controller?.abort();
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      await this.active;
      this.controller = undefined;
    })();
    this.closing = operation;
    try { await operation; } finally { if (this.closing === operation) this.closing = undefined; }
  }

  async dispose(): Promise<void> { await this.close(); }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Unknown dispatch failure"; }


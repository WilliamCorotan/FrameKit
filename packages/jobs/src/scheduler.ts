import type { QueueHealth } from "./queue.js";

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
  private readonly activeRuns = new Set<Promise<string[]>>();
  private readonly runningJobs = new Set<string>();
  private closed = false;
  private closing?: Promise<void>;
  private abortSignal?: AbortSignal;
  private abortListener?: () => void;

  constructor(private readonly registry: ScheduledJobRegistry, private readonly intervalMs = 1_000) {}

  async runDue(now = new Date()): Promise<string[]> {
    if (this.closed) throw new Error("Scheduled job runner is closed");
    const run = this.runDueBatch(now);
    this.activeRuns.add(run);
    try { return await run; } finally { this.activeRuns.delete(run); }
  }

  private async runDueBatch(now: Date): Promise<string[]> {
    const minute = now.toISOString().slice(0, 16);
    const due = this.registry.entries().filter((job) => job.schedule && cronMatches(job.schedule, now) && this.lastRuns.get(job.name) !== minute && !this.runningJobs.has(job.name));
    const ran: string[] = [];
    for (const job of due) {
      if (this.closed) break;
      this.runningJobs.add(job.name);
      try {
        await job.handler();
        this.lastRuns.set(job.name, minute);
        ran.push(job.name);
      } finally {
        this.runningJobs.delete(job.name);
      }
    }
    return ran;
  }

  start(signal?: AbortSignal): void {
    if (this.closed) throw new Error("Scheduled job runner is closed");
    signal?.throwIfAborted();
    if (this.timer) return;
    if (signal) {
      this.abortSignal = signal;
      this.abortListener = () => { void this.close().catch(() => undefined); };
      signal.addEventListener("abort", this.abortListener, { once: true });
    }
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
    if (this.closing) return this.closing;
    if (this.closed) return;
    this.closed = true;
    if (this.abortSignal && this.abortListener) this.abortSignal.removeEventListener("abort", this.abortListener);
    this.abortSignal = undefined;
    this.abortListener = undefined;
    const operation = (async () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      await Promise.all([...(this.active ? [this.active] : []), ...this.activeRuns]);
    })();
    this.closing = operation;
    try { await operation; } finally { if (this.closing === operation) this.closing = undefined; }
  }

  async dispose(): Promise<void> { await this.close(); }
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

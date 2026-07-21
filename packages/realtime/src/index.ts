export type RealtimeEvent<TPayload = Record<string, unknown>> = {
  cursor?: string;
  channel: string;
  type: string;
  payload: TPayload;
  createdAt?: string;
};

export type EventBus = {
  publish<TPayload extends Record<string, unknown>>(event: RealtimeEvent<TPayload>): Promise<void>;
  subscribe(channel: string, listener: (event: RealtimeEvent) => void): () => void;
};

export class InMemoryEventBus implements EventBus {
  private readonly listeners = new Map<string, Set<(event: RealtimeEvent) => void>>();
  private readonly events: RealtimeEvent[] = [];
  private sequence = 0;
  private closed = false;

  async publish<TPayload extends Record<string, unknown>>(event: RealtimeEvent<TPayload>): Promise<void> {
    if (this.closed) throw new Error("Realtime event bus is closed");
    const persisted = { ...event, cursor: event.cursor ?? String(++this.sequence), createdAt: event.createdAt ?? new Date().toISOString() };
    this.events.push(persisted);
    if (this.events.length > 1_000) {
      this.events.splice(0, this.events.length - 1_000);
    }
    for (const listener of this.listeners.get(event.channel) ?? []) {
      listener(persisted);
    }
  }

  list(channel: string, options: { limit?: number; after?: string } = {}): RealtimeEvent[] {
    const events = this.events.filter((event) => event.channel === channel && (!options.after || Number(event.cursor) > Number(options.after)));
    return options.after ? events.slice(0, options.limit ?? 100) : events.slice(-(options.limit ?? 100)).reverse();
  }

  subscribe(channel: string, listener: (event: RealtimeEvent) => void): () => void {
    if (this.closed) throw new Error("Realtime event bus is closed");
    const listeners = this.listeners.get(channel) ?? new Set<(event: RealtimeEvent) => void>();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
    return () => listeners.delete(listener);
  }

  async health() {
    return { ok: !this.closed, details: { kind: "memory", events: this.events.length } };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
  }

  describe() {
    return {
      kind: "memory",
      durable: false,
      features: ["publish", "subscribe", "history"]
    };
  }
}

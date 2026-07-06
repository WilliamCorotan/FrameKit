export type RealtimeEvent<TPayload = Record<string, unknown>> = {
  channel: string;
  type: string;
  payload: TPayload;
};

export type EventBus = {
  publish<TPayload extends Record<string, unknown>>(event: RealtimeEvent<TPayload>): Promise<void>;
  subscribe(channel: string, listener: (event: RealtimeEvent) => void): () => void;
};

export class InMemoryEventBus implements EventBus {
  private readonly listeners = new Map<string, Set<(event: RealtimeEvent) => void>>();
  private readonly events: RealtimeEvent[] = [];

  async publish<TPayload extends Record<string, unknown>>(event: RealtimeEvent<TPayload>): Promise<void> {
    this.events.push(event);
    if (this.events.length > 1_000) {
      this.events.splice(0, this.events.length - 1_000);
    }
    for (const listener of this.listeners.get(event.channel) ?? []) {
      listener(event);
    }
  }

  list(channel: string, options: { limit?: number } = {}): RealtimeEvent[] {
    return this.events
      .filter((event) => event.channel === channel)
      .slice(-(options.limit ?? 100))
      .reverse();
  }

  subscribe(channel: string, listener: (event: RealtimeEvent) => void): () => void {
    const listeners = this.listeners.get(channel) ?? new Set<(event: RealtimeEvent) => void>();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
    return () => listeners.delete(listener);
  }

  describe() {
    return {
      kind: "memory",
      durable: false,
      features: ["publish", "subscribe", "history"]
    };
  }
}

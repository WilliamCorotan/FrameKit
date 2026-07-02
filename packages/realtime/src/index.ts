export type RealtimeEvent<TPayload = unknown> = {
  channel: string;
  type: string;
  payload: TPayload;
};

export type EventBus = {
  publish<TPayload>(event: RealtimeEvent<TPayload>): Promise<void>;
  subscribe(channel: string, listener: (event: RealtimeEvent) => void): () => void;
};

export class InMemoryEventBus implements EventBus {
  private readonly listeners = new Map<string, Set<(event: RealtimeEvent) => void>>();

  async publish<TPayload>(event: RealtimeEvent<TPayload>): Promise<void> {
    for (const listener of this.listeners.get(event.channel) ?? []) {
      listener(event);
    }
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
      features: ["publish", "subscribe"]
    };
  }
}

import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "./index.js";

describe("InMemoryEventBus lifecycle", () => {
  it("unsubscribes on abort and rejects use after close", async () => {
    const bus = new InMemoryEventBus();
    const controller = new AbortController();
    const listener = vi.fn();

    await bus.start(controller.signal);
    bus.subscribe("tenant:events", listener, { signal: controller.signal });
    await bus.publish({ channel: "tenant:events", type: "created", payload: { id: "one" } });
    controller.abort();
    await bus.publish({ channel: "tenant:events", type: "created", payload: { id: "two" } });
    expect(listener).toHaveBeenCalledTimes(1);

    await bus.dispose();
    expect(await bus.health()).toMatchObject({ ok: false });
    await expect(bus.publish({ channel: "tenant:events", type: "created", payload: {} })).rejects.toThrow("closed");
  });
});

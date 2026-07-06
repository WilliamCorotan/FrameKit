import { afterEach, describe, expect, it, vi } from "vitest";
import { defineApp, defineDocType, defineModule } from "@framekit/core";
import { createClient, generateSdkTypes } from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateSdkTypes", () => {
  it("emits typed inputs, records, and workflow actions from metadata", () => {
    const app = defineApp({
      name: "SDK",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "deal",
              label: "Deal",
              fields: [
                { name: "title", label: "Title", type: "text", required: true },
                { name: "amount", label: "Amount", type: "currency" },
                { name: "stage", label: "Stage", type: "select", options: ["open", "won"] }
              ],
              workflow: {
                field: "stage",
                initialState: "open",
                states: ["open", "won"],
                transitions: [{ action: "win", from: ["open"], to: "won" }]
              }
            })
          ]
        })
      ]
    });

    const generated = generateSdkTypes(app);

    expect(generated).toContain("export type DealInput");
    expect(generated).toContain("title: string;");
    expect(generated).toContain("amount?: number;");
    expect(generated).toContain('stage?: "open" | "won";');
    expect(generated).toContain('export type DealWorkflowAction = "win";');
  });

  it("parses server-sent realtime events from the SDK stream helper", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: customer.created\ndata: {"id":"customer-1"}\n\n'));
            controller.close();
          }
        }),
        { status: 200 }
      )
    );
    const events: unknown[] = [];
    const client = createClient({ baseUrl: "http://localhost:3000", token: "session" });

    await client.streamRealtimeEvents((event) => events.push(event));

    expect(events).toEqual([{ type: "customer.created", data: { id: "customer-1" } }]);
  });

  it("includes credentials for cookie-backed auth helpers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: customer.created\ndata: {"id":"customer-1"}\n\n'));
            controller.close();
          }
        }),
        { status: 200 }
      )
    );
    const client = createClient({ baseUrl: "http://localhost:3000", authMode: "cookie" });

    await client.streamRealtimeEvents(() => undefined);

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/realtime/stream", expect.objectContaining({ credentials: "include" }));
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toMatchObject({ authorization: expect.any(String) });
  });
});

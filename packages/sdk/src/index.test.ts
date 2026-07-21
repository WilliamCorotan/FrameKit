import { afterEach, describe, expect, it, vi } from "vitest";
import { defineApp, defineDocType, defineModule } from "@framekit/core";
import { createRuntime, validateMigrationPlan, type MigrationPlan as RuntimeMigrationPlan } from "../../runtime/src/index.js";
import { ofetch } from "ofetch";
import { createClient, FRAMEKIT_HTTP_ENDPOINTS, FramekitClient, generateSdkTypes, type MigrationPlan } from "./index.js";

vi.mock("ofetch", () => ({ ofetch: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(ofetch).mockReset();
});

describe("generateSdkTypes", () => {
  it("keeps the explicit HTTP endpoint matrix in parity with every public client method", () => {
    const methods = Object.getOwnPropertyNames(FramekitClient.prototype)
      .filter((name) => !["constructor", "headers", "request"].includes(name))
      .sort();

    expect(FRAMEKIT_HTTP_ENDPOINTS.map(([method]) => method).sort()).toEqual(methods);
  });

  it("covers health, delete, and typed migration request semantics", async () => {
    vi.mocked(ofetch).mockResolvedValue({} as never);
    const client = createClient({ baseUrl: "http://localhost:3000", token: "session" });
    const app = defineApp({ name: "SDK parity", modules: [] });
    const plan: MigrationPlan = {
      id: "migration-1",
      tenantId: "default",
      appName: app.name,
      fromSchemaChecksum: "from-checksum",
      toSchemaChecksum: "to-checksum",
      fromUniqueConstraints: [],
      toUniqueConstraints: [],
      createdAt: "2026-07-21T00:00:00.000Z",
      changes: [],
      checksum: "checksum"
    };

    await client.health();
    await client.dependencyHealth();
    await client.delete("note", "note-1", { expectedRevision: 2, idempotencyKey: "delete-note-1" });
    await client.migrations();
    await client.planMigration(app);
    await client.applyMigration(plan, { allowDestructive: true });

    expect(vi.mocked(ofetch).mock.calls).toEqual([
      ["http://localhost:3000/health", expect.objectContaining({ headers: expect.not.objectContaining({ authorization: expect.any(String) }) })],
      ["http://localhost:3000/health/dependencies", expect.objectContaining({ headers: expect.not.objectContaining({ authorization: expect.any(String) }) })],
      ["http://localhost:3000/api/doctypes/note/note-1", expect.objectContaining({ method: "DELETE", headers: expect.objectContaining({ authorization: "Bearer session", "if-match": "2", "idempotency-key": "delete-note-1" }) })],
      ["http://localhost:3000/api/migrations", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer session" }) })],
      ["http://localhost:3000/api/migrations/plan", expect.objectContaining({ method: "POST", body: { app } })],
      ["http://localhost:3000/api/migrations/apply", expect.objectContaining({ method: "POST", body: { plan, allowDestructive: true } })]
    ]);
  });

  it("keeps SDK migration plans structurally and behaviorally compatible with the runtime contract", async () => {
    const current = defineApp({ name: "SDK migration parity", modules: [] });
    const next = defineApp({ name: current.name, modules: [defineModule({
      id: "crm", name: "CRM", doctypes: [defineDocType({ name: "customer", label: "Customer", fields: [
        { name: "email", label: "Email", type: "text", unique: true }
      ] })]
    })] });
    const runtimePlan: RuntimeMigrationPlan = await createRuntime(current, { idGenerator: () => "migration-sdk-parity" }).planMigration(
      { tenantId: "default", userId: "migration", roles: ["administrator"], permissions: ["*"] }, next
    );
    const sdkPlan: MigrationPlan = runtimePlan;

    expect(sdkPlan.changes.map((change) => change.kind)).toEqual(["add_doctype", "add_field", "add_unique_constraint"]);
    expect(sdkPlan.toUniqueConstraints).toEqual([{ doctype: "customer", field: "email" }]);
    await expect(validateMigrationPlan(sdkPlan)).resolves.toBeUndefined();
  });

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

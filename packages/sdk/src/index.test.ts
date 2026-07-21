import { afterEach, describe, expect, it, vi } from "vitest";
import { defineApp, defineDocType, defineModule } from "@framekit/core";
import { createRuntime, validateMigrationPlan, type MigrationPlan as RuntimeMigrationPlan } from "../../runtime/src/index.js";
import { ofetch } from "ofetch";
import {
  createClient, FRAMEKIT_HTTP_ENDPOINTS, FramekitAuthorizationError, FramekitCancelledError, FramekitClient, FramekitConflictError,
  FramekitProtocolError, FramekitResponseError, FramekitServerError, FramekitValidationError, generateSdkTypes, upgradeFramekitClientConfig, type MigrationPlan
} from "./index.js";

vi.mock("ofetch", () => ({ ofetch: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(ofetch).mockReset();
});

describe("generateSdkTypes", () => {
  it("sends typed document commands with an idempotency key", async () => {
    vi.mocked(ofetch).mockResolvedValue({} as never);
    const client = createClient({ baseUrl: "https://app.example", token: "session" });
    await client.executeDocumentCommand("close period", [{
      operation: "update", doctype: "invoice", id: "invoice-1", expectedRevision: 2, data: { status: "closed" }
    }], { idempotencyKey: "close-period-1" });
    expect(vi.mocked(ofetch)).toHaveBeenCalledWith("https://app.example/api/commands/close%20period", expect.objectContaining({
      method: "POST",
      body: { operations: [{ operation: "update", doctype: "invoice", id: "invoice-1", expectedRevision: 2, data: { status: "closed" } }] },
      headers: expect.objectContaining({ authorization: "Bearer session", "idempotency-key": "close-period-1" })
    }));
  });

  it("keeps the explicit HTTP endpoint matrix in parity with every public client method", () => {
    const methods = Object.getOwnPropertyNames(FramekitClient.prototype)
      .filter((name) => !["constructor", "execute", "headers", "request"].includes(name))
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
    await client.submit("note", "note-1", { expectedRevision: 3, idempotencyKey: "submit-note-1" });
    await client.cancel("note", "note-1", { expectedRevision: 4, idempotencyKey: "cancel-note-1" });
    await client.transferOwner("note", "note-1", "user-2", { expectedRevision: 5, idempotencyKey: "owner-note-1" });
    await client.migrations();
    await client.planMigration(app);
    await client.applyMigration(plan, { allowDestructive: true });

    expect(vi.mocked(ofetch).mock.calls).toEqual([
      ["http://localhost:3000/health/live", expect.objectContaining({ headers: expect.not.objectContaining({ authorization: expect.any(String) }) })],
      ["http://localhost:3000/health/ready", expect.objectContaining({ headers: expect.not.objectContaining({ authorization: expect.any(String) }) })],
      ["http://localhost:3000/api/doctypes/note/note-1", expect.objectContaining({ method: "DELETE", headers: expect.objectContaining({ authorization: "Bearer session", "if-match": "2", "idempotency-key": "delete-note-1" }) })],
      ["http://localhost:3000/api/doctypes/note/note-1/submit", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "if-match": "3", "idempotency-key": "submit-note-1" }) })],
      ["http://localhost:3000/api/doctypes/note/note-1/cancel", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "if-match": "4", "idempotency-key": "cancel-note-1" }) })],
      ["http://localhost:3000/api/doctypes/note/note-1/owner", expect.objectContaining({ method: "POST", body: { ownerId: "user-2" }, headers: expect.objectContaining({ "if-match": "5", "idempotency-key": "owner-note-1" }) })],
      ["http://localhost:3000/api/migrations", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer session" }) })],
      ["http://localhost:3000/api/migrations/plan", expect.objectContaining({ method: "POST", body: { app } })],
      ["http://localhost:3000/api/migrations/apply", expect.objectContaining({ method: "POST", body: { plan, allowDestructive: true } })]
    ]);
  });

  it("returns only the narrow ownership transfer receipt", async () => {
    vi.mocked(ofetch).mockResolvedValue({ id: "note-1", ownerId: "user-2", revision: 6, updatedAt: "2026-07-21T00:00:00.000Z" } as never);
    const receipt = await createClient({ baseUrl: "http://localhost:3000" }).transferOwner("note", "note-1", "user-2", { expectedRevision: 5 });
    expect(receipt).toEqual({ id: "note-1", ownerId: "user-2", revision: 6, updatedAt: "2026-07-21T00:00:00.000Z" });
    expect(receipt).not.toHaveProperty("data");
  });

  it("covers identity linking, invitations, and recovery endpoint parity", async () => {
    vi.mocked(ofetch).mockResolvedValue({} as never);
    const client = createClient({ baseUrl: "https://app.example", token: "session" });
    expect(client.providerAuthorizationUrl("work oidc", "/desk?view=mine")).toBe("https://app.example/api/auth/providers/work%20oidc/authorize?returnTo=%2Fdesk%3Fview%3Dmine");
    await client.linkProviderIdentity({ providerId: "oidc", subject: "subject", userId: "user-1" });
    await client.createInvitation({ email: "invitee@example.com", name: "Invitee", roles: [], permissions: [] });
    await client.acceptInvitation("invitation-token", "password");
    await client.requestPasswordReset("invitee@example.com");
    await client.completePasswordReset("reset-token", "new password");
    await client.createRecoveryToken("user-1");
    expect(vi.mocked(ofetch).mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      ["https://app.example/api/auth/identity-links", "POST"], ["https://app.example/api/auth/invitations", "POST"],
      ["https://app.example/api/auth/invitations/accept", "POST"], ["https://app.example/api/auth/password/reset/request", "POST"],
      ["https://app.example/api/auth/password/reset/complete", "POST"], ["https://app.example/api/auth/users/user-1/recovery", "POST"]
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
    expect(generated).toContain("FramekitValidationError");
    expect(generated).toContain("FramekitClientConfigV2");
  });

  it("maps OpenAPI failures into typed errors with request identity", async () => {
    vi.mocked(ofetch).mockRejectedValue(httpFailure(422, "VALIDATION_FAILED", "email is invalid", { field: "email" }, { "x-request-id": "request-42" }));
    const client = createClient({ baseUrl: "https://app.example", retry: { maxAttempts: 3 } });

    const error = await client.get("customer", "one").catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(FramekitValidationError);
    expect(error).toMatchObject({ status: 422, code: "VALIDATION_FAILED", details: { field: "email" }, requestId: "request-42" });
    expect(vi.mocked(ofetch)).toHaveBeenCalledTimes(1);
  });

  it("retries transient safe requests, honors Retry-After, and bounds attempts", async () => {
    vi.useFakeTimers();
    vi.mocked(ofetch)
      .mockRejectedValueOnce(httpFailure(503, "UNAVAILABLE", "retry", undefined, { "retry-after": "1" }))
      .mockResolvedValueOnce({ ok: true, app: "Retry" } as never);
    const client = createClient({ baseUrl: "https://app.example", retry: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 2_000 } });

    const result = client.health();
    await vi.advanceTimersByTimeAsync(999);
    expect(vi.mocked(ofetch)).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ ok: true });
    expect(vi.mocked(ofetch)).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("never implicitly retries conflicts or non-idempotent mutations", async () => {
    const conflict = httpFailure(409, "REVISION_CONFLICT", "stale");
    vi.mocked(ofetch).mockRejectedValue(conflict);
    const client = createClient({ baseUrl: "https://app.example", retry: { maxAttempts: 3, baseDelayMs: 0 } });

    await expect(client.get("customer", "one")).rejects.toBeInstanceOf(FramekitConflictError);
    expect(vi.mocked(ofetch)).toHaveBeenCalledTimes(1);
    vi.mocked(ofetch).mockReset().mockRejectedValue(httpFailure(503, "UNAVAILABLE", "retry"));
    await expect(client.create("customer", { name: "Unsafe" })).rejects.toBeInstanceOf(FramekitServerError);
    expect(vi.mocked(ofetch)).toHaveBeenCalledTimes(1);

    vi.mocked(ofetch).mockReset().mockRejectedValueOnce(httpFailure(503, "UNAVAILABLE", "retry")).mockResolvedValueOnce({ id: "one" } as never);
    await expect(client.create("customer", { name: "Safe" }, { idempotencyKey: "create-one" })).resolves.toMatchObject({ id: "one" });
    expect(vi.mocked(ofetch)).toHaveBeenCalledTimes(2);
  });

  it("classifies unknown HTTP responses separately from transport failures and never retries 405", async () => {
    vi.mocked(ofetch).mockRejectedValue(httpFailure(405, "HTTP_405", "method not allowed"));
    const client = createClient({ baseUrl: "https://app.example", retry: { maxAttempts: 3, baseDelayMs: 0 } });

    const error = await client.get("customer", "one").catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(FramekitResponseError);
    expect(error).toMatchObject({ status: 405, code: "HTTP_405" });
    expect(vi.mocked(ofetch)).toHaveBeenCalledTimes(1);
  });

  it("reserves transport retries for failures without an HTTP response", async () => {
    vi.mocked(ofetch).mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce({ ok: true, app: "Recovered" } as never);
    const client = createClient({ baseUrl: "https://app.example", retry: { maxAttempts: 2, baseDelayMs: 0 } });

    await expect(client.health()).resolves.toMatchObject({ app: "Recovered" });
    expect(vi.mocked(ofetch)).toHaveBeenCalledTimes(2);
  });

  it("forwards list AbortSignal and performs zero requests when it is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("cancel before list");
    const client = createClient({ baseUrl: "https://app.example", retry: { maxAttempts: 3 } });

    await expect(client.list("customer", { signal: controller.signal })).rejects.toBeInstanceOf(FramekitCancelledError);
    expect(vi.mocked(ofetch)).not.toHaveBeenCalled();
  });

  it("cancels retry waits with AbortSignal", async () => {
    vi.mocked(ofetch).mockRejectedValue(httpFailure(503, "UNAVAILABLE", "retry", undefined, { "retry-after": "60" }));
    const client = createClient({ baseUrl: "https://app.example", retry: { maxAttempts: 3 } });
    const controller = new AbortController();
    const result = client.health({ signal: controller.signal });
    await Promise.resolve();
    controller.abort("stop");
    await expect(result).rejects.toBeInstanceOf(FramekitCancelledError);
    expect(vi.mocked(ofetch)).toHaveBeenCalledTimes(1);
  });

  it("upgrades versioned configuration deterministically without enabling retries", () => {
    expect(upgradeFramekitClientConfig({ version: 1, baseUrl: "https://app.example" })).toEqual({
      config: { version: 2, baseUrl: "https://app.example" },
      diagnostics: [{ code: "UPGRADED_V1", message: "SDK config version 1 upgraded to version 2 with retries disabled by default." }]
    });
    expect(upgradeFramekitClientConfig({ baseUrl: "https://app.example" }).diagnostics[0]?.code).toBe("ASSUMED_V1");
    expect(() => upgradeFramekitClientConfig({ version: 3, baseUrl: "https://app.example" } as never)).toThrow("Unsupported");
  });

  it("parses server-sent realtime events from the SDK stream helper", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('id: 42\nevent: customer.created\ndata: {"id":"customer-1"}\n\n'));
            controller.close();
          }
        }),
        { status: 200 }
      )
    );
    const events: unknown[] = [];
    const client = createClient({ baseUrl: "http://localhost:3000", token: "session" });

    await client.streamRealtimeEvents((event) => events.push(event), { lastEventId: "41" });

    expect(events).toEqual([{ id: "42", type: "customer.created", data: { id: "customer-1" } }]);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toMatchObject({ "last-event-id": "41" });
  });

  it("maps realtime HTTP envelopes with status, details, and request identity", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN", message: "stream denied", details: { permission: "framekit.realtime.read" } }), {
      status: 403,
      headers: { "content-type": "application/json", "x-request-id": "stream-request-42" }
    }));
    const client = createClient({ baseUrl: "https://app.example" });

    const error = await client.streamRealtimeEvents(() => undefined).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(FramekitAuthorizationError);
    expect(error).toMatchObject({ status: 403, code: "FORBIDDEN", details: { permission: "framekit.realtime.read" }, requestId: "stream-request-42" });
  });

  it("maps realtime fetch and body-read aborts to cancellation", async () => {
    const fetchController = new AbortController();
    fetchController.abort("before fetch");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const client = createClient({ baseUrl: "https://app.example" });
    await expect(client.streamRealtimeEvents(() => undefined, { signal: fetchController.signal })).rejects.toBeInstanceOf(FramekitCancelledError);
    expect(fetchMock).not.toHaveBeenCalled();

    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } }), { status: 200, headers: { "x-request-id": "read-abort-42" } }));
    const readController = new AbortController();
    const reading = client.streamRealtimeEvents(() => undefined, { signal: readController.signal });
    await Promise.resolve();
    await Promise.resolve();
    readController.abort("during read");
    streamController.error(new DOMException("aborted", "AbortError"));
    const readError = await reading.catch((failure: unknown) => failure);
    expect(readError).toBeInstanceOf(FramekitCancelledError);
    expect(readError).toMatchObject({ status: 200, requestId: "read-abort-42" });
  });

  it("classifies malformed realtime event data as a protocol error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("event: broken\ndata: {not-json}\n\n", { status: 200, headers: { "x-request-id": "protocol-42" } }));
    const error = await createClient({ baseUrl: "https://app.example" }).streamRealtimeEvents(() => undefined).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(FramekitProtocolError);
    expect(error).toMatchObject({ status: 200, code: "SSE_INVALID_JSON", requestId: "protocol-42" });
  });

  it("preserves established response context on stream read transport failures", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new TypeError("socket closed")); } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 200, headers: { "x-request-id": "read-failure-42" } }));
    const error = await createClient({ baseUrl: "https://app.example" }).streamRealtimeEvents(() => undefined).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: 200, code: "STREAM_READ_FAILED", requestId: "read-failure-42" });
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

function httpFailure(status: number, code: string, message: string, details?: unknown, headers: Record<string, string> = {}) {
  return { message, response: { status, headers: new Headers(headers), _data: { error: true, code, message, details } } };
}

import { describe, expect, it, vi } from "vitest";
import { defineApp, defineDocType, defineModule } from "@framekit/core";
import { createRuntime, type SagaStore } from "./index.js";

const record = defineDocType({ name: "saga_record", label: "Record", fields: [{ name: "title", label: "Title", type: "text" }],
  permissions: ["create", "read", "delete"].map((action) => ({ action: action as "create", permissions: ["records"] })) });
const app = defineApp({ name: "Saga configuration", modules: [defineModule({ id: "records", name: "Records", doctypes: [record], commands: [{
  id: "records-saga", label: "Records saga", mode: "saga", permission: "records", doctypes: [record.name], operations: ["create", "delete"]
}] })] });
const tenant = { tenantId: "tenant", userId: "user", roles: [], permissions: ["records"] };
const input = { idempotencyKey: "saga-key", operations: [{ operation: "create" as const, doctype: record.name, id: "record", data: { title: "Record" },
  compensation: { operation: "delete" as const, doctype: record.name, id: "record", expectedRevision: 1 } }] };

function journal(): SagaStore {
  return { claim: vi.fn(), save: vi.fn(), get: vi.fn(), describe: () => ({ kind: "test", durable: true, features: ["saga-journal"] }) };
}

describe("saga runtime configuration", () => {
  it("rejects production execution without a durable journal even if start was omitted", async () => {
    const runtime = createRuntime(app, { deployment: "production" });
    await expect(runtime.executeDocumentCommand(tenant, "records-saga", input)).rejects.toMatchObject({ code: "COMMAND_SAGA_JOURNAL_REQUIRED" });
    await expect(runtime.get(tenant, record.name, "record")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await runtime.close();
  });

  it("requires an idempotency key before claiming a journaled saga", async () => {
    const sagas = journal();
    const runtime = createRuntime(app, { sagas });
    await expect(runtime.executeDocumentCommand(tenant, "records-saga", { operations: input.operations })).rejects.toMatchObject({ code: "COMMAND_SAGA_KEY_REQUIRED" });
    expect(sagas.claim).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("rejects unsafe saga production configuration during startup and closes owned resources", async () => {
    const close = vi.fn(async () => undefined);
    const runtime = createRuntime(app, {
      deployment: "production", sagas: { ...journal(), close },
      settingsSecrets: { seal: (value) => value, unseal: (value) => value }
    });
    await expect(runtime.start()).rejects.toMatchObject({ code: "RUNTIME_PRODUCTION_UNSAFE", message: expect.stringContaining("fenced") });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects a unit of work without transactional fencing", async () => {
    const sagas = journal();
    const runtime = createRuntime(app, { sagas });
    await expect(runtime.executeDocumentCommand(tenant, "records-saga", input)).rejects.toMatchObject({ code: "COMMAND_SAGA_FENCING_UNAVAILABLE" });
    expect(sagas.claim).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("closes an owned saga adapter once across concurrent shutdowns", async () => {
    const close = vi.fn(async () => undefined);
    const runtime = createRuntime(app, { sagas: { ...journal(), close } });
    await Promise.all([runtime.close(), runtime.close()]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 0.5, NaN, 900_001])("rejects invalid saga lease %s", (sagaLeaseMs) => {
    expect(() => createRuntime(app, { sagaLeaseMs })).toThrow("Saga lease");
  });
});

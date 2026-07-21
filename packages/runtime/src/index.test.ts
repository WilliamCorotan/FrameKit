import { describe, expect, it } from "vitest";
import { defineApp, defineDocType, defineModule, type DocumentHook, type TenantContext } from "@framekit/core";
import { applyFilters, assertDestructiveMigration, createExecutableMigrationArtifact, createRollbackMigrationPlan, createRuntime, InMemoryAttachmentStorage, InMemoryDocumentRepository, migrationChecksum, validateMigrationPlan } from "./index.js";

const tenant: TenantContext = {
  tenantId: "tenant_1",
  userId: "admin",
  roles: ["sales_manager"],
  permissions: ["crm.customer"]
};

describe("runtime document service", () => {
  it("executes authorized atomic commands with rollback, replay, revision, row-policy, and saga compensation semantics", async () => {
    const commandTenant = { ...tenant, permissions: ["crm.records", "crm.commands.manage"] };
    let failSagaSecondOnce = true;
    const record = defineDocType({
      name: "command_record",
      label: "Command Record",
      fields: [
        { name: "code", label: "Code", type: "text", required: true, unique: true },
        { name: "display", label: "Display", type: "text", computed: { operation: "concat", dependencies: ["code"] } }
      ],
      permissions: ["create", "read", "update", "delete"].map((action) => ({ action: action as "create", permissions: ["crm.records"] }))
    });
    const note = defineDocType({
      name: "command_note",
      label: "Command Note",
      ownership: {},
      rowPolicy: { read: [{ owner: "any" }], write: [{ owner: "self" }] },
      fields: [{ name: "title", label: "Title", type: "text", required: true }],
      permissions: ["create", "read", "update", "delete"].map((action) => ({ action: action as "create", permissions: ["crm.records"] }))
    });
    const commandApp = defineApp({ name: "Commands", modules: [defineModule({
      id: "crm", name: "CRM", doctypes: [record, note], commands: [
        { id: "atomic-records", label: "Atomic records", permission: "crm.commands.manage", mode: "atomic", doctypes: [record.name, note.name], operations: ["create", "update", "delete"], maxOperations: 10 },
        { id: "saga-records", label: "Saga records", permission: "crm.commands.manage", mode: "saga", doctypes: [record.name], operations: ["create", "delete"], maxOperations: 10 }
      ], hooks: { afterInsert: {
        command_note: [({ document }) => { if (document) { document.revision = 999; document.ownerId = "mallory"; document.data.title = "mutated after persistence"; } }],
        command_record: [({ document }) => { if (document?.id === "saga-retry-b" && failSagaSecondOnce) { failSagaSecondOnce = false; throw new Error("fail saga step once"); } }]
      } }
    })] });
    const runtime = createRuntime(commandApp);

    await expect(runtime.executeDocumentCommand(tenant, "atomic-records", { operations: [
      { operation: "create", doctype: record.name, id: "forbidden", data: { code: "NO" } }
    ] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(runtime.executeDocumentCommand(commandTenant, "atomic-records", { operations: [
      { operation: "create", doctype: record.name, id: "computed-atomic", data: { code: "COMPUTED", display: "COMPUTED" } }
    ] })).rejects.toMatchObject({ code: "COMPUTED_FIELD_READ_ONLY" });
    await expect(runtime.executeDocumentCommand(commandTenant, "atomic-records", { operations: [
      { operation: "create", doctype: record.name, id: "unknown-atomic", data: { code: "UNKNOWN", typo: true } }
    ] })).rejects.toMatchObject({
      code: "FIELD_VALIDATION_FAILED",
      details: { violations: [{ field: "typo", rule: "schema", code: "unknown_field" }] }
    });
    await expect(runtime.get(commandTenant, record.name, "unknown-atomic")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.executeDocumentCommand(commandTenant, "saga-records", { operations: [{
      operation: "create", doctype: record.name, id: "computed-saga", data: { code: "COMPUTED", display: "COMPUTED" },
      compensation: { operation: "delete", doctype: record.name, id: "computed-saga", expectedRevision: 1 }
    }] })).rejects.toMatchObject({ code: "COMMAND_SAGA_FAILED", details: { cause: expect.stringContaining("cannot be written") } });
    await expect(runtime.executeDocumentCommand(commandTenant, "saga-records", { operations: [{
      operation: "create", doctype: record.name, id: "unknown-saga", data: { code: "UNKNOWN", typo: true },
      compensation: { operation: "delete", doctype: record.name, id: "unknown-saga", expectedRevision: 1 }
    }] })).rejects.toMatchObject({ code: "COMMAND_SAGA_FAILED", details: {
      cause: "One or more fields failed validation.",
      causeCode: "FIELD_VALIDATION_FAILED",
      causeDetails: { violations: [{ field: "typo", rule: "schema", code: "unknown_field" }] }
    } });
    await expect(runtime.get(commandTenant, record.name, "unknown-saga")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

    const request = { operations: [
      { operation: "create" as const, doctype: record.name, id: "record-a", data: { code: "A" } },
      { operation: "create" as const, doctype: note.name, id: "note-a", data: { title: "A note" } }
    ], idempotencyKey: "atomic-success" };
    const applied = await runtime.executeDocumentCommand(commandTenant, "atomic-records", request);
    expect(applied).toMatchObject({ mode: "atomic", replayed: false, documents: [{ id: "record-a" }, { id: "note-a", revision: 1, ownerId: commandTenant.userId, data: { title: "A note" } }] });
    await expect(runtime.executeDocumentCommand(commandTenant, "atomic-records", request)).resolves.toMatchObject({ replayed: true });
    await expect(runtime.auditTrail(commandTenant)).resolves.toHaveLength(2);
    await expect(runtime.outboxEvents(commandTenant)).resolves.toHaveLength(2);
    await expect(runtime.outboxEvents(commandTenant)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ id: "note-a", revision: 1, ownerId: commandTenant.userId, data: { title: "A note" } }) })
    ]));
    const bob = { ...commandTenant, userId: "bob" };
    await expect(runtime.get(bob, note.name, "note-a")).resolves.toMatchObject({ id: "note-a" });
    await expect(runtime.executeDocumentCommand(bob, "atomic-records", request)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(runtime.executeDocumentCommand(bob, "atomic-records", { operations: [
      { operation: "update", doctype: note.name, id: "note-a", expectedRevision: 1, data: { title: "stolen" } }
    ] })).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.executeDocumentCommand(commandTenant, "atomic-records", { operations: [
      { operation: "update", doctype: record.name, id: "record-a", expectedRevision: 1, data: { display: "A" } }
    ] })).rejects.toMatchObject({ code: "COMPUTED_FIELD_READ_ONLY" });
    await runtime.executeDocumentCommand(commandTenant, "atomic-records", { operations: [
      { operation: "update", doctype: note.name, id: "note-a", expectedRevision: 1, data: { title: "updated later" } }
    ] });
    await expect(runtime.executeDocumentCommand(commandTenant, "atomic-records", request)).resolves.toMatchObject({
      replayed: true, documents: [{ id: "record-a" }, { id: "note-a", revision: 1, data: { title: "A note" } }]
    });

    for (const invalid of [
      { operations: [{ operation: "create", doctype: record.name, data: [], typo: true }] },
      { operations: [{ operation: "create", doctype: record.name, data: {}, expectedRevision: 1 }] },
      { operations: [{ operation: "update", doctype: record.name, id: "record-a", expectedRevision: 0, data: {} }] },
      { operations: [{ operation: "delete", doctype: record.name, id: "record-a", expectedRevision: 1, data: {} }] },
      { operations: [{ operation: "create", doctype: record.name, data: {}, compensation: { operation: "delete", doctype: record.name, id: "x", expectedRevision: 1, compensation: {} } }] }
    ]) await expect(runtime.executeDocumentCommand(commandTenant, "atomic-records", invalid as never)).rejects.toMatchObject({ code: "INVALID_COMMAND_OPERATION" });

    await expect(runtime.executeDocumentCommand(commandTenant, "atomic-records", { operations: [
      { operation: "create", doctype: record.name, id: "duplicate-a", data: { code: "DUP" } },
      { operation: "create", doctype: record.name, id: "duplicate-b", data: { code: "DUP" } }
    ] })).rejects.toMatchObject({ code: "UNIQUE_CONSTRAINT_FAILED" });
    await expect(runtime.get(commandTenant, record.name, "duplicate-a")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

    await expect(runtime.executeDocumentCommand(commandTenant, "atomic-records", { operations: [
      { operation: "update", doctype: record.name, id: "record-a", expectedRevision: 1, data: { code: "A2" } },
      { operation: "update", doctype: note.name, id: "note-a", expectedRevision: 99, data: { title: "stale" } }
    ] })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(runtime.get(commandTenant, record.name, "record-a")).resolves.toMatchObject({ revision: 1, data: { code: "A" } });

    const createReplay = { operations: [{ operation: "create" as const, doctype: record.name, id: "replay-created", data: { code: "REPLAY-CREATE" } }], idempotencyKey: "replay-create-key" };
    await runtime.executeDocumentCommand(commandTenant, "atomic-records", createReplay);
    await runtime.executeDocumentCommand(commandTenant, "atomic-records", { operations: [{ operation: "update", doctype: record.name, id: "replay-created", expectedRevision: 1, data: { code: "REPLAY-CREATE-UPDATED" } }] });
    await runtime.executeDocumentCommand(commandTenant, "atomic-records", { operations: [{ operation: "delete", doctype: record.name, id: "replay-created", expectedRevision: 2 }] });
    await expect(runtime.executeDocumentCommand(commandTenant, "atomic-records", createReplay)).resolves.toMatchObject({ replayed: true, documents: [{ id: "replay-created", revision: 1, data: { code: "REPLAY-CREATE" } }] });
    await expect(runtime.executeDocumentCommand(bob, "atomic-records", createReplay)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    await runtime.executeDocumentCommand(commandTenant, "atomic-records", { operations: [{ operation: "create", doctype: record.name, id: "replay-updated", data: { code: "REPLAY-UPDATE" } }] });
    const updateReplay = { operations: [{ operation: "update" as const, doctype: record.name, id: "replay-updated", expectedRevision: 1, data: { code: "REPLAY-UPDATED" } }], idempotencyKey: "replay-update-key" };
    await runtime.executeDocumentCommand(commandTenant, "atomic-records", updateReplay);
    await runtime.executeDocumentCommand(commandTenant, "atomic-records", { operations: [{ operation: "delete", doctype: record.name, id: "replay-updated", expectedRevision: 2 }] });
    await expect(runtime.executeDocumentCommand(commandTenant, "atomic-records", updateReplay)).resolves.toMatchObject({ replayed: true, documents: [{ id: "replay-updated", revision: 2, data: { code: "REPLAY-UPDATED" } }] });

    await runtime.executeDocumentCommand(commandTenant, "atomic-records", { operations: [{ operation: "create", doctype: record.name, id: "replay-deleted", data: { code: "REPLAY-DELETE" } }] });
    const deleteReplay = { operations: [{ operation: "delete" as const, doctype: record.name, id: "replay-deleted", expectedRevision: 1 }], idempotencyKey: "replay-delete-key" };
    await expect(runtime.executeDocumentCommand(commandTenant, "atomic-records", deleteReplay)).resolves.toMatchObject({ replayed: false, documents: [{ id: "replay-deleted", revision: 1 }] });
    const deleteAuditCount = (await runtime.auditTrail(commandTenant)).filter((event) => event.documentId === "replay-deleted").length;
    const deleteOutboxCount = (await runtime.outboxEvents(commandTenant)).filter((event) => event.payload.id === "replay-deleted").length;
    await expect(runtime.executeDocumentCommand(commandTenant, "atomic-records", deleteReplay)).resolves.toMatchObject({ replayed: true, documents: [{ id: "replay-deleted", revision: 1, data: { code: "REPLAY-DELETE" } }] });
    expect((await runtime.auditTrail(commandTenant)).filter((event) => event.documentId === "replay-deleted")).toHaveLength(deleteAuditCount);
    expect((await runtime.outboxEvents(commandTenant)).filter((event) => event.payload.id === "replay-deleted")).toHaveLength(deleteOutboxCount);
    await expect(runtime.executeDocumentCommand(bob, "atomic-records", deleteReplay)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const denied = createRuntime(commandApp, { commandRowPolicy: ({ operation }) => operation.operation !== "update" });
    await denied.executeDocumentCommand(commandTenant, "atomic-records", { operations: [{ operation: "create", doctype: record.name, id: "record-a", data: { code: "A" } }] });
    await expect(denied.executeDocumentCommand(commandTenant, "atomic-records", { operations: [
      { operation: "update", doctype: record.name, id: "record-a", expectedRevision: 1, data: { code: "blocked" } }
    ] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    let allowReplay = true;
    const replayPolicy = createRuntime(commandApp, { commandRowPolicy: () => allowReplay });
    const policyRequest = { operations: [{ operation: "create" as const, doctype: record.name, id: "policy-replay", data: { code: "POLICY" } }], idempotencyKey: "policy-replay-key" };
    await replayPolicy.executeDocumentCommand(commandTenant, "atomic-records", policyRequest);
    allowReplay = false;
    await expect(replayPolicy.executeDocumentCommand(commandTenant, "atomic-records", policyRequest)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

    const sagaRequest = { operations: [{
      operation: "create" as const, doctype: record.name, id: "saga-success", data: { code: "SAGA-SUCCESS" },
      compensation: { operation: "delete" as const, doctype: record.name, id: "saga-success", expectedRevision: 1 }
    }], idempotencyKey: "saga-success-1" };
    await expect(runtime.executeDocumentCommand(commandTenant, "saga-records", sagaRequest)).resolves.toMatchObject({ replayed: false });
    await expect(runtime.executeDocumentCommand(commandTenant, "saga-records", sagaRequest)).resolves.toMatchObject({ replayed: true, documents: [{ id: "saga-success" }] });

    await runtime.executeDocumentCommand(commandTenant, "atomic-records", { operations: [{ operation: "create", doctype: record.name, id: "saga-delete", data: { code: "SAGA-DELETE" } }] });
    const sagaDelete = { operations: [{
      operation: "delete" as const, doctype: record.name, id: "saga-delete", expectedRevision: 1,
      compensation: { operation: "create" as const, doctype: record.name, id: "saga-delete", data: { code: "SAGA-DELETE" } }
    }], idempotencyKey: "saga-delete-key" };
    await expect(runtime.executeDocumentCommand(commandTenant, "saga-records", sagaDelete)).resolves.toMatchObject({ replayed: false, documents: [{ id: "saga-delete", revision: 1 }] });
    await expect(runtime.executeDocumentCommand(commandTenant, "saga-records", sagaDelete)).resolves.toMatchObject({ replayed: true, documents: [{ id: "saga-delete", revision: 1, data: { code: "SAGA-DELETE" } }] });

    await expect(runtime.executeDocumentCommand(commandTenant, "saga-records", { operations: [
      {
        operation: "create", doctype: record.name, id: "saga-a", data: { code: "SAGA" },
        compensation: { operation: "delete", doctype: record.name, id: "saga-a", expectedRevision: 1 }
      },
      {
        operation: "create", doctype: record.name, id: "saga-b", data: { code: "SAGA" },
        compensation: { operation: "delete", doctype: record.name, id: "saga-b", expectedRevision: 1 }
      }
    ] })).rejects.toMatchObject({ code: "COMMAND_SAGA_FAILED", details: { compensationFailures: [] } });
    await expect(runtime.get(commandTenant, record.name, "saga-a")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

    const terminalSaga = { operations: [
      { operation: "create" as const, doctype: record.name, id: "saga-retry-a", data: { code: "RETRY-A" }, compensation: { operation: "delete" as const, doctype: record.name, id: "saga-retry-a", expectedRevision: 1 } },
      { operation: "create" as const, doctype: record.name, id: "saga-retry-b", data: { code: "RETRY-B" }, compensation: { operation: "delete" as const, doctype: record.name, id: "saga-retry-b", expectedRevision: 1 } }
    ], idempotencyKey: "saga-terminal" };
    await expect(runtime.executeDocumentCommand(commandTenant, "saga-records", terminalSaga)).rejects.toMatchObject({ code: "COMMAND_SAGA_FAILED" });
    await expect(runtime.get(commandTenant, record.name, "saga-retry-a")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    const eventCount = (await runtime.outboxEvents(commandTenant)).length;
    await expect(runtime.executeDocumentCommand(commandTenant, "saga-records", terminalSaga)).rejects.toMatchObject({ code: "COMMAND_SAGA_TERMINAL" });
    await expect(runtime.get(commandTenant, record.name, "saga-retry-b")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.outboxEvents(commandTenant)).resolves.toHaveLength(eventCount);
  });
  it("starts resources in order and closes them once in reverse order", async () => {
    const events: string[] = [];
    const first = { start: () => { events.push("first:start"); }, close: () => { events.push("first:close"); } };
    const second = { start: () => { events.push("second:start"); }, dispose: () => { events.push("second:dispose"); } };
    const runtime = createRuntime(defineApp({ name: "Lifecycle", modules: [] }), { resources: [first, second] });

    await runtime.start();
    await runtime.start();
    expect(runtime.lifecycleStatus()).toEqual({ state: "started", ready: true });
    await runtime.close();
    await runtime.dispose();

    expect(events).toEqual(["first:start", "second:start", "second:dispose", "first:close"]);
    expect(runtime.lifecycleStatus()).toEqual({ state: "closed", ready: false });
  });
  it("closes a partially started resource and aggregates rollback failures", async () => {
    const events: string[] = [];
    const runtime = createRuntime(defineApp({ name: "Failed lifecycle", modules: [] }), { resources: [
      { start: () => { events.push("first:start"); }, close: () => { events.push("first:close"); } },
      {
        start: () => { events.push("second:start"); throw new Error("startup failed after acquisition"); },
        close: () => { events.push("second:close"); throw new Error("cleanup failed"); }
      }
    ] });

    const error = await runtime.start().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((failure) => (failure as Error).message)).toEqual([
      "startup failed after acquisition", "cleanup failed"
    ]);
    expect(events).toEqual(["first:start", "second:start", "second:close", "first:close"]);
    expect(runtime.lifecycleStatus()).toEqual({ state: "closed", ready: false });
  });
  it("creates and lists documents", async () => {
    const app = defineApp({
      name: "CRM",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [{ name: "name", label: "Name", type: "text", required: true, inList: true }],
              permissions: [{ action: "create", permissions: ["crm.customer"] }, { action: "read", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app, { idGenerator: () => "abc123456789" });

    const created = await runtime.create(tenant, "customer", { name: "Northwind" });
    const list = await runtime.list(tenant, "customer");

    expect(created.id).toBe("customer-abc12345");
    expect(list).toHaveLength(1);
  });

  it("round-trips exact decimals, computes deterministic fields, and reports validator violations", async () => {
    const app = defineApp({ name: "Billing", modules: [defineModule({ id: "billing", name: "Billing", doctypes: [defineDocType({
      name: "invoice",
      label: "Invoice",
      fields: [
        { name: "subtotal", label: "Subtotal", type: "decimal", precision: 30, scale: 4, required: true },
        { name: "tax", label: "Tax", type: "decimal", precision: 30, scale: 4, required: true },
        { name: "total", label: "Total", type: "decimal", precision: 30, scale: 4, computed: { operation: "sum", dependencies: ["subtotal", "tax"] } },
        { name: "code", label: "Code", type: "text", validators: [{ kind: "length", min: 3 }, { kind: "pattern", pattern: "slug" }] }
      ],
      permissions: [
        { action: "create", permissions: ["crm.customer"] },
        { action: "update", permissions: ["crm.customer"] },
        { action: "read", permissions: ["crm.customer"] }
      ]
    })] })] });
    let exactId = 0;
    const runtime = createRuntime(app, { idGenerator: () => `invoice${++exactId}234` });
    const created = await runtime.create(tenant, "invoice", { subtotal: "9007199254740993.1000", tax: "0.2000", code: "acme-1" });
    expect(created.data).toMatchObject({ subtotal: "9007199254740993.1000", tax: "0.2000", total: "9007199254740993.3000" });
    const fractional = await runtime.create(tenant, "invoice", { subtotal: "0.1000", tax: "0.2000", code: "fraction" });
    expect(fractional.data.total).toBe("0.3000");
    await expect(runtime.create(tenant, "invoice", { subtotal: 0.1, tax: "0", code: "acme-1" })).rejects.toMatchObject({ code: "DECIMAL_VALIDATION_FAILED", details: { code: "decimal_string_required" } });
    await expect(runtime.create(tenant, "invoice", { subtotal: "1", tax: "2", total: "3", code: "acme-1" })).rejects.toMatchObject({ code: "COMPUTED_FIELD_READ_ONLY" });
    await expect(runtime.update(tenant, "invoice", created.id, { total: created.data.total }, { expectedRevision: created.revision })).rejects.toMatchObject({ code: "COMPUTED_FIELD_READ_ONLY" });
    await expect(runtime.create(tenant, "invoice", { subtotal: "1", tax: "2", code: "!" })).rejects.toMatchObject({
      code: "FIELD_VALIDATION_FAILED",
      details: { violations: expect.arrayContaining([expect.objectContaining({ code: "length_min" }), expect.objectContaining({ code: "pattern_slug" })]) }
    });
  });

  it("rescales computed decimal DAGs exactly without rounding", async () => {
    const arithmetic = defineDocType({ name: "arithmetic", label: "Arithmetic", fields: [
      { name: "left", label: "Left", type: "decimal", precision: 8, scale: 2, required: true },
      { name: "right", label: "Right", type: "decimal", precision: 8, scale: 2, required: true },
      { name: "sum", label: "Sum", type: "decimal", precision: 8, scale: 1, computed: { operation: "sum", dependencies: ["left", "right"] } },
      { name: "difference", label: "Difference", type: "decimal", precision: 8, scale: 1, computed: { operation: "subtract", dependencies: ["left", "right"] } },
      { name: "product", label: "Product", type: "decimal", precision: 8, scale: 2, computed: { operation: "multiply", dependencies: ["left", "right"] } },
      { name: "nested", label: "Nested", type: "decimal", precision: 8, scale: 2, computed: { operation: "sum", dependencies: ["product", "left"] } }
    ] });
    const runtime = createRuntime(defineApp({ name: "Arithmetic", modules: [defineModule({ id: "math", name: "Math", doctypes: [arithmetic] })] }), { idGenerator: (() => { let id = 0; return () => `${String(++id).padStart(8, "0")}math`; })() });
    await expect(runtime.create(tenant, arithmetic.name, { left: "2.00", right: "3.00" })).resolves.toMatchObject({ data: {
      sum: "5.0", difference: "-1.0", product: "6.00", nested: "8.00"
    } });
    await expect(runtime.create(tenant, arithmetic.name, { left: "0.00", right: "-3.00" })).resolves.toMatchObject({ data: { product: "0.00", nested: "0.00" } });
    await expect(runtime.create(tenant, arithmetic.name, { left: "2.25", right: "3.00" })).rejects.toMatchObject({ code: "DECIMAL_VALIDATION_FAILED", details: { code: "decimal_scale" } });

    const overflow = defineDocType({ name: "overflow", label: "Overflow", fields: [
      { name: "left", label: "Left", type: "decimal", precision: 4, scale: 2, required: true },
      { name: "right", label: "Right", type: "decimal", precision: 4, scale: 2, required: true },
      { name: "product", label: "Product", type: "decimal", precision: 4, scale: 2, computed: { operation: "multiply", dependencies: ["left", "right"] } }
    ] });
    const overflowRuntime = createRuntime(defineApp({ name: "Overflow", modules: [defineModule({ id: "math", name: "Math", doctypes: [overflow] })] }));
    await expect(overflowRuntime.create(tenant, overflow.name, { left: "99.00", right: "2.00" })).rejects.toMatchObject({ code: "DECIMAL_VALIDATION_FAILED", details: { code: "decimal_precision" } });
  });

  it("filters, sorts, and offsets document lists", async () => {
    const app = defineApp({
      name: "CRM",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [
                { name: "name", label: "Name", type: "text", required: true, inList: true },
                { name: "status", label: "Status", type: "select", options: ["active", "paused"], inList: true }
              ],
              permissions: [{ action: "create", permissions: ["crm.customer"] }, { action: "read", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    let id = 0;
    const runtime = createRuntime(app, { idGenerator: () => `id${++id}abcdef` });

    await runtime.create(tenant, "customer", { name: "Beta", status: "active" });
    await runtime.create(tenant, "customer", { name: "Alpha", status: "active" });
    await runtime.create(tenant, "customer", { name: "Gamma", status: "paused" });
    const list = await runtime.list(tenant, "customer", {
      filters: { status: "active" },
      sort: { field: "name", direction: "asc" },
      offset: 1,
      limit: 1
    });

    expect(list.map((record) => record.data.name)).toEqual(["Beta"]);
    await expect(runtime.list(tenant, "customer", { filters: { unknown: "x" } })).rejects.toMatchObject({ code: "UNKNOWN_FILTER_FIELD" });
  });

  it("applies cursor pagination and field projection to document lists", async () => {
    const app = defineApp({
      name: "CRM",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [
                { name: "name", label: "Name", type: "text", required: true, inList: true },
                { name: "status", label: "Status", type: "select", options: ["active", "paused"], inList: true },
                { name: "notes", label: "Notes", type: "long_text" }
              ],
              permissions: [{ action: "create", permissions: ["crm.customer"] }, { action: "read", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    let id = 0;
    const runtime = createRuntime(app, { idGenerator: () => `id${++id}abcdef` });

    await runtime.create(tenant, "customer", { name: "Alpha", status: "active", notes: "first" });
    const beta = await runtime.create(tenant, "customer", { name: "Beta", status: "paused", notes: "second" });
    await runtime.create(tenant, "customer", { name: "Gamma", status: "active", notes: "third" });

    const firstPage = await runtime.listPage(tenant, "customer", {
      sort: { field: "name", direction: "asc" },
      fields: ["name"],
      limit: 2
    });
    expect(firstPage.items.at(-1)?.id).toBe(beta.id);
    expect(firstPage.nextCursor).toBeDefined();
    expect(firstPage.nextCursor).not.toContain(beta.id);

    const page = await runtime.list(tenant, "customer", {
      sort: { field: "name", direction: "asc" },
      cursor: firstPage.nextCursor,
      fields: ["name"],
      limit: 1
    });

    expect(page).toHaveLength(1);
    expect(page[0]?.data).toEqual({ name: "Gamma" });
    expect(page[0]?.id).toBe("customer-id7abcde");
    await expect(runtime.list(tenant, "customer", { sort: { field: "name", direction: "desc" }, cursor: firstPage.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(runtime.list(tenant, "customer", { fields: ["unknown"] })).rejects.toMatchObject({ code: "UNKNOWN_PROJECTION_FIELD" });
  });

  it("supports rich filter operators", async () => {
    const app = defineApp({
      name: "Filtering",
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
                { name: "stage", label: "Stage", type: "select", options: ["open", "won", "lost"] }
              ],
              permissions: [{ action: "create", permissions: ["crm.customer"] }, { action: "read", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    let id = 0;
    const runtime = createRuntime(app, { idGenerator: () => `deal${++id}abcdef` });

    await runtime.create(tenant, "deal", { title: "North expansion", amount: "50.00", stage: "open" });
    await runtime.create(tenant, "deal", { title: "South renewal", amount: "120.00", stage: "won" });
    await runtime.create(tenant, "deal", { title: "West churn", amount: "20.00", stage: "lost" });

    await expect(runtime.list(tenant, "deal", { filters: { amount: { gt: "40.00" }, stage: { in: ["open", "won"] } }, sort: { field: "amount", direction: "desc" } })).resolves.toMatchObject([
      { data: { title: "South renewal" } },
      { data: { title: "North expansion" } }
    ]);
    await expect(runtime.list(tenant, "deal", { filters: { title: { contains: "renew" } } })).resolves.toMatchObject([{ data: { title: "South renewal" } }]);
    await expect(runtime.list(tenant, "deal", { filters: { amount: { between: [1, 2] } } as never })).rejects.toMatchObject({ code: "INVALID_QUERY", statusCode: 422 });
    await expect(runtime.list(tenant, "deal", { filters: { title: { contains: 42 } } as never })).rejects.toMatchObject({ code: "INVALID_QUERY", statusCode: 422 });
    await expect(runtime.list(tenant, "deal", { filters: { stage: { in: [["open"]] } } as never })).rejects.toMatchObject({ code: "INVALID_QUERY", statusCode: 422 });

    const doctype = app.modules[0]!.doctypes[0]!;
    const missingAndNull = [
      { id: "missing", doctype: "deal", tenantId: tenant.tenantId, revision: 1, documentStatus: "draft" as const, data: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "null", doctype: "deal", tenantId: tenant.tenantId, revision: 1, documentStatus: "draft" as const, data: { amount: null }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "zero", doctype: "deal", tenantId: tenant.tenantId, revision: 1, documentStatus: "draft" as const, data: { amount: "0.00" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    ];
    expect(applyFilters(missingAndNull, { amount: { lte: "0.00" } }, doctype).map((record) => record.id)).toEqual(["zero"]);

    const forgedCursor = btoa(JSON.stringify({ v: 1, field: "amount", direction: "asc", value: "50", id: "deal1abcdef" }))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    await expect(runtime.list(tenant, "deal", { sort: { field: "amount", direction: "asc" }, cursor: forgedCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR", statusCode: 422 });
  });

  it("validates link fields before writes", async () => {
    const app = defineApp({
      name: "Links",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [{ name: "name", label: "Name", type: "text", required: true }],
              permissions: [{ action: "create", permissions: ["crm.customer"] }]
            }),
            defineDocType({
              name: "contact",
              label: "Contact",
              fields: [
                { name: "full_name", label: "Full Name", type: "text", required: true },
                { name: "customer", label: "Customer", type: "link", linkTo: "customer" }
              ],
              permissions: [{ action: "create", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app, { idGenerator: () => "abc123456789" });

    await expect(runtime.create(tenant, "contact", { full_name: "Missing Link", customer: "missing" })).rejects.toMatchObject({ code: "LINK_NOT_FOUND" });
    const customer = await runtime.create(tenant, "customer", { name: "Linked Co" });
    await expect(runtime.create(tenant, "contact", { full_name: "Valid Link", customer: customer.id })).resolves.toMatchObject({ data: { customer: customer.id } });
  });

  it("enforces unique fields before creates and updates", async () => {
    const app = defineApp({
      name: "Unique",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [
                { name: "name", label: "Name", type: "text", required: true },
                { name: "email", label: "Email", type: "text", unique: true }
              ],
              permissions: [
                { action: "create", permissions: ["crm.customer"] },
                { action: "read", permissions: ["crm.customer"] },
                { action: "update", permissions: ["crm.customer"] }
              ]
            })
          ]
        })
      ]
    });
    let id = 0;
    const runtime = createRuntime(app, { idGenerator: () => `cust${++id}abcdef` });

    const first = await runtime.create(tenant, "customer", { name: "First", email: "owner@example.com" });
    const second = await runtime.create(tenant, "customer", { name: "Second", email: "other@example.com" });

    await expect(runtime.create(tenant, "customer", { name: "Duplicate", email: "owner@example.com" })).rejects.toMatchObject({ code: "UNIQUE_CONSTRAINT_FAILED" });
    await expect(runtime.update(tenant, "customer", second.id, { email: "owner@example.com" })).rejects.toMatchObject({ code: "UNIQUE_CONSTRAINT_FAILED" });
    const updated = await runtime.update(tenant, "customer", first.id, { name: "First renamed" }, { expectedRevision: 1 });
    expect(updated).toMatchObject({ id: first.id, revision: 2, data: { email: "owner@example.com" } });
    await expect(runtime.update(tenant, "customer", first.id, { name: "Stale" }, { expectedRevision: 1 })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    const concurrent = await Promise.allSettled([
      runtime.create(tenant, "customer", { name: "Concurrent A", email: "race@example.com" }),
      runtime.create(tenant, "customer", { name: "Concurrent B", email: "race@example.com" })
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);

    const [retried, replay] = await Promise.all([
      runtime.create(tenant, "customer", { name: "Retried", email: "retry@example.com" }, { idempotencyKey: "memory-create-1" }),
      runtime.create(tenant, "customer", { name: "Retried", email: "retry@example.com" }, { idempotencyKey: "memory-create-1" })
    ]);
    expect(replay).toEqual(retried);
    await expect(runtime.list(tenant, "customer", { filters: { email: "retry@example.com" } })).resolves.toHaveLength(1);
  });

  it("preserves a queued mutation when an earlier in-memory mutation rolls back", async () => {
    let signalFirstHook!: () => void;
    let releaseFirstHook!: () => void;
    const firstHookStarted = new Promise<void>((resolve) => { signalFirstHook = resolve; });
    const firstHookRelease = new Promise<void>((resolve) => { releaseFirstHook = resolve; });
    const app = defineApp({
      name: "Atomic memory",
      modules: [defineModule({
        id: "atomic",
        name: "Atomic",
        doctypes: [defineDocType({
          name: "customer",
          label: "Customer",
          naming: { field: "name" },
          fields: [{ name: "name", label: "Name", type: "text", required: true }],
          permissions: [
            { action: "create", permissions: ["crm.customer"] },
            { action: "read", permissions: ["crm.customer"] }
          ]
        })],
        hooks: {
          afterInsert: {
            customer: [async ({ document }) => {
              if (document?.id !== "a") return;
              signalFirstHook();
              await firstHookRelease;
              throw new Error("injected A failure");
            }]
          }
        }
      })]
    });
    let id = 0;
    const runtime = createRuntime(app, { idGenerator: () => `atomic-${++id}` });

    const failed = runtime.create(tenant, "customer", { name: "A" }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error })
    );
    await firstHookStarted;
    const successful = runtime.create(tenant, "customer", { name: "B" });
    releaseFirstHook();

    await expect(failed).resolves.toMatchObject({ ok: false, error: { message: "injected A failure" } });
    await expect(successful).resolves.toMatchObject({ id: "b", revision: 1 });
    await expect(runtime.list(tenant, "customer")).resolves.toEqual([expect.objectContaining({ id: "b" })]);
    await expect(runtime.auditTrail(tenant)).resolves.toEqual([expect.objectContaining({ documentId: "b" })]);
    await expect(runtime.outboxEvents(tenant)).resolves.toEqual([expect.objectContaining({ payload: expect.objectContaining({ id: "b" }) })]);
  });

  it("orders validation hooks and enforces draft, submit, and cancel semantics", async () => {
    const hooks: string[] = [];
    const invoice = defineDocType({
      name: "invoice",
      label: "Invoice",
      naming: { field: "title" },
      fields: [
        { name: "title", label: "Title", type: "text", required: true },
        { name: "system_code", label: "System Code", type: "text", readOnly: true, default: "LOCKED" }
      ],
      permissions: ["create", "read", "update", "delete", "submit", "cancel"].map((action) => ({
        action: action as "create" | "read" | "update" | "delete" | "submit" | "cancel",
        permissions: ["crm.customer"]
      }))
    });
    const runtime = createRuntime(defineApp({
      name: "Lifecycle",
      modules: [defineModule({
        id: "billing",
        name: "Billing",
        doctypes: [invoice],
        hooks: {
          beforeValidate: { invoice: [({ input }) => { hooks.push("beforeValidate"); if (typeof input?.title === "string") input.title = input.title.trim(); }] },
          beforeInsert: { invoice: [() => { hooks.push("beforeInsert"); }] },
          afterInsert: { invoice: [() => { hooks.push("afterInsert"); }] },
          beforeUpdate: { invoice: [() => { hooks.push("beforeUpdate"); }] },
          afterUpdate: { invoice: [() => { hooks.push("afterUpdate"); }] },
          beforeSubmit: { invoice: [() => { hooks.push("beforeSubmit"); }] },
          afterSubmit: { invoice: [() => { hooks.push("afterSubmit"); }] },
          beforeCancel: { invoice: [() => { hooks.push("beforeCancel"); }] },
          afterCancel: { invoice: [() => { hooks.push("afterCancel"); }] }
        }
      })]
    }));

    const created = await runtime.create(tenant, "invoice", { title: "  July Invoice  " });
    expect(created).toMatchObject({ id: "july-invoice", documentStatus: "draft", data: { title: "July Invoice", system_code: "LOCKED" } });
    expect(hooks).toEqual(["beforeValidate", "beforeInsert", "afterInsert"]);
    const updated = await runtime.update(tenant, "invoice", created.id, { title: " Updated ", system_code: "FORGED" }, { expectedRevision: 1 });
    expect(updated).toMatchObject({ revision: 2, data: { title: "Updated", system_code: "LOCKED" } });
    const submitted = await runtime.submit(tenant, "invoice", created.id, { expectedRevision: 2, idempotencyKey: "submit-1" });
    expect(submitted).toMatchObject({ revision: 3, documentStatus: "submitted" });
    await expect(runtime.update(tenant, "invoice", created.id, { title: "Too Late" })).rejects.toMatchObject({ code: "DOCUMENT_NOT_DRAFT" });
    await expect(runtime.delete(tenant, "invoice", created.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_DRAFT" });
    await expect(runtime.submit(tenant, "invoice", created.id)).rejects.toMatchObject({ code: "INVALID_DOCUMENT_STATUS" });
    const cancelled = await runtime.cancel(tenant, "invoice", created.id, { expectedRevision: 3 });
    expect(cancelled).toMatchObject({ revision: 4, documentStatus: "cancelled" });
    expect(hooks).toEqual([
      "beforeValidate", "beforeInsert", "afterInsert",
      "beforeValidate", "beforeUpdate", "afterUpdate",
      "beforeValidate", "beforeSubmit", "afterSubmit",
      "beforeValidate", "beforeCancel", "afterCancel"
    ]);
    expect((await runtime.auditTrail(tenant)).map((event) => event.action)).toEqual(expect.arrayContaining(["submit", "cancel"]));
    expect((await runtime.outboxEvents(tenant)).map((event) => event.type)).toEqual(expect.arrayContaining(["invoice.submitted", "invoice.cancelled"]));
  });

  it("runs workflow transitions", async () => {
    const app = defineApp({
      name: "CRM",
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
                { name: "stage", label: "Stage", type: "select", options: ["open", "won"], required: true }
              ],
              permissions: [{ action: "create", roles: ["sales_manager"] }, { action: "read", roles: ["sales_manager"] }, { action: "transition", roles: ["sales_manager"] }],
              workflow: {
                field: "stage",
                initialState: "open",
                states: ["open", "won"],
                transitions: [{ action: "win", from: ["open"], to: "won", roles: ["sales_manager"] }]
              }
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app, { idGenerator: () => "deal123456" });
    const created = await runtime.create(tenant, "deal", { title: "Upgrade" });
    expect(created).toMatchObject({ state: "open", data: { stage: "open" } });
    await expect(runtime.create(tenant, "deal", { title: "Invalid", stage: "won" })).rejects.toMatchObject({ code: "INVALID_INITIAL_STATE" });
    const transitioned = await runtime.transition(tenant, "deal", created.id, "win");

    expect(transitioned.state).toBe("won");
    expect(transitioned.data.stage).toBe("won");
  });

  it("enforces immutable ownership and composable row policies on every command", async () => {
    const secured = defineDocType({
      name: "secured_record", label: "Secured Record", ownership: { transferPermissions: ["records.transfer"] },
      fields: [
        { name: "title", label: "Title", type: "text", required: true },
        { name: "email", label: "Email", type: "text", unique: true },
        { name: "stage", label: "Stage", type: "select", options: ["open", "done"] }
      ],
      rowPolicy: {
        read: [{ owner: "self" }, { owner: "any", roles: ["manager"] }],
        write: [{ owner: "self" }, { owner: "any", permissions: ["records.manage"] }]
      },
      workflow: { field: "stage", initialState: "open", states: ["open", "done"], transitions: [{ action: "finish", from: ["open"], to: "done" }] }
    });
    const reference = defineDocType({
      name: "secured_reference", label: "Secured Reference", fields: [{ name: "target", label: "Target", type: "link", linkTo: "secured_record" }]
    });
    const repository = new InMemoryDocumentRepository();
    const runtime = createRuntime(defineApp({ name: "Rows", modules: [defineModule({ id: "rows", name: "Rows", doctypes: [secured, reference] })] }), {
      repository,
      idGenerator: (() => { let id = 0; return () => `row-${++id}`; })()
    });
    const alice = { tenantId: "tenant", userId: "alice", roles: [], permissions: [] };
    const bob = { ...alice, userId: "bob" };
    const manager = { ...alice, userId: "manager", roles: ["manager"], permissions: ["records.transfer", "records.manage"] };
    const aliceRecord = await runtime.create(alice, "secured_record", { title: "Alice", email: "shared@example.com" });
    const bobRecord = await runtime.create(bob, "secured_record", { title: "Bob", email: "bob@example.com" });
    expect(aliceRecord.ownerId).toBe("alice");
    await expect(repository.update(manager, secured, { ...aliceRecord, ownerId: "bob", data: { ...aliceRecord.data, title: "bypassed" } }, { expectedRevision: 1, ownerTransfer: true } as never))
      .rejects.toMatchObject({ code: "OWNER_IMMUTABLE" });
    expect((await runtime.list(alice, "secured_record")).map((record) => record.id)).toEqual([aliceRecord.id]);
    expect(await runtime.list(manager, "secured_record")).toHaveLength(2);
    await expect(runtime.get(alice, "secured_record", bobRecord.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.update(alice, "secured_record", bobRecord.id, { title: "stolen" })).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.delete(alice, "secured_record", bobRecord.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.transition(alice, "secured_record", bobRecord.id, "finish")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.submit(alice, "secured_record", bobRecord.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.create(bob, "secured_reference", { target: aliceRecord.id })).rejects.toMatchObject({ code: "LINK_NOT_FOUND" });
    await expect(runtime.create(bob, "secured_record", { title: "Hidden unique", email: "shared@example.com" })).rejects.toMatchObject({ code: "UNIQUE_CONSTRAINT_FAILED" });
    await expect(runtime.create(alice, "secured_record", { title: "Forged", ownerId: "bob" })).rejects.toMatchObject({ code: "OWNER_IMMUTABLE" });
    await expect(runtime.transferOwner(bob, "secured_record", aliceRecord.id, "bob")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const transferred = await runtime.transferOwner(manager, "secured_record", aliceRecord.id, "bob", { expectedRevision: aliceRecord.revision });
    expect(transferred).toMatchObject({ ownerId: "bob", revision: 2 });
    expect(transferred).not.toHaveProperty("data");
    await expect(runtime.get(alice, "secured_record", aliceRecord.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.get(bob, "secured_record", aliceRecord.id)).resolves.toMatchObject({ ownerId: "bob" });
    expect((await runtime.auditTrail(manager)).map((event) => event.action)).toContain("transfer_owner");
  });

  it("rolls back ownership, access, and revision when a transfer side effect fails", async () => {
    const secured = defineDocType({
      name: "owned_note", label: "Owned Note", ownership: { transferPermissions: ["notes.transfer"] },
      fields: [{ name: "title", label: "Title", type: "text", required: true }],
      rowPolicy: { read: [{ owner: "self" }], write: [{ owner: "self" }] }
    });
    const runtime = createRuntime(defineApp({ name: "Transfer rollback", modules: [defineModule({
      id: "notes", name: "Notes", doctypes: [secured], hooks: {
        afterOwnerTransfer: { owned_note: [({ document }) => { if (document?.ownerId === "bob") throw new Error("injected transfer failure"); }] }
      }
    })] }), { idGenerator: () => "owned-note-1" });
    const alice = { tenantId: "tenant", userId: "alice", roles: [], permissions: [] };
    const bob = { ...alice, userId: "bob" };
    const manager = { ...alice, userId: "manager", permissions: ["notes.transfer"] };
    const created = await runtime.create(alice, "owned_note", { title: "Alice's note" });

    await expect(runtime.transferOwner(manager, "owned_note", created.id, "bob", { expectedRevision: 1 })).rejects.toThrow("injected transfer failure");
    await expect(runtime.get(alice, "owned_note", created.id)).resolves.toMatchObject({ ownerId: "alice", revision: 1, data: { title: "Alice's note" } });
    await expect(runtime.get(bob, "owned_note", created.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    expect(await runtime.auditTrail(manager)).not.toEqual(expect.arrayContaining([expect.objectContaining({ action: "transfer_owner" })]));
  });

  it("isolates owner-transfer hook mutation and replays the persisted result exactly", async () => {
    const realtime: unknown[] = [];
    const listeners: Array<(event: never) => void> = [];
    const secured = defineDocType({
      name: "transfer_note", label: "Transfer Note", ownership: { transferPermissions: ["notes.transfer"] },
      fields: [{ name: "title", label: "Title", type: "text", required: true }],
      rowPolicy: { read: [{ owner: "self" }], write: [{ owner: "self" }] }
    });
    const mutateSnapshot: DocumentHook = ({ document }) => {
      if (!document) return;
      document.revision = 999; document.documentStatus = "cancelled"; document.ownerId = "mallory"; document.data.title = "hook mutation";
    };
    const runtime = createRuntime(defineApp({ name: "Transfer snapshot", modules: [defineModule({
      id: "notes", name: "Notes", doctypes: [secured], hooks: {
        beforeOwnerTransfer: { transfer_note: [mutateSnapshot] }, afterOwnerTransfer: { transfer_note: [mutateSnapshot] }
      }
    })] }), {
      idGenerator: (() => { let id = 0; return () => `transfer-${++id}`; })(),
      realtime: {
        publish(event) { realtime.push(event); for (const listener of listeners) listener(event as never); },
        subscribe(_channel, listener) { listeners.push(listener as (event: never) => void); return () => undefined; }
      }
    });
    const alice = { tenantId: "tenant", userId: "alice", roles: [], permissions: [] };
    const bob = { ...alice, userId: "bob" };
    const manager = { ...alice, userId: "manager", permissions: ["notes.transfer"] };
    const subscribed: unknown[] = [];
    await runtime.subscribeRealtime(manager, (event) => subscribed.push(event));
    const created = await runtime.create(alice, "transfer_note", { title: "canonical" });
    const transferred = await runtime.transferOwner(manager, "transfer_note", created.id, "bob", { expectedRevision: 1, idempotencyKey: "transfer-once" });
    expect(transferred).toEqual({ id: created.id, ownerId: "bob", revision: 2, updatedAt: expect.any(String) });
    await expect(runtime.get(bob, "transfer_note", created.id)).resolves.toMatchObject({ ownerId: "bob", revision: 2, documentStatus: "draft", data: { title: "canonical" } });
    const payload = (await runtime.outboxEvents(manager)).find((event) => event.type === "transfer_note.owner.transferred")?.payload;
    expect(payload).toEqual({ doctype: "transfer_note", ...transferred });
    expect(payload).not.toHaveProperty("data");
    expect(realtime.at(-1)).toMatchObject({ type: "transfer_note.owner.transferred", payload: { doctype: "transfer_note", ...transferred } });
    expect((realtime.at(-1) as { payload: object }).payload).not.toHaveProperty("data");
    expect(subscribed.at(-1)).toEqual(realtime.at(-1));
    await expect(runtime.get(alice, "transfer_note", created.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(runtime.transferOwner(manager, "transfer_note", created.id, "bob", { expectedRevision: 1, idempotencyKey: "transfer-once" })).resolves.toEqual(transferred);
  });

  it("plans row policy changes as explicit destructive migrations", async () => {
    const base = defineDocType({ name: "note", label: "Note", fields: [{ name: "title", label: "Title", type: "text" }] });
    const current = defineApp({ name: "Policy Migration", modules: [defineModule({ id: "notes", name: "Notes", doctypes: [base] })] });
    const next = defineApp({ name: current.name, version: "1.0.0", modules: [defineModule({
      id: "notes", name: "Notes", version: "1.0.0", doctypes: [defineDocType({
        ...base, ownership: { transferPermissions: ["notes.transfer"] },
        rowPolicy: { read: [{ owner: "self" }], write: [{ owner: "self" }] }
      })]
    })] });
    const plan = await createRuntime(current, { idGenerator: () => "policy-migration" }).planMigration(tenant, next);
    expect(plan.changes).toContainEqual(expect.objectContaining({ kind: "change_row_policy", doctype: "note", destructive: true }));
    await expect(validateMigrationPlan(plan)).resolves.toBeUndefined();
    expect(() => assertDestructiveMigration(plan, {})).toThrow(/destructive/i);
  });

  it("owns ordered child rows transactionally and manages authorized attachment bytes", async () => {
    const product = defineDocType({
      name: "product", label: "Product", fields: [{ name: "name", label: "Name", type: "text" }]
    });
    const order = defineDocType({
      name: "order", label: "Order",
      ownership: {},
      rowPolicy: { read: [{ owner: "self" }], write: [{ owner: "self" }] },
      fields: [
        { name: "title", label: "Title", type: "text", required: true },
        { name: "lines", label: "Lines", type: "children", required: true, fields: [
          { name: "sku", label: "SKU", type: "text", required: true },
          { name: "quantity", label: "Quantity", type: "number", required: true },
          { name: "product", label: "Product", type: "link", linkTo: "product" }
        ] },
        { name: "files", label: "Files", type: "attachments" }
      ],
      permissions: [
        { action: "create", permissions: ["orders.write"] }, { action: "read", permissions: ["orders.read"] },
        { action: "update", permissions: ["orders.write"] }, { action: "delete", permissions: ["orders.write"] }
      ]
    });
    let id = 0;
    const storage = new InMemoryAttachmentStorage();
    const runtime = createRuntime(defineApp({ name: "Orders", modules: [defineModule({ id: "orders", name: "Orders", doctypes: [product, order] })] }), {
      idGenerator: () => `id-${++id}`, attachmentStorage: storage
    });
    const writer = { tenantId: "tenant", userId: "writer", roles: [], permissions: ["orders.read", "orders.write", "framekit.attachments.cleanup"] };
    const reader = { ...writer, permissions: ["orders.read"] };
    await expect(runtime.create(writer, "order", { title: "Forged", lines: [], files: [{ id: "forged" }] }))
      .rejects.toMatchObject({ code: "ATTACHMENTS_MANAGED" });
    const created = await runtime.create(writer, "order", { title: "Order", lines: [{ sku: "A", quantity: "2" }, { sku: "B", quantity: 1 }] });
    const initialLines = created.data.lines as Array<{ id: string; position: number; data: Record<string, unknown> }>;
    expect(initialLines.map((line) => [line.position, line.data])).toEqual([[0, { sku: "A", quantity: 2 }], [1, { sku: "B", quantity: 1 }]]);
    const reordered = await runtime.update(writer, "order", created.id, { lines: [initialLines[1], initialLines[0]] });
    expect((reordered.data.lines as typeof initialLines).map((line) => [line.id, line.position])).toEqual([[initialLines[1]!.id, 0], [initialLines[0]!.id, 1]]);
    await expect(runtime.update(writer, "order", created.id, { lines: [{ id: "foreign", data: { sku: "X", quantity: 1 } }] })).rejects.toMatchObject({ code: "INVALID_CHILD_ID" });
    await expect(runtime.update(writer, "order", created.id, { lines: [{ ...initialLines[0], data: { ...initialLines[0]!.data, product: "missing" } }] }))
      .rejects.toMatchObject({ code: "LINK_NOT_FOUND", details: { field: "lines.product" } });
    await expect(runtime.get(writer, "order", created.id)).resolves.toMatchObject({ revision: 2, data: { lines: reordered.data.lines } });

    await expect(runtime.uploadAttachment(reader, "order", created.id, "files", { name: "denied.txt", contentType: "text/plain", bytes: new Uint8Array([1]) }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const attachment = await runtime.uploadAttachment(writer, "order", created.id, "files", { name: "invoice.txt", contentType: "text/plain", bytes: new Uint8Array([1, 2, 3]) }, { expectedRevision: 2 });
    expect(attachment).toMatchObject({ name: "invoice.txt", size: 3, createdBy: "writer" });
    await expect(runtime.downloadAttachment(reader, "order", created.id, "files", attachment.id)).resolves.toMatchObject({ metadata: { id: attachment.id }, bytes: new Uint8Array([1, 2, 3]) });
    await runtime.deleteAttachment(writer, "order", created.id, "files", attachment.id, { expectedRevision: 3 });
    await expect(runtime.downloadAttachment(reader, "order", created.id, "files", attachment.id)).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
    const otherWriter = { ...writer, userId: "other-writer", permissions: ["orders.read", "orders.write"] };
    const otherOrder = await runtime.create(otherWriter, "order", { title: "Other", lines: [{ sku: "PRIVATE", quantity: 1 }] });
    const referencedHiddenAttachment = await runtime.uploadAttachment(otherWriter, "order", otherOrder.id, "files", { name: "private.txt", contentType: "text/plain", bytes: new Uint8Array([7]) });
    await storage.put("tenant/orphan", new Uint8Array([9]), { contentType: "application/octet-stream" });
    await expect(runtime.cleanupOrphanAttachments(writer)).resolves.toEqual(["tenant/orphan"]);
    expect(await storage.list("tenant/")).toEqual([referencedHiddenAttachment.storageKey]);
  });

  it("reports runtime diagnostics", async () => {
    const app = defineApp({
      name: "Diagnostics",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [{ name: "name", label: "Name", type: "text" }],
              indexes: [["name"]]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app);

    await expect(runtime.diagnostics()).resolves.toMatchObject({
      app: { name: "Diagnostics" },
      repository: { kind: "memory", durable: false },
      audit: { kind: "memory", durable: false },
      outbox: { kind: "memory", durable: false },
      namingSeries: { kind: "memory", durable: false },
      realtime: { kind: "none", durable: false },
      doctypes: [{ name: "customer", workflow: false }]
    });
  });

  it("plans child schema changes explicitly and guards incompatible collection migrations", async () => {
    const currentDocType = defineDocType({ name: "order", label: "Order", fields: [
      { name: "lines", label: "Lines", type: "children", fields: [{ name: "sku", label: "SKU", type: "text" }] }
    ] });
    const nextDocType = defineDocType({ name: "order", label: "Order", fields: [
      { name: "lines", label: "Lines", type: "children", fields: [{ name: "sku", label: "SKU", type: "text", required: true }] },
      { name: "files", label: "Files", type: "attachments" }
    ] });
    const current = defineApp({ name: "Collections", modules: [defineModule({ id: "orders", name: "Orders", doctypes: [currentDocType] })] });
    const next = defineApp({ name: "Collections", modules: [defineModule({ id: "orders", name: "Orders", doctypes: [nextDocType] })] });
    const plan = await createRuntime(current, { idGenerator: () => "collection-migration" }).planMigration(tenant, next);
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "change_collection_schema", field: "lines", destructive: true }),
      expect.objectContaining({ kind: "add_field", field: "files", destructive: false })
    ]));
    await expect(validateMigrationPlan(plan)).resolves.toBeUndefined();
    expect(() => assertDestructiveMigration(plan, {})).toThrow(/destructive/i);
  });

  it("records audit events for mutations", async () => {
    const app = defineApp({
      name: "Audit",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [{ name: "name", label: "Name", type: "text", required: true }],
              permissions: [{ action: "create", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app, { idGenerator: () => "audit123456" });

    await runtime.create(tenant, "customer", { name: "Audit Co" });

    await expect(runtime.auditTrail(tenant)).resolves.toMatchObject([{ action: "create", doctype: "customer" }]);
    await expect(runtime.outboxEvents(tenant)).resolves.toMatchObject([{ type: "customer.created", topic: "customer" }]);
  });

  it("applies tenant custom fields to metadata and document writes", async () => {
    const app = defineApp({
      name: "Custom",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [{ name: "name", label: "Name", type: "text", required: true }],
              permissions: [{ action: "create", permissions: ["crm.customer"] }, { action: "read", permissions: ["crm.customer"] }, { action: "update", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app, { idGenerator: () => "custom123456" });

    await runtime.addCustomField(tenant, {
      doctype: "customer",
      field: { name: "region", label: "Region", type: "select", options: ["apac", "emea"], inList: true }
    });
    const created = await runtime.create(tenant, "customer", { name: "Custom Co", region: "apac" });
    const metadata = await runtime.metadata(tenant);

    expect(created.data.region).toBe("apac");
    await expect(runtime.create(tenant, "customer", { name: "Typo Co", region: "apac", reigon: "apac" })).rejects.toMatchObject({
      code: "FIELD_VALIDATION_FAILED",
      details: { violations: [{ field: "reigon", rule: "schema", code: "unknown_field" }] }
    });
    await expect(runtime.update(tenant, "customer", created.id, { region: "emea", reigon: "emea" }, { expectedRevision: created.revision })).rejects.toMatchObject({
      code: "FIELD_VALIDATION_FAILED",
      details: { violations: [{ field: "reigon", rule: "schema", code: "unknown_field" }] }
    });
    await expect(runtime.get(tenant, "customer", created.id)).resolves.toMatchObject({ revision: 1, data: { region: "apac" } });
    expect(metadata.modules[0]?.doctypes[0]?.fields.map((field) => field.name)).toContain("region");
    await expect(runtime.addCustomField(tenant, {
      doctype: "customer",
      field: { name: "invalid_select", label: "Invalid", type: "select" }
    })).rejects.toThrow("requires options");
    await expect(runtime.addCustomField(tenant, {
      doctype: "customer",
      field: { name: "missing_link", label: "Missing", type: "link", linkTo: "unknown" }
    })).rejects.toMatchObject({ code: "DOCTYPE_NOT_FOUND" });
  });

  it("stores tenant view metadata", async () => {
    const app = defineApp({
      name: "Views",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [
                { name: "name", label: "Name", type: "text" },
                { name: "owner", label: "Owner", type: "text" }
              ]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app);

    await runtime.upsertView(tenant, { doctype: "customer", type: "list", fields: ["owner", "name"] });
    const metadata = await runtime.metadata(tenant);

    expect(metadata.modules[0]?.doctypes[0]?.views[0]).toMatchObject({ type: "list", fields: ["owner", "name"] });
  });

  it("plans and records metadata migrations", async () => {
    const current = defineApp({
      name: "Migrations",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [{ name: "name", label: "Name", type: "text" }]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(current, { idGenerator: () => "migration-1" });
    const next = defineApp({
      name: "Migrations",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [
                { name: "name", label: "Name", type: "text" },
                { name: "region", label: "Region", type: "text", unique: true }
              ],
              indexes: [["region"]]
            })
          ]
        })
      ]
    });

    const plan = await runtime.planMigration(tenant, next);
    const applied = await runtime.applyMigration(tenant, plan);

    expect(plan.checksum).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "add_field", doctype: "customer", field: "region", destructive: false }),
      expect.objectContaining({ kind: "add_unique_constraint", doctype: "customer", field: "region", destructive: false }),
      expect.objectContaining({ kind: "add_index", doctype: "customer", field: "region", destructive: false })
    ]));
    expect(plan.changes[0]?.rollback).toMatchObject({ kind: "remove_field", doctype: "customer", field: "region" });
    expect(createExecutableMigrationArtifact(plan)).toMatchObject({
      id: "migration-1",
      up: expect.arrayContaining([expect.objectContaining({ kind: "add_field", field: "region" })]),
      down: expect.arrayContaining([expect.objectContaining({ kind: "remove_field", field: "region" })])
    });
    await expect(runtime.applyMigration(tenant, { ...plan, changes: [] })).rejects.toMatchObject({ code: "MIGRATION_CHECKSUM_MISMATCH" });
    await expect(runtime.migrationHistory(tenant)).resolves.toEqual([applied]);

    const rollback = await createRollbackMigrationPlan(applied, { id: "migration-1-down", createdAt: "2026-07-06T00:00:00.000Z" });
    expect(rollback).toMatchObject({
      id: "migration-1-down",
      changes: expect.arrayContaining([expect.objectContaining({ kind: "remove_field", field: "region" })])
    });
    await expect(runtime.rollbackMigration(tenant, applied, { id: "migration-1-down", allowDestructive: true })).resolves.toMatchObject({ id: "migration-1-down" });
  });

  it("validates migration identity, replay, drift, unsupported conversions, and DocType removal", async () => {
    const customer = defineDocType({ name: "customer", label: "Customer", fields: [{ name: "name", label: "Name", type: "text" }] });
    const current = defineApp({ name: "Migration State", modules: [defineModule({ id: "crm", name: "CRM", doctypes: [customer] })] });
    const next = defineApp({
      name: "Migration State",
      modules: [defineModule({ id: "crm", name: "CRM", doctypes: [defineDocType({
        ...customer,
        fields: [...customer.fields, { name: "code", label: "Code", type: "text", unique: true }]
      })] })]
    });
    let id = 0;
    const runtime = createRuntime(current, { idGenerator: () => `migration-${++id}` });
    const plan = await runtime.planMigration(tenant, next);
    const applied = await runtime.applyMigration(tenant, plan);
    await expect(runtime.applyMigration(tenant, plan)).resolves.toEqual(applied);
    await expect(runtime.applyMigration({ ...tenant, tenantId: "other" }, plan)).rejects.toMatchObject({ code: "MIGRATION_TENANT_MISMATCH" });
    const wrongApp = { ...plan, appName: "Another App" };
    await expect(runtime.applyMigration(tenant, { ...wrongApp, checksum: await migrationChecksum(wrongApp) })).rejects.toMatchObject({ code: "MIGRATION_APP_MISMATCH" });

    const conflicting = { ...plan, toSchemaChecksum: "different-target" };
    const validConflict = { ...conflicting, checksum: await migrationChecksum(conflicting) };
    await expect(runtime.applyMigration(tenant, validConflict)).rejects.toMatchObject({ code: "MIGRATION_ID_CONFLICT" });

    const drifted = await runtime.planMigration(tenant, next);
    await expect(runtime.applyMigration(tenant, drifted)).rejects.toMatchObject({ code: "MIGRATION_SCHEMA_DRIFT" });

    const converted = defineApp({
      name: "Migration State",
      modules: [defineModule({ id: "crm", name: "CRM", doctypes: [defineDocType({
        ...customer,
        fields: [{ name: "name", label: "Name", type: "number" }]
      })] })]
    });
    const conversionPlan = await runtime.planMigration(tenant, converted);
    await expect(runtime.applyMigration(tenant, conversionPlan, { allowDestructive: true })).rejects.toMatchObject({ code: "UNSUPPORTED_MIGRATION_CONVERSION" });
    const conversion = {
      id: "customer-name-number",
      version: 1,
      doctype: "customer",
      field: "name",
      fromType: "text",
      toType: "number",
      parameters: { offset: 0 },
      artifactDigest: `sha256:${"A".repeat(43)}`
    };
    const onlineUnsigned = { ...conversionPlan, conversions: [conversion] };
    const onlinePlan = { ...onlineUnsigned, checksum: await migrationChecksum(onlineUnsigned) };
    await expect(validateMigrationPlan(onlinePlan)).resolves.toBeUndefined();
    const changedParameters = { ...onlineUnsigned, conversions: [{ ...conversion, parameters: { offset: 100 } }] };
    expect(await migrationChecksum(changedParameters)).not.toBe(onlinePlan.checksum);
    const mismatchedUnsigned = { ...conversionPlan, conversions: [{ ...conversion, toType: "boolean" }] };
    const mismatchedPlan = { ...mismatchedUnsigned, checksum: await migrationChecksum(mismatchedUnsigned) };
    await expect(validateMigrationPlan(mismatchedPlan)).rejects.toMatchObject({ code: "INVALID_MIGRATION_CONVERSION" });
    await expect(runtime.migrationHistory(tenant)).resolves.toHaveLength(1);

    const exactCurrent = defineApp({ name: "Exact", modules: [defineModule({ id: "billing", name: "Billing", doctypes: [defineDocType({ name: "invoice", label: "Invoice", fields: [{ name: "amount", label: "Amount", type: "decimal", precision: 18, scale: 2 }] })] })] });
    const exactNext = defineApp({ name: "Exact", modules: [defineModule({ id: "billing", name: "Billing", doctypes: [defineDocType({ name: "invoice", label: "Invoice", fields: [{ name: "amount", label: "Amount", type: "decimal", precision: 24, scale: 4 }] })] })] });
    const exactPlan = await createRuntime(exactCurrent, { idGenerator: () => "exact-change" }).planMigration(tenant, exactNext);
    expect(exactPlan.changes).toEqual([expect.objectContaining({ kind: "change_field_type", destructive: true, from: "decimal(18,2)", to: "decimal(24,4)" })]);

    const supplier = defineDocType({ name: "supplier", label: "Supplier", fields: [{ name: "name", label: "Name", type: "text" }] });
    const replacement = defineApp({ name: "Migration State", modules: [defineModule({ id: "crm", name: "CRM", doctypes: [supplier] })] });
    const replacementRuntime = createRuntime(current, { idGenerator: () => "replace-doctype" });
    const replacementPlan = await replacementRuntime.planMigration(tenant, replacement);
    expect(replacementPlan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "add_doctype", doctype: "supplier" }),
      expect.objectContaining({ kind: "remove_doctype", doctype: "customer", destructive: true })
    ]));
    expect(createExecutableMigrationArtifact(replacementPlan).down).toEqual([]);
    const replacementRecord = await replacementRuntime.applyMigration(tenant, replacementPlan, { allowDestructive: true });
    await expect(replacementRuntime.rollbackMigration(tenant, replacementRecord, { allowDestructive: true })).rejects.toMatchObject({ code: "IRREVERSIBLE_MIGRATION" });

    expect(() => defineApp({ name: "Migration State", modules: [defineModule({ id: "crm", name: "CRM", doctypes: [defineDocType({
      name: "order",
      label: "Order",
      fields: [{ name: "customer", label: "Customer", type: "link", linkTo: "missing" }]
    })] })] })).toThrow(/unknown DocType "missing"/);

    expect(() => defineApp({ name: "Migration State", modules: [defineModule({ id: "crm", name: "CRM", doctypes: [defineDocType({
      name: "customer",
      label: "Customer",
      fields: [{ name: "name", label: "Name", type: "text" }],
      views: [{ id: "customer.list", doctype: "customer", type: "list", fields: ["missing"] }]
    })] })] })).toThrow(/unknown field "missing"/);
  });

  it("generates predictable naming series", async () => {
    const app = defineApp({
      name: "Series",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "deal",
              label: "Deal",
              naming: { prefix: "DEAL", series: true, digits: 3 },
              fields: [{ name: "title", label: "Title", type: "text", required: true }],
              permissions: [{ action: "create", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app);

    await expect(runtime.create(tenant, "deal", { title: "One" })).resolves.toMatchObject({ id: "DEAL-001" });
    await expect(runtime.create(tenant, "deal", { title: "Two" })).resolves.toMatchObject({ id: "DEAL-002" });
  });

  it("publishes realtime document events", async () => {
    const events: unknown[] = [];
    const runtime = createRuntime(
      defineApp({
        name: "Realtime",
        modules: [
          defineModule({
            id: "crm",
            name: "CRM",
            doctypes: [
              defineDocType({
                name: "customer",
                label: "Customer",
                fields: [{ name: "name", label: "Name", type: "text", required: true }],
                permissions: [{ action: "create", permissions: ["crm.customer"] }]
              })
            ]
          })
        ]
      }),
      {
        realtime: {
          publish: (event) => {
            events.push(event);
          }
        }
      }
    );

    await runtime.create(tenant, "customer", { name: "Live Co" });

    expect(events).toMatchObject([{ channel: "tenant:tenant_1:documents", type: "customer.created" }]);
  });

  it("lists realtime events when the publisher supports history", async () => {
    const published: Array<{ channel: string; type: string; payload: Record<string, unknown> }> = [];
    const runtime = createRuntime(
      defineApp({
        name: "Realtime History",
        modules: [
          defineModule({
            id: "crm",
            name: "CRM",
            doctypes: [
              defineDocType({
                name: "customer",
                label: "Customer",
                fields: [{ name: "name", label: "Name", type: "text", required: true }],
                permissions: [{ action: "create", permissions: ["crm.customer"] }]
              })
            ]
          })
        ]
      }),
      {
        realtime: {
          publish: (event) => {
            published.push(event);
          },
          list: (channel) => published.filter((event) => event.channel === channel)
        }
      }
    );

    await runtime.create(tenant, "customer", { name: "History Co" });

    await expect(runtime.realtimeEvents(tenant)).resolves.toMatchObject([{ type: "customer.created" }]);
  });

  it("subscribes to realtime document events when the publisher supports streaming", async () => {
    const listeners = new Set<(event: { channel: string; type: string; payload: Record<string, unknown> }) => void>();
    const received: unknown[] = [];
    const runtime = createRuntime(
      defineApp({
        name: "Realtime Stream",
        modules: [
          defineModule({
            id: "crm",
            name: "CRM",
            doctypes: [
              defineDocType({
                name: "customer",
                label: "Customer",
                fields: [{ name: "name", label: "Name", type: "text", required: true }],
                permissions: [{ action: "create", permissions: ["crm.customer"] }]
              })
            ]
          })
        ]
      }),
      {
        realtime: {
          publish: (event) => {
            for (const listener of listeners) {
              listener(event);
            }
          },
          subscribe: (_channel, listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          }
        }
      }
    );

    const unsubscribe = await runtime.subscribeRealtime(tenant, (event) => received.push(event));
    await runtime.create(tenant, "customer", { name: "Stream Co" });
    unsubscribe();

    expect(received).toMatchObject([{ type: "customer.created" }]);
  });
});

import { describe, expect, it } from "vitest";
import { defineApp, defineDocType, defineModule, FramekitError, getDocType, hasRowAccess, rowPolicyScope } from "./index.js";

describe("core metadata", () => {
  it("defines an app with modules and doctypes", () => {
    const customer = defineDocType({
      name: "customer",
      label: "Customer",
      fields: [{ name: "name", label: "Name", type: "text", required: true }]
    });
    const crm = defineModule({ id: "crm", name: "CRM", doctypes: [customer] });
    const app = defineApp({ name: "Acme", modules: [crm] });

    expect(getDocType(app, "customer").label).toBe("Customer");
  });

  it("rejects unknown doctypes", () => {
    const app = defineApp({ name: "Empty" });
    expect(() => getDocType(app, "missing")).toThrow(FramekitError);
  });

  it("rejects duplicate fields", () => {
    expect(() =>
      defineDocType({
        name: "bad",
        label: "Bad",
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "title", label: "Title again", type: "text" }
        ]
      })
    ).toThrow(/Duplicate field/);
  });

  it("validates workflow, index, naming, and view field references", () => {
    expect(() => defineDocType({
      name: "deal",
      label: "Deal",
      fields: [{ name: "stage", label: "Stage", type: "select", options: ["open", "won"] }],
      indexes: [["missing"]]
    })).toThrow(/unknown field "missing"/);
    expect(() => defineDocType({
      name: "deal",
      label: "Deal",
      fields: [{ name: "stage", label: "Stage", type: "select", options: ["open", "won"] }],
      workflow: { field: "stage", initialState: "open", states: ["open", "won"], transitions: [{ action: "win", from: ["missing"], to: "won" }] }
    })).toThrow(/unknown state "missing"/);
    expect(() => defineDocType({
      name: "deal",
      label: "Deal",
      fields: [{ name: "stage", label: "Stage", type: "select", options: ["open", "won"], default: "won" }],
      workflow: { field: "stage", initialState: "open", states: ["open", "won"] }
    })).toThrow(/must match initial state "open"/);
    expect(defineDocType({
      name: "deal",
      label: "Deal",
      fields: [{ name: "stage", label: "Stage", type: "select", options: ["open", "won"], default: "open" }],
      workflow: { field: "stage", initialState: "open", states: ["open", "won"] }
    }).workflow?.initialState).toBe("open");
    expect(() => defineDocType({
      name: "deal",
      label: "Deal",
      fields: [{ name: "sequence", label: "Sequence", type: "number" }],
      naming: { field: "sequence" }
    })).toThrow(/must be text/);
    expect(() => defineDocType({
      name: "deal",
      label: "Deal",
      fields: [{ name: "title", label: "Title", type: "text" }],
      views: [{ id: "deal-form", doctype: "deal", type: "form", fields: ["missing"] }]
    })).toThrow(/unknown field "missing"/);
  });

  it("validates link targets, module identities, hooks, and dependency cycles", () => {
    const linked = defineDocType({ name: "deal", label: "Deal", fields: [{ name: "customer", label: "Customer", type: "link", linkTo: "customer" }] });
    expect(() => defineApp({ name: "Broken Link", modules: [defineModule({ id: "crm", name: "CRM", doctypes: [linked] })] })).toThrow(/unknown DocType "customer"/);
    expect(() => defineApp({ name: "Duplicate Modules", modules: [
      defineModule({ id: "crm", name: "CRM" }), defineModule({ id: "crm", name: "CRM Again" })
    ] })).toThrow(/Duplicate module id/);
    expect(() => defineApp({ name: "Cycle", modules: [
      defineModule({ id: "sales", name: "Sales", dependencies: ["billing"] }),
      defineModule({ id: "billing", name: "Billing", dependencies: ["sales"] })
    ] })).toThrow(/dependency cycle/);
    expect(() => defineApp({ name: "Hook", modules: [defineModule({
      id: "crm", name: "CRM", hooks: { beforeValidate: { missing: [() => undefined] } }
    })] })).toThrow(/targets unknown DocType "missing"/);
    expect(() => defineModule({ id: "crm", name: "CRM", hooks: { beforeValidte: {} } as never })).toThrow(/unrecognized key/i);
    expect(() => defineModule({ id: "crm", name: "CRM", hooks: { beforeValidate: { customer: ["not-a-function"] } } as never })).toThrow(/Hook must be a function/);
    expect(() => defineModule({ id: "crm", name: "CRM", hooks: { beforeValidate: [] } as never })).toThrow();
  });

  it("requires strict semantic versions for apps and modules", () => {
    expect(() => defineApp({ name: "Bad", version: "v1" })).toThrow(/valid SemVer/);
    expect(() => defineModule({ id: "bad", name: "Bad", version: "1.0" })).toThrow(/valid SemVer/);
    expect(defineApp({ name: "RC", version: "1.2.3-rc.1+build.5" }).version).toBe("1.2.3-rc.1+build.5");
  });

  it("validates and composes ownership row policies", () => {
    expect(() => defineDocType({
      name: "private_note", label: "Private Note", fields: [],
      rowPolicy: { read: [{ owner: "self" }], write: [{ owner: "self" }] }
    })).toThrow(/without ownership metadata/);
    expect(() => defineDocType({
      name: "typo_policy", label: "Typo Policy", fields: [], ownership: {},
      rowPolicy: { read: [{ owner: "any", permisisons: ["notes.read"] }], write: [{ owner: "self" }] }
    } as never)).toThrow(/unrecognized key/i);
    expect(() => defineDocType({
      name: "typo_policy", label: "Typo Policy", fields: [], ownership: { transferPermissions: [], typo: true },
      rowPolicy: { read: [{ owner: "self" }], write: [{ owner: "self" }] }
    } as never)).toThrow(/unrecognized key/i);
    const note = defineDocType({
      name: "private_note", label: "Private Note", fields: [], ownership: { transferPermissions: ["note.transfer"] },
      rowPolicy: {
        read: [{ owner: "self" }, { owner: "any", roles: ["manager"] }],
        write: [{ owner: "self" }, { owner: "any", permissions: ["note.manage"] }]
      }
    });
    const alice = { tenantId: "t", userId: "alice", roles: [], permissions: [] };
    expect(rowPolicyScope(alice, note, "read")).toBe("self");
    expect(hasRowAccess(alice, note, "read", "alice")).toBe(true);
    expect(hasRowAccess(alice, note, "read", "bob")).toBe(false);
    expect(rowPolicyScope({ ...alice, roles: ["manager"] }, note, "read")).toBe("all");
    expect(rowPolicyScope({ ...alice, permissions: ["note.manage"] }, note, "write")).toBe("all");
  });

  it("validates command metadata and cross-module identities", () => {
    const record = defineDocType({ name: "record", label: "Record", fields: [] });
    const command = { id: "bulk-update", label: "Bulk update", permission: "records.bulk", doctypes: [record.name], operations: ["update" as const] };
    expect(defineApp({ name: "Commands", modules: [defineModule({ id: "records", name: "Records", doctypes: [record], commands: [command] })] })
      .modules[0]?.commands[0]).toMatchObject({ ...command, mode: "atomic", maxOperations: 100 });
    expect(() => defineApp({ name: "Unknown target", modules: [defineModule({
      id: "records", name: "Records", doctypes: [record], commands: [{ ...command, doctypes: ["missing"] }]
    })] })).toThrow(/targets unknown DocType "missing"/);
    expect(() => defineApp({ name: "Duplicate commands", modules: [
      defineModule({ id: "left", name: "Left", doctypes: [record], commands: [command] }),
      defineModule({ id: "right", name: "Right", commands: [{ ...command, doctypes: [record.name] }] })
    ] })).toThrow(/Duplicate command id/);
    expect(() => defineModule({ id: "typo", name: "Typo", commands: [{ ...command, maxOperatons: 2 }] as never })).toThrow(/unrecognized key/i);
  });

  it("validates exact decimals, computed dependencies, and declarative validators", () => {
    const invoice = defineDocType({
      name: "invoice",
      label: "Invoice",
      fields: [
        { name: "subtotal", label: "Subtotal", type: "decimal", precision: 24, scale: 4 },
        { name: "tax", label: "Tax", type: "decimal", precision: 24, scale: 4 },
        { name: "total", label: "Total", type: "decimal", precision: 24, scale: 4, computed: { operation: "sum", dependencies: ["subtotal", "tax"] } },
        { name: "code", label: "Code", type: "text", validators: [{ kind: "length", min: 3, max: 12 }, { kind: "pattern", pattern: "slug" }] }
      ]
    });
    expect(invoice.fields[2]?.computed?.dependencies).toEqual(["subtotal", "tax"]);
    expect(defineDocType({ name: "fraction", label: "Fraction", fields: [{ name: "rate", label: "Rate", type: "decimal", precision: 2, scale: 2, default: "0.12" }] }).fields[0]?.default).toBe("0.12");
    expect(() => defineDocType({ name: "bad", label: "Bad", fields: [{ name: "amount", label: "Amount", type: "decimal", precision: 2, scale: 3 }] })).toThrow(/scale/i);
    expect(() => defineDocType({ name: "cycle", label: "Cycle", fields: [
      { name: "a", label: "A", type: "text", computed: { operation: "concat", dependencies: ["b"] } },
      { name: "b", label: "B", type: "text", computed: { operation: "concat", dependencies: ["a"] } }
    ] })).toThrow(/cycle/i);
    expect(() => defineDocType({ name: "bad", label: "Bad", fields: [{ name: "count", label: "Count", type: "number", validators: [{ kind: "length", min: 1 }] }] })).toThrow(/length validator/i);
    expect(() => defineDocType({ name: "bad", label: "Bad", fields: [{ name: "count", label: "Count", type: "number", validators: [{ kind: "range", min: "not-a-number" }] }] })).toThrow(/finite safe number/i);
    expect(() => defineDocType({ name: "bad", label: "Bad", fields: [{ name: "flag", label: "Flag", type: "boolean", validators: [{ kind: "domain", values: [true, "true"] }] }] })).toThrow(/must be boolean/i);
    expect(() => defineDocType({ name: "bad", label: "Bad", fields: [{ name: "amount", label: "Amount", type: "decimal", precision: 8, scale: 2, validators: [{ kind: "domain", values: ["1", "1.00"] }] }] })).toThrow(/duplicate canonical/i);
    expect(() => defineDocType({ name: "bad", label: "Bad", fields: [
      { name: "a", label: "A", type: "decimal" },
      { name: "total", label: "Total", type: "decimal", computed: { operation: "sum", dependencies: ["a"], separator: "," } as never }
    ] })).toThrow(/unrecognized key/i);
    expect(() => defineDocType({ name: "bad", label: "Bad", fields: [{ name: "code", label: "Code", type: "text", validators: [{ kind: "pattern", pattern: "slug", typo: true }] as never }] })).toThrow(/unrecognized key/i);
    const canonical = defineDocType({ name: "canonical", label: "Canonical", fields: [{
      name: "amount", label: "Amount", type: "decimal", precision: 8, scale: 2, default: "1",
      validators: [{ kind: "range", min: "0", max: "2" }, { kind: "domain", values: ["1"] }]
    }] });
    expect(canonical.fields[0]).toMatchObject({ default: "1.00", validators: [{ min: "0.00", max: "2.00" }, { values: ["1.00"] }] });
  });
});

import { describe, expect, it } from "vitest";
import { defineApp, defineDocType, defineModule, FramekitError, getDocType } from "./index.js";

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
  });
});

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
});

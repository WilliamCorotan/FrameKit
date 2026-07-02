import { describe, expect, it } from "vitest";
import { defineApp, defineDocType, defineModule } from "@framekit/core";
import { createOpenApiDocument } from "./index.js";

describe("createOpenApiDocument", () => {
  it("generates paths and schemas from DocType metadata", () => {
    const app = defineApp({
      name: "Contracts",
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
                { name: "amount", label: "Amount", type: "currency" }
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

    const doc = createOpenApiDocument(app, { basePath: "/api" });

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/api/auth/login"]).toBeDefined();
    expect(doc.paths["/api/doctypes/deal"]).toBeDefined();
    expect(doc.paths["/api/doctypes/deal/{id}/transition"]).toBeDefined();
    const dealInput = doc.components.schemas.DealInput;
    expect(dealInput).toBeDefined();
    expect(dealInput?.required).toContain("title");
  });
});

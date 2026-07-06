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
    expect(doc.paths["/api/auth/refresh"]).toBeDefined();
    expect(doc.paths["/api/auth/logout"]).toBeDefined();
    expect(doc.paths["/api/auth/providers/{id}/login"]).toBeDefined();
    expect(doc.paths["/api/auth/audit"]).toBeDefined();
    expect(doc.paths["/api/auth/password/change"]).toBeDefined();
    expect(doc.paths["/api/auth/users"]).toBeDefined();
    expect(doc.paths["/api/auth/users/{id}/password"]).toBeDefined();
    expect(doc.paths["/api/auth/roles"]).toBeDefined();
    expect(doc.paths["/api/auth/tokens"]).toBeDefined();
    expect(doc.paths["/api/migrations/plan"]).toBeDefined();
    expect(doc.paths["/api/migrations/apply"]).toBeDefined();
    expect(doc.paths["/api/realtime/stream"]).toBeDefined();
    expect(doc.paths["/api/doctypes/deal"]).toBeDefined();
    expect(doc.paths["/api/doctypes/deal/{id}/transition"]).toBeDefined();
    const listDeal = doc.paths["/api/doctypes/deal"]?.get;
    expect(JSON.stringify(listDeal?.parameters)).toContain("cursor");
    expect(JSON.stringify(listDeal?.parameters)).toContain("fields");
    expect(doc.components.schemas.AuthUser).toBeDefined();
    expect(doc.components.schemas.AuthSession).toBeDefined();
    expect(doc.components.schemas.AuthAuditEvent).toBeDefined();
    expect(doc.components.schemas.CreatedApiToken).toBeDefined();
    expect(doc.components.securitySchemes.cookieAuth).toMatchObject({ type: "apiKey", in: "cookie", name: "framekit_session" });
    expect(doc.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    const dealInput = doc.components.schemas.DealInput;
    expect(dealInput).toBeDefined();
    expect(dealInput?.required).toContain("title");
  });
});

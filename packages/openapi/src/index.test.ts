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
              ownership: { transferPermissions: ["deal.transfer"] },
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

    const doc = createOpenApiDocument(app, { basePath: "/api" });

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/api/auth/login"]).toBeDefined();
    expect(doc.paths["/api/auth/refresh"]).toBeDefined();
    expect(doc.paths["/api/auth/logout"]).toBeDefined();
    expect(doc.paths["/api/auth/providers/{id}/login"]).toBeDefined();
    expect(doc.paths["/api/auth/providers/{id}/authorize"]).toBeDefined();
    expect(doc.paths["/api/auth/providers/{id}/callback"]).toBeDefined();
    expect(doc.paths["/api/auth/invitations"]).toBeDefined();
    expect(doc.paths["/api/auth/identity-links"]).toBeDefined();
    expect(doc.paths["/api/auth/invitations/accept"]).toBeDefined();
    expect(doc.paths["/api/auth/password/reset/request"]).toBeDefined();
    expect(doc.paths["/api/auth/password/reset/complete"]).toBeDefined();
    expect(doc.paths["/api/auth/users/{id}/recovery"]).toBeDefined();
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
    expect(doc.paths["/api/doctypes/deal/{id}/submit"]?.post?.operationId).toBe("submitDeal");
    expect(doc.paths["/api/doctypes/deal/{id}/cancel"]?.post?.operationId).toBe("cancelDeal");
    expect(doc.paths["/api/doctypes/deal/{id}/owner"]?.post?.operationId).toBe("transferDealOwner");
    const listDeal = doc.paths["/api/doctypes/deal"]?.get;
    expect(JSON.stringify(listDeal?.parameters)).toContain("cursor");
    expect(JSON.stringify(listDeal?.parameters)).toContain("fields");
    expect(doc.components.schemas.AuthUser).toBeDefined();
    expect(doc.components.schemas.AuthSession).toBeDefined();
    expect(doc.components.schemas.AuthAuditEvent).toBeDefined();
    expect(doc.components.schemas.CreatedApiToken).toBeDefined();
    expect(doc.components.securitySchemes.cookieAuth).toMatchObject({ type: "apiKey", in: "cookie", name: "framekit_session" });
    expect(doc.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect(doc.paths["/health/live"]?.get?.security).toEqual([]);
    expect(doc.paths["/health/ready"]?.get?.security).toEqual([]);
    expect(doc.paths["/api/openapi.json"]?.get?.security).toEqual([]);
    expect(doc.paths["/api/auth/login"]?.post?.security).toEqual([]);
    expect(doc.paths["/api/auth/providers/{id}/login"]?.post?.security).toEqual([]);
    expect(doc.paths["/api/meta"]?.get?.security).toBeUndefined();
    expect(doc.paths["/api/realtime/events"]?.get?.["x-framekit-permission"]).toBe("framekit.realtime.read");
    expect(doc.paths["/api/realtime/stream"]?.get?.["x-framekit-permission"]).toBe("framekit.realtime.read");
    expect(doc.components.parameters).not.toHaveProperty("UserId");
    expect(doc.components.parameters).not.toHaveProperty("Roles");
    expect(doc.components.parameters).not.toHaveProperty("Permissions");
    const dealInput = doc.components.schemas.DealInput;
    expect(dealInput).toBeDefined();
    expect(dealInput?.required).toContain("title");
    expect(doc.components.schemas.DealRecord?.required).toContain("documentStatus");
    expect(doc.components.schemas.DealRecord?.properties?.documentStatus).toEqual({ type: "string", enum: ["draft", "submitted", "cancelled"] });
    expect(doc.components.schemas.DealRecord?.properties?.ownerId).toEqual({ type: "string" });
    expect(doc.components.schemas.DealRecord?.required).toContain("ownerId");
  });
});

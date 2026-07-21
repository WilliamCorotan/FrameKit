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
                { name: "amount", label: "Amount", type: "currency", precision: 20, scale: 4, validators: [{ kind: "range", min: "0.0000" }] },
                { name: "tax", label: "Tax", type: "currency", precision: 20, scale: 4 },
                { name: "total", label: "Total", type: "currency", precision: 20, scale: 4, computed: { operation: "sum", dependencies: ["amount", "tax"] } },
                { name: "stage", label: "Stage", type: "select", options: ["open", "won"] },
                { name: "lines", label: "Lines", type: "children", fields: [{ name: "description", label: "Description", type: "text", required: true }] },
                { name: "files", label: "Files", type: "attachments" }
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
    expect(JSON.stringify(doc.paths["/api/doctypes/deal/{id}/owner"]?.post?.responses)).toContain("OwnerTransferReceipt");
    expect(doc.components.schemas.OwnerTransferReceipt).toMatchObject({ required: ["id", "ownerId", "revision", "updatedAt"], additionalProperties: false });
    expect(doc.components.schemas.OwnerTransferReceipt?.properties).not.toHaveProperty("data");
    expect(doc.paths["/api/doctypes/deal/{id}/owner"]?.post?.operationId).toBe("transferDealOwner");
    expect(doc.paths["/api/doctypes/deal/{id}/attachments/files"]?.post?.operationId).toBe("uploadDealFilesAttachment");
    expect(doc.paths["/api/doctypes/deal/{id}/attachments/files/{attachmentId}"]?.get).toBeDefined();
    expect(doc.paths["/api/attachments/cleanup"]?.post?.["x-framekit-permission"]).toBe("framekit.attachments.cleanup");
    const listDeal = doc.paths["/api/doctypes/deal"]?.get;
    expect(JSON.stringify(listDeal?.parameters)).toContain("cursor");
    expect(JSON.stringify(listDeal?.parameters)).toContain("fields");
    expect(doc.components.schemas.AuthUser).toBeDefined();
    expect(doc.components.schemas.AuthSession).toBeDefined();
    expect(doc.components.schemas.AuthAuditEvent).toBeDefined();
    expect(doc.components.schemas.CreatedApiToken).toBeDefined();
    expect(doc.paths["/api/doctypes/deal/{id}"]?.get?.responses).toMatchObject({ "401": {}, "409": {}, "422": {}, "429": {}, "500": {} });
    expect(JSON.stringify(doc.paths["/api/doctypes/deal/{id}"]?.get?.responses)).toContain("x-request-id");
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
    expect(dealInput?.additionalProperties).toBe(false);
    expect(doc.components.schemas.DealPatch?.additionalProperties).toBe(false);
    expect(dealInput?.required).toContain("title");
    expect(dealInput?.properties?.amount).toMatchObject({ type: "string", "x-framekit-precision": 20, "x-framekit-scale": 4, "x-framekit-minimum": "0.0000" });
    const amountPattern = new RegExp(dealInput?.properties?.amount?.pattern ?? "");
    expect(amountPattern.test("1234567890123456.1234")).toBe(true);
    expect(amountPattern.test("12345678901234567.1234")).toBe(false);
    expect(amountPattern.test("1.12345")).toBe(false);
    expect(amountPattern.test("+1.0000")).toBe(false);
    expect(dealInput?.properties).not.toHaveProperty("total");
    expect(doc.components.schemas.DealData?.properties?.total).toMatchObject({ type: ["string", "null"], readOnly: true, "x-framekit-computed": { operation: "sum" } });
    expect(dealInput?.properties).not.toHaveProperty("files");
    expect(dealInput?.properties?.lines?.items?.properties?.data?.properties?.description).toEqual({ type: "string", description: undefined });
    expect(doc.components.schemas.DealData?.properties?.files?.items?.required).toContain("storageKey");
    expect(doc.components.schemas.DealRecord?.required).toContain("documentStatus");
    expect(doc.components.schemas.DealRecord?.properties?.documentStatus).toEqual({ type: "string", enum: ["draft", "submitted", "cancelled"] });
    expect(doc.components.schemas.DealRecord?.properties?.ownerId).toEqual({ type: "string" });
    expect(doc.components.schemas.DealRecord?.required).toContain("ownerId");

    expect(doc.components.schemas.DocumentCommandOperation).toEqual({
      oneOf: [
        { $ref: "#/components/schemas/DocumentCommandCreateOperation" },
        { $ref: "#/components/schemas/DocumentCommandUpdateOperation" },
        { $ref: "#/components/schemas/DocumentCommandDeleteOperation" }
      ]
    });
    expect(doc.components.schemas.DocumentCommandCreateOperation).toMatchObject({
      additionalProperties: false,
      required: ["operation", "doctype", "data"],
      properties: { operation: { const: "create" } }
    });
    expect(doc.components.schemas.DocumentCommandUpdateOperation).toMatchObject({
      additionalProperties: false,
      required: ["operation", "doctype", "id", "data", "expectedRevision"],
      properties: { operation: { const: "update" }, expectedRevision: { minimum: 1, maximum: Number.MAX_SAFE_INTEGER } }
    });
    expect(doc.components.schemas.DocumentCommandDeleteOperation).toMatchObject({
      additionalProperties: false,
      required: ["operation", "doctype", "id", "expectedRevision"],
      properties: { operation: { const: "delete" }, expectedRevision: { minimum: 1, maximum: Number.MAX_SAFE_INTEGER } }
    });
    expect(doc.components.schemas.DocumentCommandCompensation).toEqual({
      oneOf: [
        { $ref: "#/components/schemas/DocumentCommandCreateCompensation" },
        { $ref: "#/components/schemas/DocumentCommandUpdateCompensation" },
        { $ref: "#/components/schemas/DocumentCommandDeleteCompensation" }
      ]
    });
  });
});

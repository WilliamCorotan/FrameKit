import { FramekitClient } from "@framekit/sdk";

const baseUrl = (import.meta.env.VITE_FRAMEKIT_API_URL ?? "").replace(/\/$/, "");

export function createFramekitClient() {
  return new FramekitClient({
    version: 2,
    baseUrl,
    authMode: "bearer",
    tenant: {
      tenantId: "default",
      userId: "frontend-template",
      roles: ["administrator"],
      permissions: ["*"]
    }
  });
}

export { baseUrl };

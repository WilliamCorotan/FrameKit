import { FramekitClient } from "@framekit/sdk";

export const apiUrl = import.meta.env.VITE_FRAMEKIT_API_URL?.replace(/\/$/, "") ?? "";

export function createClient() {
  return new FramekitClient({
    version: 2,
    baseUrl: apiUrl,
    authMode: "bearer",
    tenant: { tenantId: "default", userId: "administrator", roles: ["administrator"], permissions: ["*"] }
  });
}

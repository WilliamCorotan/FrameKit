import { FramekitClient } from "@framekit/sdk";

export const apiUrl = import.meta.env.VITE_FRAMEKIT_API_URL ?? "";

export function createFramekitClient(): FramekitClient {
  return new FramekitClient({
    version: 2,
    baseUrl: apiUrl,
    authMode: "bearer",
    tenant: {
      tenantId: "default",
      userId: "vanilla-frontend",
      roles: ["administrator"],
      permissions: ["*"]
    }
  });
}

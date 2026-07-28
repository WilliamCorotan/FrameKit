import { FramekitClient } from "@framekit/sdk";

const apiUrl = import.meta.env.VITE_FRAMEKIT_API_URL ?? "";
export const framekitApp = import.meta.env.VITE_FRAMEKIT_APP || "crm";

function createClient(): FramekitClient {
  return new FramekitClient({
    version: 2,
    baseUrl: apiUrl,
    authMode: "bearer",
    tenant: {
      tenantId: import.meta.env.VITE_FRAMEKIT_TENANT_ID || "default",
      userId: "solid-ledger",
      roles: ["administrator"],
      permissions: ["*"]
    }
  });
}

export let client = createClient();

/** Discards the in-memory bearer token without writing browser storage. */
export function clearClientSession(): void {
  client = createClient();
}

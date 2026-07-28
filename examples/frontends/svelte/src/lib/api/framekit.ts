import {
  FramekitAuthenticationError,
  FramekitAuthorizationError,
  FramekitClient,
  FramekitConflictError,
  FramekitSdkError,
  FramekitServerError,
  FramekitTransportError,
  FramekitValidationError
} from "@framekit/sdk";

export type MetaSnapshot = { app?: { name?: string; version?: string }; name?: string; version?: string };

export const framekitConfig = {
  apiUrl: import.meta.env.VITE_FRAMEKIT_API_URL ?? "",
  tenantId: import.meta.env.VITE_FRAMEKIT_TENANT_ID ?? "default",
  appName: import.meta.env.VITE_FRAMEKIT_APP_NAME ?? "CRM",
  userId: import.meta.env.VITE_FRAMEKIT_USER_ID ?? "frontend"
};

export function createFramekitClient() {
  return new FramekitClient({
    version: 2,
    baseUrl: framekitConfig.apiUrl,
    authMode: "bearer",
    tenant: { tenantId: framekitConfig.tenantId, userId: framekitConfig.userId, roles: ["administrator"], permissions: ["*"] }
  });
}

export function presentFramekitError(cause: unknown): string {
  if (cause instanceof FramekitValidationError) return `Validation (${cause.code}): ${cause.message}`;
  if (cause instanceof FramekitAuthenticationError) return `Authentication (${cause.status ?? "no status"}): ${cause.message}`;
  if (cause instanceof FramekitAuthorizationError) return `Permission denied (${cause.code}): ${cause.message}`;
  if (cause instanceof FramekitConflictError) return `Conflict (${cause.code}): ${cause.message}`;
  if (cause instanceof FramekitServerError) return `Server error (${cause.status ?? "unknown"}): ${cause.message}`;
  if (cause instanceof FramekitTransportError) return `Connection failed: ${cause.message}`;
  if (cause instanceof FramekitSdkError) return `Framekit ${cause.code}: ${cause.message}`;
  return cause instanceof Error ? cause.message : "An unexpected error interrupted the request.";
}

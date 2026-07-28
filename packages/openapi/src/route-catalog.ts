/** A transport-neutral description of every HTTP operation implemented by Framekit. */
export type FramekitRouteGroup = "auth" | "platform" | "documents";
export type FramekitRouteDefinition = Readonly<{
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  group: FramekitRouteGroup;
}>;

const route = (method: FramekitRouteDefinition["method"], path: string, group: FramekitRouteGroup) => ({ method, path, group }) as const;

/**
 * The canonical route inventory. Paths use the default `/api` prefix; adapters
 * replace that prefix with their configured base path when matching requests.
 */
export const FRAMEKIT_ROUTE_CATALOG = [
  route("GET", "/health/live", "platform"), route("GET", "/health/ready", "platform"),
  route("GET", "/api/meta", "platform"), route("GET", "/api/openapi.json", "platform"), route("GET", "/api/diagnostics", "platform"),
  route("GET", "/api/migrations", "platform"), route("POST", "/api/migrations/plan", "platform"), route("POST", "/api/migrations/apply", "platform"),
  route("GET", "/api/realtime/events", "platform"), route("GET", "/api/realtime/stream", "platform"), route("GET", "/api/audit", "platform"),
  route("GET", "/api/outbox", "platform"), route("POST", "/api/outbox/{id}/dispatch", "platform"), route("POST", "/api/outbox/{id}/fail", "platform"),
  route("GET", "/api/custom-fields", "platform"), route("POST", "/api/custom-fields", "platform"), route("GET", "/api/views", "platform"), route("POST", "/api/views", "platform"),
  route("GET", "/api/settings", "platform"), route("PUT", "/api/settings/{key}", "platform"),
  route("POST", "/api/auth/login", "auth"), route("POST", "/api/auth/refresh", "auth"), route("POST", "/api/auth/logout", "auth"), route("GET", "/api/auth/me", "auth"),
  route("POST", "/api/auth/providers/{id}/login", "auth"), route("GET", "/api/auth/providers/{id}/authorize", "auth"), route("GET", "/api/auth/providers/{id}/callback", "auth"),
  route("POST", "/api/auth/invitations", "auth"), route("POST", "/api/auth/invitations/accept", "auth"), route("POST", "/api/auth/identity-links", "auth"),
  route("POST", "/api/auth/password/change", "auth"), route("POST", "/api/auth/password/reset/request", "auth"), route("POST", "/api/auth/password/reset/complete", "auth"), route("GET", "/api/auth/audit", "auth"),
  route("GET", "/api/auth/users", "auth"), route("POST", "/api/auth/users", "auth"), route("PATCH", "/api/auth/users/{id}", "auth"), route("PUT", "/api/auth/users/{id}", "auth"), route("DELETE", "/api/auth/users/{id}", "auth"), route("POST", "/api/auth/users/{id}/password", "auth"), route("POST", "/api/auth/users/{id}/recovery", "auth"),
  route("GET", "/api/auth/roles", "auth"), route("POST", "/api/auth/roles", "auth"), route("PATCH", "/api/auth/roles/{id}", "auth"), route("PUT", "/api/auth/roles/{id}", "auth"), route("DELETE", "/api/auth/roles/{id}", "auth"),
  route("GET", "/api/auth/tokens", "auth"), route("POST", "/api/auth/tokens", "auth"), route("DELETE", "/api/auth/tokens/{id}", "auth"),
  route("POST", "/api/commands/{command}", "documents"), route("POST", "/api/attachments/cleanup", "documents"),
  route("GET", "/api/doctypes/{doctype}", "documents"), route("POST", "/api/doctypes/{doctype}", "documents"), route("GET", "/api/doctypes/{doctype}/{id}", "documents"), route("PATCH", "/api/doctypes/{doctype}/{id}", "documents"), route("DELETE", "/api/doctypes/{doctype}/{id}", "documents"),
  route("POST", "/api/doctypes/{doctype}/{id}/transition", "documents"), route("POST", "/api/doctypes/{doctype}/{id}/submit", "documents"), route("POST", "/api/doctypes/{doctype}/{id}/cancel", "documents"), route("POST", "/api/doctypes/{doctype}/{id}/owner", "documents"),
  route("POST", "/api/doctypes/{doctype}/{id}/attachments/{field}", "documents"), route("GET", "/api/doctypes/{doctype}/{id}/attachments/{field}/{attachmentId}", "documents"), route("DELETE", "/api/doctypes/{doctype}/{id}/attachments/{field}/{attachmentId}", "documents")
] as const satisfies readonly FramekitRouteDefinition[];

/** @deprecated Use FRAMEKIT_ROUTE_CATALOG. */
export const FRAMEKIT_STATIC_ROUTE_CATALOG = FRAMEKIT_ROUTE_CATALOG;

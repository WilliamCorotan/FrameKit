/**
 * Stable routes implemented by the Nitro adapter and documented by OpenAPI.
 * Parameterized document, attachment, and command routes are generated from
 * application metadata and are covered by their own generator tests.
 */
export const FRAMEKIT_STATIC_ROUTE_CATALOG = [
  ["GET", "/health/live"], ["GET", "/health/ready"], ["GET", "/api/meta"], ["GET", "/api/openapi.json"], ["GET", "/api/diagnostics"],
  ["POST", "/api/auth/login"], ["POST", "/api/auth/refresh"], ["POST", "/api/auth/logout"], ["GET", "/api/auth/me"],
  ["POST", "/api/auth/providers/{id}/login"], ["GET", "/api/auth/providers/{id}/authorize"], ["GET", "/api/auth/providers/{id}/callback"],
  ["POST", "/api/auth/invitations"], ["POST", "/api/auth/invitations/accept"], ["POST", "/api/auth/identity-links"],
  ["POST", "/api/auth/password/change"], ["POST", "/api/auth/password/reset/request"], ["POST", "/api/auth/password/reset/complete"],
  ["GET", "/api/auth/users"], ["POST", "/api/auth/users"], ["POST", "/api/auth/users/{id}/password"], ["POST", "/api/auth/users/{id}/recovery"], ["GET", "/api/auth/audit"],
  ["GET", "/api/auth/roles"], ["POST", "/api/auth/roles"], ["GET", "/api/auth/tokens"], ["POST", "/api/auth/tokens"],
  ["GET", "/api/migrations"], ["POST", "/api/migrations/plan"], ["POST", "/api/migrations/apply"],
  ["GET", "/api/realtime/events"], ["GET", "/api/realtime/stream"], ["GET", "/api/audit"], ["GET", "/api/outbox"], ["GET", "/api/custom-fields"], ["POST", "/api/custom-fields"], ["GET", "/api/views"], ["POST", "/api/views"],
  ["GET", "/api/settings"], ["PUT", "/api/settings/{key}"], ["POST", "/api/attachments/cleanup"]
] as const;

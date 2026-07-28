import type { H3Event } from "h3";

/** Applies the invariant response headers before route dispatch. */
export function applyResponseSecurityHeaders(event: H3Event, environment: string | undefined): void {
  event.res.headers.set("x-content-type-options", "nosniff");
  event.res.headers.set("referrer-policy", "no-referrer");
  event.res.headers.set("x-frame-options", "DENY");
  event.res.headers.set("cross-origin-resource-policy", "same-site");
  event.res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (environment === "production") {
    event.res.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
}

/** Keeps request identity generation independent of route-specific behavior. */
export function requestContext(event: H3Event): { requestId: string; method: string; path: string; startedAt: number } {
  return {
    requestId: event.req.headers.get("x-request-id") ?? crypto.randomUUID(),
    method: event.req.method ?? "GET",
    path: event.url.pathname,
    startedAt: performance.now()
  };
}

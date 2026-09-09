import { deleteCookie, getCookie, setCookie, type H3Event } from "h3";
import { FramekitError } from "@framekit/core";

async function oidcStateDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function oidcBrowserCookie(basePath: string, providerId: string, secure: boolean) {
  const scope = await oidcStateDigest(JSON.stringify([basePath, providerId]));
  return {
    name: `${secure ? "__Host-" : ""}framekit_oidc_${scope.slice(0, 24)}`,
    options: { path: "/", httpOnly: true, secure, sameSite: "lax" as const }
  };
}

export async function setOidcBrowserState(event: H3Event, basePath: string, providerId: string, state: string, secure: boolean): Promise<void> {
  const cookie = await oidcBrowserCookie(basePath, providerId, secure);
  setCookie(event, cookie.name, await oidcStateDigest(state), { ...cookie.options, maxAge: 600 });
}

export async function consumeOidcBrowserState(event: H3Event, basePath: string, providerId: string, state: string, secure: boolean): Promise<void> {
  const cookie = await oidcBrowserCookie(basePath, providerId, secure);
  if (getCookie(event, cookie.name) !== await oidcStateDigest(state)) {
    throw new FramekitError("OIDC_BROWSER_STATE_INVALID", "OIDC callback does not match this browser's authorization request.", 401);
  }
  deleteCookie(event, cookie.name, cookie.options);
}

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

import { getQuery, readBody, sendRedirect, setResponseStatus, type H3Event } from "h3";
import type { PasswordAuthService } from "@framekit/auth";
import { FramekitError, type TenantContext } from "@framekit/core";
import { createOpenApiDocument, FRAMEKIT_ROUTE_CATALOG, type FramekitRouteDefinition } from "@framekit/openapi";
import type { DocumentCommandRequest, FilterValue, FramekitRuntime } from "@framekit/runtime";
import { matchAttachmentPath, matchAuthManagementPath, matchCommandPath, matchDocumentPath, matchOutboxPath, matchProviderAuthorizationPath, matchProviderLoginPath, matchUserPasswordPath, matchUserRecoveryPath } from "./route-matchers.js";
import { consumeOidcBrowserState, setOidcBrowserState } from "./request-security-policy.js";
import { nodeEnvironment } from "./production-policy.js";

const UNHANDLED = Symbol("unhandled");
type Result = { handled: true; value: unknown } | typeof UNHANDLED;
const handled = (value: unknown): Result => ({ handled: true, value });
type RouteAuthCookie = { name: string; path: string; httpOnly: boolean; secure: boolean; sameSite: "lax" | "strict" | "none" };
type RouteOptions = {
  auth?: PasswordAuthService;
  serverUrl?: string;
  healthChecks?: Record<string, (signal: AbortSignal) => { ok: boolean; details?: unknown } | Promise<{ ok: boolean; details?: unknown }>>;
  healthCheckTimeoutMs?: number;
};
export type RouteContext = { runtime: FramekitRuntime; options: RouteOptions; basePath: string; authCookie?: RouteAuthCookie; allowHeaderIdentity: boolean; setTelemetryStatus(code: number): void; helpers: RouteHelpers };
type RouteHelpers = {
  assertAuthManager(tenant: TenantContext): void;
  assertOperationPermission(tenant: TenantContext, permission: string, operation: string): void;
  authenticatedTenantFromRequest(request: Request, auth: PasswordAuthService, cookie?: RouteContext["authCookie"]): Promise<TenantContext>;
  canonicalLocale(locale: string): string | undefined;
  clearSessionCookie(event: H3Event, cookie?: RouteContext["authCookie"]): void;
  createRealtimeStream(runtime: FramekitRuntime, tenant: TenantContext, signal: AbortSignal, after?: string): Response;
  decodeBase64(value: string): Uint8Array;
  encodeBase64(value: Uint8Array): string;
  isOutboxStatus(value: unknown): value is "pending" | "dispatched" | "failed";
  isPlainObject(value: unknown): value is Record<string, unknown>;
  mutationOptions(request: Request): { expectedRevision?: number; idempotencyKey?: string };
  parseFields(value: unknown): string[] | undefined;
  parseFilters(value: unknown): Record<string, FilterValue> | undefined;
  parseSort(value: unknown): { field: string; direction?: "asc" | "desc" } | undefined;
  preferredLocale(header: string | null, supportedLocales: string[]): string | undefined;
  requireAuth(auth: RouteContext["options"]["auth"]): PasswordAuthService;
  runHealthChecks(checks: NonNullable<RouteOptions["healthChecks"]>, timeoutMs: number): Promise<{ ok: boolean; details?: unknown }>;
  sessionTokenFromEvent(event: H3Event, cookie?: RouteContext["authCookie"]): string | undefined;
  setSessionCookie(event: H3Event, token: string, expiresAt: string, cookie?: RouteContext["authCookie"]): void;
  tenantFromRequest(request: Request, auth?: RouteContext["options"]["auth"], cookie?: RouteContext["authCookie"], allowHeaderIdentity?: boolean): Promise<TenantContext>;
};

/**
 * The static matcher registrations used to select a focused dispatcher.
 * Dynamic document, attachment, command, and auth-resource matchers remain
 * in route-matchers.ts because their segments are application data.
 */

export async function dispatchNitroRoutes(event: H3Event, context: RouteContext): Promise<unknown> {
  const { runtime, options, basePath, authCookie, allowHeaderIdentity } = context;
  const method = event.req.method ?? "GET";
  const path = event.url.pathname;
  const matched = matchNitroRoute(method, path, basePath);
  if (matched?.group === "auth") {
    const auth = await dispatchAuthRoute(event, context);
    if (auth !== UNHANDLED) return auth.value;
  }
  if (matched?.group === "platform") {
    const platform = await dispatchPlatformRoute(event, context);
    if (platform !== UNHANDLED) return platform.value;
  }
  if (matched?.group === "documents") return await dispatchDocumentRoute(event, context);
  throw new FramekitError("NOT_FOUND", "Route not found", 404);
}

/** Return the actual catalog definition that structurally matches this request. */
export function matchNitroRoute(method: string, path: string, basePath: string): FramekitRouteDefinition | undefined {
  const normalizedBasePath = normalizeNitroBasePath(basePath);
  const normalizedPath = path === "/health" ? "/health/live" : path === "/health/dependencies" ? "/health/ready" : path === normalizedBasePath || path.startsWith(`${normalizedBasePath}/`) ? `/api${path.slice(normalizedBasePath.length)}` : path;
  const pathSegments = normalizedPath.split("/");
  return FRAMEKIT_ROUTE_CATALOG.find((definition) => definition.method === method && definition.path.split("/").length === pathSegments.length && definition.path.split("/").every((segment, index) => (segment.startsWith("{") && segment.endsWith("}")) || segment === pathSegments[index]));
}

export function normalizeNitroBasePath(basePath: string): string {
  const prefixed = basePath.startsWith("/") ? basePath : `/${basePath}`;
  let end = prefixed.length;
  while (end > 0 && prefixed.charCodeAt(end - 1) === 47) end -= 1;
  return prefixed.slice(0, end);
}

function safeBrowserReturnTo(value: unknown): string {
  if (value === undefined) return "/";
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new FramekitError("INVALID_RETURN_TO", "returnTo must be a same-origin absolute path.", 422);
  }
  return value;
}

function renderMfaChallengePage(basePath: string, challengeToken: string, returnTo: string): Response {
  const action = escapeHtml(`${basePath}/auth/mfa/complete`);
  const token = escapeHtml(challengeToken);
  const target = escapeHtml(returnTo);
  const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Complete sign in</title></head><body><main><h1>Complete sign in</h1><p>Enter an authenticator or recovery code to continue.</p><form method="post" action="${action}"><input type="hidden" name="challengeToken" value="${token}"><input type="hidden" name="returnTo" value="${target}"><label>Authenticator code <input name="code" inputmode="numeric" autocomplete="one-time-code" required></label><label><input type="checkbox" name="recoveryCode" value="on"> Use a recovery code</label><button type="submit">Continue</button></form></main></body></html>`;
  return new Response(document, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "strict-origin",
      "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    }
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

async function dispatchAuthRoute(event: H3Event, context: RouteContext): Promise<Result> {
  const { assertAuthManager, assertOperationPermission, authenticatedTenantFromRequest, canonicalLocale, clearSessionCookie, createRealtimeStream, decodeBase64, encodeBase64, isOutboxStatus, isPlainObject, mutationOptions, parseFields, parseFilters, parseSort, preferredLocale, requireAuth, runHealthChecks, sessionTokenFromEvent, setSessionCookie, tenantFromRequest } = context.helpers;
  const { runtime, options, basePath, authCookie, allowHeaderIdentity } = context;
  const method = event.req.method ?? "GET";
  const path = event.url.pathname;
const authManagementMutation = method !== "GET" && (
  path.startsWith(basePath + "/auth/users") || path.startsWith(basePath + "/auth/roles") || path.startsWith(basePath + "/auth/tokens") ||
  path === basePath + "/auth/invitations" || path === basePath + "/auth/identity-links"
);
if (authManagementMutation && options.auth) {
  const token = sessionTokenFromEvent(event, authCookie);
  if (token) {
    const identity = await options.auth.verifyBearerToken(token);
    if ("sessionId" in identity) await options.auth.enforceRecentMfa(token);
  }
}
if (method === "POST" && path === basePath + "/auth/mfa/complete") {
  const auth = requireAuth(options.auth);
  const formSubmission = event.req.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded") === true;
  const body = await readBody(event) as { challengeToken?: unknown; code?: unknown; recoveryCode?: unknown; returnTo?: unknown };
  const returnTo = formSubmission ? safeBrowserReturnTo(body?.returnTo) : undefined;
  const recoveryCode = formSubmission ? body?.recoveryCode === "on" : body?.recoveryCode;
  if (!body || typeof body.challengeToken !== "string" || typeof body.code !== "string" || (recoveryCode !== undefined && typeof recoveryCode !== "boolean")) throw new FramekitError("VALIDATION_FAILED", "A challenge token and MFA code are required.", 422);
  const session = await auth.completeMfaChallenge(body.challengeToken, body.code, { recoveryCode });
  setSessionCookie(event, session.token, session.expiresAt, authCookie);
  if (formSubmission) return handled(sendRedirect(event, returnTo!, 303));
  return handled(session);
}
if (path.startsWith(basePath + "/auth/mfa/")) {
  const auth = requireAuth(options.auth);
  const tenant = await authenticatedTenantFromRequest(event.req, auth, authCookie);
  if (method === "GET" && path === basePath + "/auth/mfa/status") return handled(await auth.getMfaStatus(tenant));
  if (method === "POST" && path === basePath + "/auth/mfa/enroll") {
    const token = sessionTokenFromEvent(event, authCookie);
    if (!token) throw new FramekitError("INVALID_SESSION", "A recent session is required to enroll MFA.", 401);
    await auth.assertRecentPrimaryAuth(token);
    return handled(await auth.beginMfaEnrollment(tenant));
  }
  if (method === "POST" && (path === basePath + "/auth/mfa/confirm" || path === basePath + "/auth/mfa/disable")) {
    const body = await readBody(event) as { code?: unknown; recoveryCode?: unknown };
    if (!body || typeof body.code !== "string" || (body.recoveryCode !== undefined && typeof body.recoveryCode !== "boolean")) throw new FramekitError("VALIDATION_FAILED", "An MFA code is required.", 422);
    if (path.endsWith("/confirm")) return handled(await auth.confirmMfaEnrollment(tenant, body.code));
    const token = sessionTokenFromEvent(event, authCookie);
    if (!token) throw new FramekitError("INVALID_SESSION", "A recent session is required to change MFA.", 401);
    await auth.assertRecentPrimaryAuth(token);
    await auth.disableMfa(tenant, body.code, { recoveryCode: body.recoveryCode });
    clearSessionCookie(event, authCookie);
    return handled({ ok: true });
  }
}
if (method === "POST" && path === basePath + "/auth/login") {
  if (!options.auth) {
    throw new FramekitError("AUTH_NOT_CONFIGURED", "Auth is not configured for this app.", 501);
  }
  const body = ((await readBody(event)) ?? {}) as { email?: string; password?: string };
  if (!body.email || !body.password) {
    throw new FramekitError("VALIDATION_FAILED", "Email and password are required.", 422);
  }
  const session = await options.auth.login(body.email, body.password, event.req.headers.get("x-tenant-id") ?? "default");
  setSessionCookie(event, session.token, session.expiresAt, authCookie);
  return handled(session);
}
const providerLogin = matchProviderLoginPath(path, basePath);
if (method === "POST" && providerLogin) {
  const auth = requireAuth(options.auth);
  const body = ((await readBody(event)) ?? {}) as { token?: string };
  if (!body.token) {
    throw new FramekitError("VALIDATION_FAILED", "token is required.", 422);
  }
  const session = await auth.loginWithProvider(providerLogin.providerId, body.token, event.req.headers.get("x-tenant-id") ?? "default");
  setSessionCookie(event, session.token, session.expiresAt, authCookie);
  return handled(session);
}
const providerAuthorization = matchProviderAuthorizationPath(path, basePath);
if (method === "GET" && providerAuthorization?.action === "authorize") {
  const auth = requireAuth(options.auth);
  const query = getQuery(event);
  const started = await auth.beginProviderAuthorization(providerAuthorization.providerId, {
    tenantId: event.req.headers.get("x-tenant-id") ?? "default",
    returnTo: typeof query.returnTo === "string" ? query.returnTo : "/"
  });
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  if (!state) throw new FramekitError("OIDC_STATE_MISSING", "OIDC authorization requires a state parameter.", 500);
  await setOidcBrowserState(event, basePath, providerAuthorization.providerId, state, authCookie?.secure ?? nodeEnvironment() === "production");
  return handled(sendRedirect(event, started.authorizationUrl, 302));
}
if (method === "GET" && providerAuthorization?.action === "callback") {
  const auth = requireAuth(options.auth);
  const query = getQuery(event);
  if (typeof query.code !== "string" || typeof query.state !== "string") {
    throw new FramekitError("VALIDATION_FAILED", "code and state are required.", 422);
  }
  await consumeOidcBrowserState(event, basePath, providerAuthorization.providerId, query.state, authCookie?.secure ?? nodeEnvironment() === "production");
  let completed: Awaited<ReturnType<typeof auth.completeProviderAuthorization>>;
  try {
    completed = await auth.completeProviderAuthorization(providerAuthorization.providerId, { code: query.code, state: query.state });
  } catch (error) {
    if (error instanceof FramekitError && error.code === "MFA_REQUIRED" && error.details && typeof error.details === "object") {
      const details = error.details as { challengeToken?: unknown; returnTo?: unknown };
      if (typeof details.challengeToken === "string") {
        event.res.headers.set("referrer-policy", "strict-origin");
        return handled(renderMfaChallengePage(basePath, details.challengeToken, safeBrowserReturnTo(details.returnTo)));
      }
    }
    throw error;
  }
  setSessionCookie(event, completed.session.token, completed.session.expiresAt, authCookie);
  return handled(sendRedirect(event, completed.returnTo, 303));
}
if (method === "POST" && path === basePath + "/auth/invitations/accept") {
  const auth = requireAuth(options.auth);
  const body = ((await readBody(event)) ?? {}) as { token?: string; password?: string };
  if (!body.token || !body.password) throw new FramekitError("VALIDATION_FAILED", "token and password are required.", 422);
  const session = await auth.acceptInvitation({ tenantId: event.req.headers.get("x-tenant-id") ?? "default", token: body.token, password: body.password });
  setSessionCookie(event, session.token, session.expiresAt, authCookie);
  return handled(session);
}
if (method === "POST" && path === basePath + "/auth/password/reset/request") {
  const auth = requireAuth(options.auth);
  const body = ((await readBody(event)) ?? {}) as { email?: string };
  if (!body.email) throw new FramekitError("VALIDATION_FAILED", "email is required.", 422);
  await auth.requestPasswordReset(event.req.headers.get("x-tenant-id") ?? "default", body.email);
  setResponseStatus(event, 202);
  return handled({ accepted: true });
}
if (method === "POST" && path === basePath + "/auth/password/reset/complete") {
  const auth = requireAuth(options.auth);
  const body = ((await readBody(event)) ?? {}) as { token?: string; newPassword?: string };
  if (!body.token || !body.newPassword) throw new FramekitError("VALIDATION_FAILED", "token and newPassword are required.", 422);
  await auth.completePasswordRecovery({ tenantId: event.req.headers.get("x-tenant-id") ?? "default", token: body.token, newPassword: body.newPassword });
  setResponseStatus(event, 204);
  return handled(null);
}
if (method === "GET" && path === basePath + "/auth/me") {
  if (!options.auth) {
    throw new FramekitError("AUTH_NOT_CONFIGURED", "Auth is not configured for this app.", 501);
  }
  const token = sessionTokenFromEvent(event, authCookie);
  if (!token) {
    throw new FramekitError("UNAUTHENTICATED", "Missing session token.", 401);
  }
  const session = await options.auth.verifyBearerToken(token);
  return handled("apiToken" in session
    ? {
        apiToken: session.apiToken,
        user: session.user,
        context: session.context
      }
    : {
        sessionId: session.sessionId,
        user: session.user,
        context: session.context,
        expiresAt: session.expiresAt
      });
}
if (method === "POST" && path === basePath + "/auth/refresh") {
  const auth = requireAuth(options.auth);
  const token = sessionTokenFromEvent(event, authCookie);
  if (!token) {
    throw new FramekitError("UNAUTHENTICATED", "Missing session token.", 401);
  }
  const session = await auth.refreshSession(token);
  setSessionCookie(event, session.token, session.expiresAt, authCookie);
  return handled(session);
}
if (method === "POST" && path === basePath + "/auth/logout") {
  const auth = requireAuth(options.auth);
  const token = sessionTokenFromEvent(event, authCookie);
  if (!token) {
    throw new FramekitError("UNAUTHENTICATED", "Missing session token.", 401);
  }
  await auth.revokeSession(token);
  clearSessionCookie(event, authCookie);
  setResponseStatus(event, 204);
  return handled(null);
}
if (method === "POST" && path === basePath + "/auth/password/change") {
  const auth = requireAuth(options.auth);
  const tenant = await authenticatedTenantFromRequest(event.req, auth, authCookie);
  const body = ((await readBody(event)) ?? {}) as { currentPassword?: string; newPassword?: string };
  if (!body.currentPassword || !body.newPassword) {
    throw new FramekitError("VALIDATION_FAILED", "currentPassword and newPassword are required.", 422);
  }
  await auth.changePassword(tenant.tenantId, tenant.userId, body.currentPassword, body.newPassword);
  setResponseStatus(event, 204);
  return handled(null);
}
const passwordReset = matchUserPasswordPath(path, basePath);
if (method === "POST" && passwordReset) {
  const auth = requireAuth(options.auth);
  const tenant = await authenticatedTenantFromRequest(event.req, auth, authCookie);
  assertAuthManager(tenant);
  const body = ((await readBody(event)) ?? {}) as { newPassword?: string };
  if (!body.newPassword) {
    throw new FramekitError("VALIDATION_FAILED", "newPassword is required.", 422);
  }
  await auth.resetPassword(tenant.tenantId, passwordReset.userId, body.newPassword);
  setResponseStatus(event, 204);
  return handled(null);
}
if (method === "GET" && path === basePath + "/auth/audit") {
  const auth = requireAuth(options.auth);
  const tenant = await authenticatedTenantFromRequest(event.req, auth, authCookie);
  assertAuthManager(tenant);
  return handled(await auth.authAuditEvents(tenant.tenantId));
}
if (method === "POST" && path === basePath + "/auth/invitations") {
  const auth = requireAuth(options.auth);
  const tenant = await authenticatedTenantFromRequest(event.req, auth, authCookie);
  assertAuthManager(tenant);
  const body = ((await readBody(event)) ?? {}) as { email?: string; name?: string; roles?: string[]; permissions?: string[]; expiresAt?: string };
  if (!body.email || !body.name || !Array.isArray(body.roles) || !Array.isArray(body.permissions)) throw new FramekitError("VALIDATION_FAILED", "email, name, roles, and permissions are required.", 422);
  setResponseStatus(event, 201);
  return handled(await auth.createInvitation({ tenantId: tenant.tenantId, email: body.email, name: body.name, roles: body.roles, permissions: body.permissions, expiresAt: body.expiresAt }));
}
if (method === "POST" && path === basePath + "/auth/identity-links") {
  const auth = requireAuth(options.auth);
  const tenant = await authenticatedTenantFromRequest(event.req, auth, authCookie);
  assertAuthManager(tenant);
  const body = ((await readBody(event)) ?? {}) as { providerId?: string; subject?: string; userId?: string; email?: string };
  if (!body.providerId || !body.subject || !body.userId) throw new FramekitError("VALIDATION_FAILED", "providerId, subject, and userId are required.", 422);
  setResponseStatus(event, 201);
  return handled(await auth.linkProviderIdentity({ tenantId: tenant.tenantId, providerId: body.providerId, subject: body.subject, userId: body.userId, email: body.email }));
}
const recoveryPath = matchUserRecoveryPath(path, basePath);
if (method === "POST" && recoveryPath) {
  const auth = requireAuth(options.auth);
  const tenant = await authenticatedTenantFromRequest(event.req, auth, authCookie);
  assertAuthManager(tenant);
  setResponseStatus(event, 201);
  return handled(await auth.createRecoveryToken(tenant.tenantId, recoveryPath.userId));
}
const authAction = matchAuthManagementPath(path, basePath);
if (authAction) {
  const auth = requireAuth(options.auth);
  const tenant = await authenticatedTenantFromRequest(event.req, auth, authCookie);
  assertAuthManager(tenant);

  if (authAction.resource === "users") {
    if (method === "GET" && !authAction.id) {
      return handled(await auth.listUsers(tenant.tenantId));
    }
    if ((method === "POST" && !authAction.id) || ((method === "PATCH" || method === "PUT") && authAction.id)) {
      const body = ((await readBody(event)) ?? {}) as Partial<{
        id: string;
        email: string;
        name: string;
        password: string;
        roles: string[];
        permissions: string[];
        disabledAt: string;
        lockedUntil: string;
      }>;
      if (!body.email || !body.name || !Array.isArray(body.roles) || !Array.isArray(body.permissions)) {
        throw new FramekitError("VALIDATION_FAILED", "email, name, roles, and permissions are required.", 422);
      }
      const user = await auth.upsertUser({
        tenantId: tenant.tenantId,
        id: authAction.id ?? body.id,
        email: body.email,
        name: body.name,
        password: body.password,
        roles: body.roles,
        permissions: body.permissions,
        disabledAt: body.disabledAt,
        lockedUntil: body.lockedUntil
      });
      if (method === "POST") {
        setResponseStatus(event, 201);
      }
      return handled(user);
    }
    if (method === "DELETE" && authAction.id) {
      await auth.deleteUser(tenant.tenantId, authAction.id);
      setResponseStatus(event, 204);
      return handled(null);
    }
  }

  if (authAction.resource === "roles") {
    if (method === "GET" && !authAction.id) {
      return handled(await auth.listRoles(tenant.tenantId));
    }
    if ((method === "POST" && !authAction.id) || ((method === "PATCH" || method === "PUT") && authAction.id)) {
      const body = ((await readBody(event)) ?? {}) as Partial<{ id: string; name: string; permissions: string[] }>;
      const id = authAction.id ?? body.id;
      if (!id || !body.name || !Array.isArray(body.permissions)) {
        throw new FramekitError("VALIDATION_FAILED", "id, name, and permissions are required.", 422);
      }
      const role = await auth.upsertRole({
        tenantId: tenant.tenantId,
        id,
        name: body.name,
        permissions: body.permissions
      });
      if (method === "POST") {
        setResponseStatus(event, 201);
      }
      return handled(role);
    }
    if (method === "DELETE" && authAction.id) {
      await auth.deleteRole(tenant.tenantId, authAction.id);
      setResponseStatus(event, 204);
      return handled(null);
    }
  }

  if (authAction.resource === "tokens") {
    if (method === "GET" && !authAction.id) {
      return handled(await auth.listApiTokens(tenant.tenantId));
    }
    if (method === "POST" && !authAction.id) {
      const body = ((await readBody(event)) ?? {}) as Partial<{
        id: string;
        name: string;
        userId: string;
        roles: string[];
        permissions: string[];
        expiresAt: string;
      }>;
      if (!body.name || !Array.isArray(body.roles) || !Array.isArray(body.permissions)) {
        throw new FramekitError("VALIDATION_FAILED", "name, roles, and permissions are required.", 422);
      }
      setResponseStatus(event, 201);
      return handled(await auth.createApiToken({
        tenantId: tenant.tenantId,
        id: body.id,
        name: body.name,
        userId: body.userId,
        roles: body.roles,
        permissions: body.permissions,
        expiresAt: body.expiresAt
      }));
    }
    if (method === "DELETE" && authAction.id) {
      const revoked = await auth.revokeApiToken(tenant.tenantId, authAction.id);
      return handled(revoked);
    }
  }

  throw new FramekitError("METHOD_NOT_ALLOWED", "Method not allowed", 405);
}
  return UNHANDLED;
}

async function dispatchPlatformRoute(event: H3Event, context: RouteContext): Promise<Result> {
  const { assertAuthManager, assertOperationPermission, authenticatedTenantFromRequest, canonicalLocale, clearSessionCookie, createRealtimeStream, decodeBase64, encodeBase64, isOutboxStatus, isPlainObject, mutationOptions, parseFields, parseFilters, parseSort, preferredLocale, requireAuth, runHealthChecks, sessionTokenFromEvent, setSessionCookie, tenantFromRequest } = context.helpers;
  const { runtime, options, basePath, authCookie, allowHeaderIdentity } = context;
  const method = event.req.method ?? "GET";
  const path = event.url.pathname;
if (method === "GET" && (path === "/health" || path === "/health/live")) {
  return handled({ ok: true, app: runtime.app.name, version: runtime.app.version });
}
if (method === "GET" && (path === "/health/dependencies" || path === "/health/ready")) {
  const health = await runHealthChecks(options.healthChecks ?? {}, options.healthCheckTimeoutMs ?? 2_000);
  if (!health.ok) {
    context.setTelemetryStatus(503);
    setResponseStatus(event, 503);
  }
  return handled(health);
}
if (method === "GET" && path === basePath + "/meta") {
  const query = getQuery(event);
  const requestedLocale = typeof query.locale === "string" ? canonicalLocale(query.locale) : preferredLocale(event.req.headers.get("accept-language"), runtime.app.localization.supportedLocales);
  return handled(await runtime.metadata(await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity), { locale: requestedLocale }));
}
if (method === "GET" && path === basePath + "/diagnostics") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.diagnostics.read", "read runtime diagnostics");
  return handled(await runtime.diagnostics());
}
if (method === "GET" && path === basePath + "/migrations") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.migrations.read", "read migration history");
  return handled(await runtime.migrationHistory(tenant));
}
if (method === "GET" && path === basePath + "/realtime/events") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.realtime.read", "read realtime events");
  const query = getQuery(event);
  return handled(await runtime.realtimeEvents(tenant, {
    limit: typeof query.limit === "string" ? Number(query.limit) : undefined,
    after: typeof query.after === "string" ? query.after : undefined
  }));
}
if (method === "GET" && path === basePath + "/realtime/stream") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.realtime.read", "stream realtime events");
  return handled(createRealtimeStream(runtime, tenant, event.req.signal, event.req.headers.get("last-event-id") ?? undefined));
}
if (method === "POST" && path === basePath + "/migrations/plan") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.migrations.manage", "plan migrations");
  const body = ((await readBody(event)) ?? {}) as { app?: unknown };
  if (!body.app || typeof body.app !== "object") {
    throw new FramekitError("VALIDATION_FAILED", "app is required.", 422);
  }
  return handled(await runtime.planMigration(tenant, body.app as never));
}
if (method === "POST" && path === basePath + "/migrations/apply") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.migrations.manage", "apply migrations");
  const body = ((await readBody(event)) ?? {}) as { plan?: unknown; allowDestructive?: boolean };
  if (!body.plan || typeof body.plan !== "object") {
    throw new FramekitError("VALIDATION_FAILED", "plan is required.", 422);
  }
  return handled(await runtime.applyMigration(tenant, body.plan as never, { allowDestructive: body.allowDestructive }));
}
if (method === "GET" && path === basePath + "/audit") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.audit.read", "read audit events");
  const query = getQuery(event);
  return handled(await runtime.auditTrail(tenant, {
    limit: typeof query.limit === "string" ? Number(query.limit) : undefined
  }));
}
if (method === "GET" && path === basePath + "/outbox") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.outbox.read", "read outbox events");
  const query = getQuery(event);
  return handled(await runtime.outboxEvents(tenant, {
    limit: typeof query.limit === "string" ? Number(query.limit) : undefined,
    status: isOutboxStatus(query.status) ? query.status : undefined
  }));
}
const outboxAction = matchOutboxPath(path, basePath);
if (method === "POST" && outboxAction) {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.outbox.manage", "mutate outbox events");
  if (outboxAction.action === "dispatch") {
    return handled(await runtime.markOutboxDispatched(tenant, outboxAction.id));
  }
  const body = ((await readBody(event)) ?? {}) as { error?: string };
  return handled(await runtime.markOutboxFailed(tenant, outboxAction.id, body.error ?? "Unknown dispatch failure"));
}
if (method === "GET" && path === basePath + "/openapi.json") {
  return handled(createOpenApiDocument(runtime.app, {
    basePath,
    serverUrl: options.serverUrl ?? event.url.origin
  }));
}
if (method === "GET" && path === basePath + "/custom-fields") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.customization.read", "read custom fields");
  return handled(await runtime.customFields(tenant));
}
if (method === "POST" && path === basePath + "/custom-fields") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.customization.manage", "add custom fields");
  const body = ((await readBody(event)) ?? {}) as { doctype?: string; field?: unknown };
  if (!body.doctype || !body.field) {
    throw new FramekitError("VALIDATION_FAILED", "doctype and field are required.", 422);
  }
  setResponseStatus(event, 201);
  return handled(await runtime.addCustomField(tenant, { doctype: body.doctype, field: body.field }));
}
if (method === "GET" && path === basePath + "/views") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.customization.read", "read views");
  return handled(await runtime.views(tenant));
}
if (method === "POST" && path === basePath + "/views") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.customization.manage", "update views");
  const body = ((await readBody(event)) ?? {}) as { doctype?: string; type?: "list" | "form"; fields?: string[] };
  if (!body.doctype || (body.type !== "list" && body.type !== "form") || !Array.isArray(body.fields)) {
    throw new FramekitError("VALIDATION_FAILED", "doctype, type, and fields are required.", 422);
  }
  return handled(await runtime.upsertView(tenant, { doctype: body.doctype, type: body.type, fields: body.fields }));
}
if (method === "GET" && path === basePath + "/settings") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.settings.read", "read application settings");
  const query = getQuery(event);
  return handled(await runtime.settings(tenant, { locale: typeof query.locale === "string" ? canonicalLocale(query.locale) : preferredLocale(event.req.headers.get("accept-language"), runtime.app.localization.supportedLocales) }));
}
if (method === "PUT" && path.startsWith(basePath + "/settings/")) {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  assertOperationPermission(tenant, "framekit.settings.manage", "update application settings");
  const key = decodeURIComponent(path.slice(`${basePath}/settings/`.length));
  const body: unknown = await readBody(event);
  if (!isPlainObject(body) || !Object.prototype.hasOwnProperty.call(body, "value")) {
    throw new FramekitError("VALIDATION_FAILED", "value is required.", 422);
  }
  return handled(await runtime.upsertSetting(tenant, key, (body as { value: unknown }).value));
}
  return UNHANDLED;
}

async function dispatchDocumentRoute(event: H3Event, context: RouteContext): Promise<unknown> {
  const { assertAuthManager, assertOperationPermission, authenticatedTenantFromRequest, canonicalLocale, clearSessionCookie, createRealtimeStream, decodeBase64, encodeBase64, isOutboxStatus, isPlainObject, mutationOptions, parseFields, parseFilters, parseSort, preferredLocale, requireAuth, runHealthChecks, sessionTokenFromEvent, setSessionCookie, tenantFromRequest } = context.helpers;
  const { runtime, options, basePath, authCookie, allowHeaderIdentity } = context;
  const method = event.req.method ?? "GET";
  const path = event.url.pathname;
const commandId = matchCommandPath(path, basePath);
if (method === "POST" && commandId) {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  const body: unknown = (await readBody(event)) ?? {};
  const idempotencyKey = event.req.headers.get("idempotency-key");
  const request = idempotencyKey && body !== null && typeof body === "object" && !Array.isArray(body)
    ? { ...body, idempotencyKey }
    : body;
  return await runtime.executeDocumentCommand(tenant, commandId, request as DocumentCommandRequest);
}

if (method === "POST" && path === basePath + "/attachments/cleanup") {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  return { deleted: await runtime.cleanupOrphanAttachments(tenant) };
}

const attachment = matchAttachmentPath(path, basePath);
if (attachment) {
  const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
  if (method === "POST" && !attachment.attachmentId) {
    const body = ((await readBody(event)) ?? {}) as { name?: string; contentType?: string; data?: string };
    if (!body.name || !body.contentType || !body.data) throw new FramekitError("VALIDATION_FAILED", "name, contentType, and base64 data are required.", 422);
    setResponseStatus(event, 201);
    return await runtime.uploadAttachment(tenant, attachment.doctype, attachment.id, attachment.field, {
      name: body.name, contentType: body.contentType, bytes: decodeBase64(body.data)
    }, mutationOptions(event.req));
  }
  if (method === "GET" && attachment.attachmentId) {
    const downloaded = await runtime.downloadAttachment(tenant, attachment.doctype, attachment.id, attachment.field, attachment.attachmentId);
    return { metadata: downloaded.metadata, data: encodeBase64(downloaded.bytes) };
  }
  if (method === "DELETE" && attachment.attachmentId) {
    await runtime.deleteAttachment(tenant, attachment.doctype, attachment.id, attachment.field, attachment.attachmentId, mutationOptions(event.req));
    setResponseStatus(event, 204);
    return null;
  }
  throw new FramekitError("METHOD_NOT_ALLOWED", "Method not allowed", 405);
}

const match = matchDocumentPath(path, basePath);
if (!match) {
  throw new FramekitError("NOT_FOUND", "Route not found", 404);
}

const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
if (method === "GET" && !match.id) {
  const query = getQuery(event);
  const page = await runtime.listPage(tenant, match.doctype, {
    search: typeof query.search === "string" ? query.search : undefined,
    limit: typeof query.limit === "string" ? Number(query.limit) : undefined,
    offset: typeof query.offset === "string" ? Number(query.offset) : undefined,
    cursor: typeof query.cursor === "string" ? query.cursor : undefined,
    fields: parseFields(query.fields),
    filters: parseFilters(query.filters),
    sort: parseSort(query.sort)
  });
  if (page.nextCursor) event.res.headers.set("x-next-cursor", page.nextCursor);
  return page.items;
}
if (method === "GET" && match.id) {
  return await runtime.get(tenant, match.doctype, match.id);
}
if (method === "POST" && !match.id) {
  setResponseStatus(event, 201);
  return await runtime.create(tenant, match.doctype, (await readBody(event)) ?? {}, mutationOptions(event.req));
}
if (method === "PATCH" && match.id) {
  return await runtime.update(tenant, match.doctype, match.id, (await readBody(event)) ?? {}, mutationOptions(event.req));
}
if (method === "DELETE" && match.id) {
  await runtime.delete(tenant, match.doctype, match.id, mutationOptions(event.req));
  setResponseStatus(event, 204);
  return null;
}
if (method === "POST" && match.id && match.operation === "transition") {
  const body = (await readBody(event)) as { action?: string };
  return await runtime.transition(tenant, match.doctype, match.id, body.action ?? "", mutationOptions(event.req));
}
if (method === "POST" && match.id && match.operation === "submit") {
  return await runtime.submit(tenant, match.doctype, match.id, mutationOptions(event.req));
}
if (method === "POST" && match.id && match.operation === "cancel") {
  return await runtime.cancel(tenant, match.doctype, match.id, mutationOptions(event.req));
}
if (method === "POST" && match.id && match.operation === "owner") {
  const body = (await readBody(event)) as { ownerId?: string };
  return await runtime.transferOwner(tenant, match.doctype, match.id, body.ownerId ?? "", mutationOptions(event.req));
}

throw new FramekitError("METHOD_NOT_ALLOWED", "Method not allowed", 405);

}

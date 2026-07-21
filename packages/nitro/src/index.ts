import { defineEventHandler, getCookie, getQuery, getRouterParam, readBody, setCookie, setResponseStatus, type EventHandler, type H3Event } from "h3";
import { assertSecureAuthSecret, bearerToken, type PasswordAuthService } from "@framekit/auth";
import { FramekitError, type TenantContext } from "@framekit/core";
import { createOpenApiDocument } from "@framekit/openapi";
import type { FilterValue, FramekitRuntime } from "@framekit/runtime";

export type NitroAdapterOptions = {
  basePath?: string;
  serverUrl?: string;
  auth?: PasswordAuthService;
  logger?: NitroRequestLogger;
  metrics?: NitroMetricsSink;
  rateLimit?: NitroRateLimitOptions | NitroRateLimiter | false;
  healthChecks?: Record<string, NitroHealthCheck>;
  authCookie?: NitroAuthCookieOptions | false;
  cors?: NitroCorsOptions | false;
  security?: NitroHttpSecurityOptions;
  development?: NitroDevelopmentOptions;
};

export type NitroCorsOptions = {
  origins: string[];
  credentials?: boolean;
};

export type NitroHttpSecurityOptions = {
  /** Additional origins allowed to submit cookie-authenticated mutations. */
  trustedOrigins?: string[];
  /** Trust x-forwarded-proto and x-forwarded-host from a sanitizing reverse proxy. */
  trustProxy?: boolean;
};

export type NitroProductionCredentials = {
  environment?: string;
  authSecret?: string;
  bootstrap?: {
    email?: string;
    password?: string;
  };
};

export type NitroDevelopmentOptions = {
  /**
   * Accept caller-provided identity headers when no auth service is configured.
   * This escape hatch is accepted only when NODE_ENV is "development" or "test".
   */
  allowHeaderIdentity?: boolean;
};

export type NitroAuthCookieOptions = {
  name?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
};

export type NitroRequestTelemetry = {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
};

export type NitroRequestLogger = {
  info(event: NitroRequestTelemetry): void | Promise<void>;
  error?(event: NitroRequestTelemetry & { error: unknown }): void | Promise<void>;
};

export type NitroMetricsSink = {
  observeRequest(event: NitroRequestTelemetry): void | Promise<void>;
};

export type NitroRateLimitOptions = {
  windowMs: number;
  max: number;
  key?: (request: Request) => string;
};

export type NitroRateLimiter = {
  allow(input: { key: string; request: Request; method: string; path: string }): boolean | Promise<boolean>;
};

export type NitroHealthCheckResult = {
  ok: boolean;
  details?: unknown;
};

export type NitroHealthCheck = () => NitroHealthCheckResult | Promise<NitroHealthCheckResult>;

export function assertSecureProductionCredentials(options: NitroProductionCredentials): void {
  const environment = options.environment ?? nodeEnvironment();
  if (environment !== "production") {
    return;
  }
  try {
    assertSecureAuthSecret(options.authSecret ?? "", "production");
  } catch (error) {
    throw new Error(`FRAMEKIT_AUTH_SECRET: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (options.bootstrap) {
    const email = options.bootstrap.email?.trim().toLowerCase();
    if (!email || email === "admin@example.com" || email.endsWith("@example.com")) {
      throw new Error("Production bootstrap email must be explicitly provisioned and cannot use example.com.");
    }
    assertProductionValue("FRAMEKIT_ADMIN_PASSWORD", options.bootstrap.password, 14);
  }
}

export function createNitroHandler(runtime: FramekitRuntime, options: NitroAdapterOptions = {}): EventHandler {
  const basePath = options.basePath ?? "/api";
  const trustProxy = options.security?.trustProxy === true;
  const rateLimiter = createRateLimiter(options.rateLimit, trustProxy);
  const environment = nodeEnvironment();
  const authCookie = options.authCookie === false ? undefined : normalizeAuthCookieOptions(options.authCookie, environment);
  const cors = options.cors === false ? undefined : normalizeCorsOptions(options.cors, environment);
  const trustedOrigins = normalizeTrustedOrigins(options.security?.trustedOrigins, cors, environment);
  const allowHeaderIdentity = options.development?.allowHeaderIdentity === true;
  if (allowHeaderIdentity && environment !== "development" && environment !== "test") {
    throw new Error("development.allowHeaderIdentity requires NODE_ENV=development or NODE_ENV=test.");
  }

  return defineEventHandler(async (event) => {
    const startedAt = performance.now();
    const requestId = event.req.headers.get("x-request-id") ?? crypto.randomUUID();
    const path = event.url.pathname;
    const method = event.req.method ?? "GET";
    let statusCode = 200;
    let thrown: unknown;
    try {
      event.res.headers.set("x-request-id", requestId);
      event.res.headers.set("x-content-type-options", "nosniff");
      event.res.headers.set("referrer-policy", "no-referrer");
      event.res.headers.set("x-frame-options", "DENY");
      event.res.headers.set("cross-origin-resource-policy", "same-site");
      event.res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
      if (environment === "production") {
        event.res.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
      }

      applyCors(event, cors, allowHeaderIdentity);

      if (method === "OPTIONS") {
        statusCode = 204;
        setResponseStatus(event, 204);
        return null;
      }

      enforceCookieCsrf(event.req, authCookie, trustedOrigins, trustProxy);

      if (rateLimiter && !(await rateLimiter.allow({ key: requestKey(event.req, trustProxy), request: event.req, method, path }))) {
        statusCode = 429;
        throw new FramekitError("RATE_LIMITED", "Too many requests.", 429);
      }

      if (method === "GET" && path === "/health") {
        return { ok: true, app: runtime.app.name, version: runtime.app.version };
      }
      if (method === "GET" && path === "/health/dependencies") {
        const health = await runHealthChecks(options.healthChecks ?? {});
        if (!health.ok) {
          statusCode = 503;
          setResponseStatus(event, 503);
        }
        return health;
      }
      if (method === "GET" && path === basePath + "/meta") {
        return await runtime.metadata(await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity));
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
        return session;
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
        return session;
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
        return "apiToken" in session
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
            };
      }
      if (method === "POST" && path === basePath + "/auth/refresh") {
        const auth = requireAuth(options.auth);
        const token = sessionTokenFromEvent(event, authCookie);
        if (!token) {
          throw new FramekitError("UNAUTHENTICATED", "Missing session token.", 401);
        }
        const session = await auth.refreshSession(token);
        setSessionCookie(event, session.token, session.expiresAt, authCookie);
        return session;
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
        return null;
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
        return null;
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
        return null;
      }
      if (method === "GET" && path === basePath + "/auth/audit") {
        const auth = requireAuth(options.auth);
        const tenant = await authenticatedTenantFromRequest(event.req, auth, authCookie);
        assertAuthManager(tenant);
        return await auth.authAuditEvents(tenant.tenantId);
      }
      const authAction = matchAuthManagementPath(path, basePath);
      if (authAction) {
        const auth = requireAuth(options.auth);
        const tenant = await authenticatedTenantFromRequest(event.req, auth, authCookie);
        assertAuthManager(tenant);

        if (authAction.resource === "users") {
          if (method === "GET" && !authAction.id) {
            return await auth.listUsers(tenant.tenantId);
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
            return user;
          }
          if (method === "DELETE" && authAction.id) {
            await auth.deleteUser(tenant.tenantId, authAction.id);
            setResponseStatus(event, 204);
            return null;
          }
        }

        if (authAction.resource === "roles") {
          if (method === "GET" && !authAction.id) {
            return await auth.listRoles(tenant.tenantId);
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
            return role;
          }
          if (method === "DELETE" && authAction.id) {
            await auth.deleteRole(tenant.tenantId, authAction.id);
            setResponseStatus(event, 204);
            return null;
          }
        }

        if (authAction.resource === "tokens") {
          if (method === "GET" && !authAction.id) {
            return await auth.listApiTokens(tenant.tenantId);
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
            return await auth.createApiToken({
              tenantId: tenant.tenantId,
              id: body.id,
              name: body.name,
              userId: body.userId,
              roles: body.roles,
              permissions: body.permissions,
              expiresAt: body.expiresAt
            });
          }
          if (method === "DELETE" && authAction.id) {
            const revoked = await auth.revokeApiToken(tenant.tenantId, authAction.id);
            return revoked;
          }
        }

        throw new FramekitError("METHOD_NOT_ALLOWED", "Method not allowed", 405);
      }
      if (method === "GET" && path === basePath + "/diagnostics") {
        const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
        assertOperationPermission(tenant, "framekit.diagnostics.read", "read runtime diagnostics");
        return await runtime.diagnostics();
      }
      if (method === "GET" && path === basePath + "/migrations") {
        const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
        assertOperationPermission(tenant, "framekit.migrations.read", "read migration history");
        return await runtime.migrationHistory(tenant);
      }
      if (method === "GET" && path === basePath + "/realtime/events") {
        const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
        assertOperationPermission(tenant, "framekit.realtime.read", "read realtime events");
        const query = getQuery(event);
        return await runtime.realtimeEvents(tenant, {
          limit: typeof query.limit === "string" ? Number(query.limit) : undefined
        });
      }
      if (method === "GET" && path === basePath + "/realtime/stream") {
        const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
        assertOperationPermission(tenant, "framekit.realtime.read", "stream realtime events");
        return createRealtimeStream(runtime, tenant, event.req.signal);
      }
      if (method === "POST" && path === basePath + "/migrations/plan") {
        const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
        assertOperationPermission(tenant, "framekit.migrations.manage", "plan migrations");
        const body = ((await readBody(event)) ?? {}) as { app?: unknown };
        if (!body.app || typeof body.app !== "object") {
          throw new FramekitError("VALIDATION_FAILED", "app is required.", 422);
        }
        return await runtime.planMigration(tenant, body.app as never);
      }
      if (method === "POST" && path === basePath + "/migrations/apply") {
        const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
        assertOperationPermission(tenant, "framekit.migrations.manage", "apply migrations");
        const body = ((await readBody(event)) ?? {}) as { plan?: unknown; allowDestructive?: boolean };
        if (!body.plan || typeof body.plan !== "object") {
          throw new FramekitError("VALIDATION_FAILED", "plan is required.", 422);
        }
        return await runtime.applyMigration(tenant, body.plan as never, { allowDestructive: body.allowDestructive });
      }
      if (method === "GET" && path === basePath + "/audit") {
        const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
        assertOperationPermission(tenant, "framekit.audit.read", "read audit events");
        const query = getQuery(event);
        return await runtime.auditTrail(tenant, {
          limit: typeof query.limit === "string" ? Number(query.limit) : undefined
        });
      }
      if (method === "GET" && path === basePath + "/outbox") {
        const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
        assertOperationPermission(tenant, "framekit.outbox.read", "read outbox events");
        const query = getQuery(event);
        return await runtime.outboxEvents(tenant, {
          limit: typeof query.limit === "string" ? Number(query.limit) : undefined,
          status: isOutboxStatus(query.status) ? query.status : undefined
        });
      }
      const outboxAction = matchOutboxPath(path, basePath);
      if (method === "POST" && outboxAction) {
        const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
        assertOperationPermission(tenant, "framekit.outbox.manage", "mutate outbox events");
        if (outboxAction.action === "dispatch") {
          return await runtime.markOutboxDispatched(tenant, outboxAction.id);
        }
        const body = ((await readBody(event)) ?? {}) as { error?: string };
        return await runtime.markOutboxFailed(tenant, outboxAction.id, body.error ?? "Unknown dispatch failure");
      }
      if (method === "GET" && path === basePath + "/openapi.json") {
        return createOpenApiDocument(runtime.app, {
          basePath,
          serverUrl: options.serverUrl ?? event.url.origin
        });
      }
      if (method === "GET" && path === basePath + "/custom-fields") {
        const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
        assertOperationPermission(tenant, "framekit.customization.read", "read custom fields");
        return await runtime.customFields(tenant);
      }
      if (method === "POST" && path === basePath + "/custom-fields") {
        const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
        assertOperationPermission(tenant, "framekit.customization.manage", "add custom fields");
        const body = ((await readBody(event)) ?? {}) as { doctype?: string; field?: unknown };
        if (!body.doctype || !body.field) {
          throw new FramekitError("VALIDATION_FAILED", "doctype and field are required.", 422);
        }
        setResponseStatus(event, 201);
        return await runtime.addCustomField(tenant, { doctype: body.doctype, field: body.field });
      }
      if (method === "GET" && path === basePath + "/views") {
        const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
        assertOperationPermission(tenant, "framekit.customization.read", "read views");
        return await runtime.views(tenant);
      }
      if (method === "POST" && path === basePath + "/views") {
        const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
        assertOperationPermission(tenant, "framekit.customization.manage", "update views");
        const body = ((await readBody(event)) ?? {}) as { doctype?: string; type?: "list" | "form"; fields?: string[] };
        if (!body.doctype || (body.type !== "list" && body.type !== "form") || !Array.isArray(body.fields)) {
          throw new FramekitError("VALIDATION_FAILED", "doctype, type, and fields are required.", 422);
        }
        return await runtime.upsertView(tenant, { doctype: body.doctype, type: body.type, fields: body.fields });
      }

      const match = matchDocumentPath(path, basePath);
      if (!match) {
        throw new FramekitError("NOT_FOUND", "Route not found", 404);
      }

      const tenant = await tenantFromRequest(event.req, options.auth, authCookie, allowHeaderIdentity);
      if (method === "GET" && !match.id) {
        const query = getQuery(event);
        return await runtime.list(tenant, match.doctype, {
          search: typeof query.search === "string" ? query.search : undefined,
          limit: typeof query.limit === "string" ? Number(query.limit) : undefined,
          offset: typeof query.offset === "string" ? Number(query.offset) : undefined,
          cursor: typeof query.cursor === "string" ? query.cursor : undefined,
          fields: parseFields(query.fields),
          filters: parseFilters(query.filters),
          sort: parseSort(query.sort)
        });
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

      throw new FramekitError("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    } catch (error) {
      thrown = error;
      const response = toErrorResponse(error);
      statusCode = response.statusCode;
      setResponseStatus(event, response.statusCode);
      return response.body;
    } finally {
      const telemetry = {
        requestId,
        method,
        path,
        statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100
      };
      await options.metrics?.observeRequest(telemetry);
      if (thrown && options.logger?.error) {
        await options.logger.error({ ...telemetry, error: thrown });
      } else {
        await options.logger?.info(telemetry);
      }
    }
  });
}

export function routeParam(name: string): string {
  return getRouterParam({ context: { params: {} } } as never, name) ?? "";
}

function matchDocumentPath(path: string, basePath: string): { doctype: string; id?: string; operation?: string } | undefined {
  const prefix = `${basePath}/doctypes/`;
  if (!path.startsWith(prefix)) {
    return undefined;
  }
  const parts = path.slice(prefix.length).split("/").filter(Boolean);
  if (parts.length === 1) {
    return { doctype: parts[0] ?? "" };
  }
  if (parts.length === 2) {
    return { doctype: parts[0] ?? "", id: parts[1] };
  }
  if (parts.length === 3 && parts[2] === "transition") {
    return { doctype: parts[0] ?? "", id: parts[1], operation: "transition" };
  }
  return undefined;
}

function matchOutboxPath(path: string, basePath: string): { id: string; action: "dispatch" | "fail" } | undefined {
  const prefix = `${basePath}/outbox/`;
  if (!path.startsWith(prefix)) {
    return undefined;
  }
  const [id, action] = path.slice(prefix.length).split("/").filter(Boolean);
  if (!id || (action !== "dispatch" && action !== "fail")) {
    return undefined;
  }
  return { id, action };
}

function matchAuthManagementPath(path: string, basePath: string): { resource: "users" | "roles" | "tokens"; id?: string } | undefined {
  const prefix = `${basePath}/auth/`;
  if (!path.startsWith(prefix)) {
    return undefined;
  }
  const [resource, id] = path.slice(prefix.length).split("/").filter(Boolean);
  if (resource !== "users" && resource !== "roles" && resource !== "tokens") {
    return undefined;
  }
  return id ? { resource, id } : { resource };
}

function matchProviderLoginPath(path: string, basePath: string): { providerId: string } | undefined {
  const prefix = `${basePath}/auth/providers/`;
  if (!path.startsWith(prefix)) {
    return undefined;
  }
  const [providerId, operation] = path.slice(prefix.length).split("/").filter(Boolean);
  return providerId && operation === "login" ? { providerId } : undefined;
}

function matchUserPasswordPath(path: string, basePath: string): { userId: string } | undefined {
  const prefix = `${basePath}/auth/users/`;
  if (!path.startsWith(prefix)) {
    return undefined;
  }
  const [userId, operation] = path.slice(prefix.length).split("/").filter(Boolean);
  return userId && operation === "password" ? { userId } : undefined;
}

function isOutboxStatus(value: unknown): value is "pending" | "dispatched" | "failed" {
  return value === "pending" || value === "dispatched" || value === "failed";
}

function requireAuth(auth: PasswordAuthService | undefined): PasswordAuthService {
  if (!auth) {
    throw new FramekitError("AUTH_NOT_CONFIGURED", "Auth is not configured for this app.", 501);
  }
  return auth;
}

async function authenticatedTenantFromRequest(request: Request, auth: PasswordAuthService, cookie?: Required<NitroAuthCookieOptions>): Promise<TenantContext> {
  const token = sessionTokenFromRequest(request, cookie);
  if (!token) {
    throw new FramekitError("UNAUTHENTICATED", "Missing session token.", 401);
  }
  return (await auth.verifyBearerToken(token)).context;
}

async function tenantFromRequest(
  request: Request,
  auth?: PasswordAuthService,
  cookie?: Required<NitroAuthCookieOptions>,
  allowHeaderIdentity = false
): Promise<TenantContext> {
  const token = sessionTokenFromRequest(request, cookie);
  if (auth) {
    if (!token) {
      throw new FramekitError("UNAUTHENTICATED", "Missing session token.", 401);
    }
    return (await auth.verifyBearerToken(token)).context;
  }
  if (!allowHeaderIdentity) {
    throw new FramekitError("AUTH_NOT_CONFIGURED", "Auth is required for protected routes.", 501);
  }
  return {
    tenantId: request.headers.get("x-tenant-id") ?? "default",
    userId: request.headers.get("x-user-id") ?? "system",
    roles: splitHeader(request.headers.get("x-roles")) ?? ["administrator"],
    permissions: splitHeader(request.headers.get("x-permissions")) ?? ["*"]
  };
}

function sessionTokenFromEvent(event: H3Event, cookie?: Required<NitroAuthCookieOptions>): string | undefined {
  return bearerToken(event.req.headers.get("authorization")) ?? (cookie ? getCookie(event, cookie.name) : undefined);
}

function sessionTokenFromRequest(request: Request, cookie?: Required<NitroAuthCookieOptions>): string | undefined {
  return bearerToken(request.headers.get("authorization")) ?? (cookie ? cookieValue(request.headers.get("cookie"), cookie.name) : undefined);
}

function normalizeAuthCookieOptions(options: NitroAuthCookieOptions | undefined, environment: string | undefined): Required<NitroAuthCookieOptions> {
  const normalized = {
    name: options?.name ?? "framekit_session",
    path: options?.path ?? "/",
    httpOnly: options?.httpOnly ?? true,
    secure: options?.secure ?? environment === "production",
    sameSite: options?.sameSite ?? "lax"
  };
  if (environment === "production" && !normalized.secure) {
    throw new Error("Session cookies must use Secure when NODE_ENV=production.");
  }
  if (normalized.sameSite === "none" && !normalized.secure) {
    throw new Error("Session cookies with SameSite=None must use Secure.");
  }
  return normalized;
}

type NormalizedCorsOptions = {
  origins: Set<string>;
  credentials: boolean;
};

function normalizeCorsOptions(options: NitroCorsOptions | undefined, environment: string | undefined): NormalizedCorsOptions | undefined {
  if (!options) {
    return undefined;
  }
  if (options.origins.length === 0) {
    throw new Error("cors.origins must include at least one origin.");
  }
  const origins = new Set(options.origins.map((origin) => origin === "*" ? origin : normalizeOrigin(origin)));
  const credentials = options.credentials === true;
  if (credentials && origins.has("*")) {
    throw new Error("Credentialed CORS cannot use the wildcard origin.");
  }
  assertProductionHttpsOrigins(origins, environment, "cors.origins");
  return { origins, credentials };
}

function normalizeTrustedOrigins(origins: string[] | undefined, cors: NormalizedCorsOptions | undefined, environment: string | undefined): Set<string> {
  const trusted = new Set<string>();
  for (const origin of origins ?? []) {
    if (origin === "*") {
      throw new Error("security.trustedOrigins cannot contain a wildcard.");
    }
    trusted.add(normalizeOrigin(origin));
  }
  if (cors?.credentials) {
    for (const origin of cors.origins) {
      if (origin !== "*") {
        trusted.add(origin);
      }
    }
  }
  assertProductionHttpsOrigins(trusted, environment, "security.trustedOrigins");
  return trusted;
}

function assertProductionHttpsOrigins(origins: Set<string>, environment: string | undefined, option: string): void {
  if (environment !== "production") {
    return;
  }
  for (const origin of origins) {
    if (origin !== "*" && !origin.startsWith("https://")) {
      throw new Error(`${option} must use HTTPS when NODE_ENV=production.`);
    }
  }
}

function normalizeOrigin(origin: string): string {
  const url = new URL(origin);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin.replace(/\/$/, "")) {
    throw new Error(`Invalid origin: ${origin}`);
  }
  return url.origin;
}

function applyCors(event: H3Event, cors: NormalizedCorsOptions | undefined, allowHeaderIdentity: boolean): void {
  if (!cors) {
    return;
  }
  const requestOrigin = event.req.headers.get("origin");
  if (!requestOrigin) {
    return;
  }
  let normalizedOrigin: string;
  try {
    normalizedOrigin = normalizeOrigin(requestOrigin);
  } catch {
    if (event.req.method === "OPTIONS") {
      throw new FramekitError("CORS_ORIGIN_DENIED", "Request origin is not allowed.", 403);
    }
    return;
  }
  const wildcard = cors.origins.has("*");
  if (!wildcard && !cors.origins.has(normalizedOrigin)) {
    if (event.req.method === "OPTIONS") {
      throw new FramekitError("CORS_ORIGIN_DENIED", "Request origin is not allowed.", 403);
    }
    return;
  }
  event.res.headers.set("access-control-allow-origin", wildcard ? "*" : normalizedOrigin);
  event.res.headers.append("vary", "Origin");
  event.res.headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  event.res.headers.set("access-control-allow-headers", allowHeaderIdentity
    ? "authorization,content-type,if-match,idempotency-key,x-tenant-id,x-user-id,x-roles,x-permissions"
    : "authorization,content-type,if-match,idempotency-key,x-tenant-id");
  if (cors.credentials) {
    event.res.headers.set("access-control-allow-credentials", "true");
  }
}

function enforceCookieCsrf(
  request: Request,
  cookie: Required<NitroAuthCookieOptions> | undefined,
  trustedOrigins: Set<string>,
  trustProxy: boolean
): void {
  if (!cookie || !isUnsafeMethod(request.method) || bearerToken(request.headers.get("authorization"))) {
    return;
  }
  if (!cookieValue(request.headers.get("cookie"), cookie.name)) {
    return;
  }
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin) {
    throw new FramekitError("CSRF_ORIGIN_REQUIRED", "Cookie-authenticated mutations require an Origin header.", 403);
  }
  let origin: string;
  try {
    origin = normalizeOrigin(rawOrigin);
  } catch {
    throw new FramekitError("CSRF_ORIGIN_DENIED", "Request origin is not trusted.", 403);
  }
  if (origin === canonicalRequestOrigin(request, trustProxy) || trustedOrigins.has(origin)) {
    return;
  }
  throw new FramekitError("CSRF_ORIGIN_DENIED", "Request origin is not trusted.", 403);
}

function canonicalRequestOrigin(request: Request, trustProxy: boolean): string {
  if (trustProxy) {
    const protocol = firstForwardedValue(request.headers.get("x-forwarded-proto"));
    const host = firstForwardedValue(request.headers.get("x-forwarded-host"));
    if (protocol && host && (protocol === "http" || protocol === "https")) {
      try {
        return new URL(`${protocol}://${host}`).origin;
      } catch {
        return new URL(request.url).origin;
      }
    }
  }
  return new URL(request.url).origin;
}

function firstForwardedValue(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

function isUnsafeMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function setSessionCookie(event: H3Event, token: string, expiresAt: string, cookie?: Required<NitroAuthCookieOptions>): void {
  if (!cookie) {
    return;
  }
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  setCookie(event, cookie.name, token, {
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    maxAge
  });
}

function clearSessionCookie(event: H3Event, cookie?: Required<NitroAuthCookieOptions>): void {
  if (!cookie) {
    return;
  }
  setCookie(event, cookie.name, "", {
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    maxAge: 0
  });
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return undefined;
}

function assertAuthManager(tenant: TenantContext): void {
  if (tenant.permissions.includes("*") || tenant.permissions.includes("framekit.auth.manage") || tenant.roles.includes("administrator")) {
    return;
  }
  throw new FramekitError("FORBIDDEN", "Missing permission to manage authentication resources.", 403);
}

function assertOperationPermission(tenant: TenantContext, permission: string, operation: string): void {
  if (tenant.permissions.includes("*") || tenant.permissions.includes(permission)) {
    return;
  }
  throw new FramekitError("FORBIDDEN", `Missing ${permission} permission to ${operation}.`, 403);
}

function splitHeader(value: string | null): string[] | undefined {
  return value ? value.split(",").map((part) => part.trim()).filter(Boolean) : undefined;
}

function createRateLimiter(option: NitroAdapterOptions["rateLimit"], trustProxy: boolean): NitroRateLimiter | undefined {
  if (!option) {
    return undefined;
  }
  if ("allow" in option) {
    return option;
  }
  const buckets = new Map<string, { count: number; resetsAt: number }>();
  return {
    allow({ request }) {
      const key = option.key?.(request) ?? requestKey(request, trustProxy);
      const now = Date.now();
      const current = buckets.get(key);
      if (!current || current.resetsAt <= now) {
        buckets.set(key, { count: 1, resetsAt: now + option.windowMs });
        return true;
      }
      current.count += 1;
      return current.count <= option.max;
    }
  };
}

function requestKey(request: Request, trustProxy: boolean): string {
  if (!trustProxy) {
    return "untrusted-proxy";
  }
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "trusted-proxy-unknown";
}

function assertProductionValue(name: string, value: string | undefined, minimumLength: number): void {
  const normalized = value?.trim();
  const lower = normalized?.toLowerCase() ?? "";
  if (
    !normalized
    || normalized.length < minimumLength
    || lower.includes("change-me")
    || lower.includes("changeme")
    || lower.includes("replace-with")
    || lower === "admin12345"
    || new Set(normalized).size < 8
  ) {
    throw new Error(`${name} must be explicitly provisioned with a strong, non-default value in production.`);
  }
}

function nodeEnvironment(): string | undefined {
  return (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
}

function mutationOptions(request: Request): { expectedRevision?: number; idempotencyKey?: string } {
  const ifMatch = request.headers.get("if-match")?.replaceAll('"', "");
  const expectedRevision = ifMatch === undefined ? undefined : Number(ifMatch);
  if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
    throw new FramekitError("INVALID_REVISION", "If-Match must contain a positive integer revision.", 422);
  }
  return {
    expectedRevision,
    idempotencyKey: request.headers.get("idempotency-key") ?? undefined
  };
}

async function runHealthChecks(checks: Record<string, NitroHealthCheck>) {
  const entries = await Promise.all(Object.entries(checks).map(async ([name, check]) => {
    try {
      return [name, await check()] as const;
    } catch (error) {
      return [name, { ok: false, details: error instanceof Error ? error.message : String(error) }] as const;
    }
  }));
  const dependencies = Object.fromEntries(entries);
  return {
    ok: Object.values(dependencies).every((result) => result.ok),
    dependencies
  };
}

function parseFilters(value: unknown): Record<string, FilterValue> | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new FramekitError("VALIDATION_FAILED", "filters must be valid JSON.", 422);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FramekitError("VALIDATION_FAILED", "filters must be a JSON object.", 422);
  }
  const filters: Record<string, FilterValue> = {};
  for (const [field, filter] of Object.entries(parsed)) {
    filters[field] = toFilterValue(filter);
  }
  return filters;
}

function parseSort(value: unknown): { field: string; direction?: "asc" | "desc" } | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const [field, rawDirection] = value.split(":");
  const direction = rawDirection === "asc" || rawDirection === "desc" ? rawDirection : undefined;
  if (!field || (direction && direction !== "asc" && direction !== "desc")) {
    throw new FramekitError("VALIDATION_FAILED", "sort must be formatted as field:asc or field:desc.", 422);
  }
  if (rawDirection && !direction) {
    throw new FramekitError("VALIDATION_FAILED", "sort must be formatted as field:asc or field:desc.", 422);
  }
  return direction ? { field, direction } : { field };
}

function parseFields(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = Array.isArray(value) ? value.join(",") : String(value);
  const fields = raw.split(",").map((field) => field.trim()).filter(Boolean);
  return fields.length > 0 ? [...new Set(fields)] : undefined;
}

function toFilterValue(value: unknown): FilterValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
        return item;
      }
      throw new FramekitError("VALIDATION_FAILED", "filter arrays may only contain primitive values.", 422);
    });
  }
  if (value && typeof value === "object") {
    return value as FilterValue;
  }
  throw new FramekitError("VALIDATION_FAILED", "filters may only contain primitive values, arrays, or operator objects.", 422);
}

function createRealtimeStream(runtime: FramekitRuntime, tenant: TenantContext, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      unsubscribe = runtime.subscribeRealtime(tenant, (event) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`));
      });
      signal.addEventListener("abort", () => {
        unsubscribe?.();
        controller.close();
      }, { once: true });
    },
    cancel() {
      unsubscribe?.();
    }
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}

function toErrorResponse(error: unknown): { statusCode: number; body: { error: true; code: string; message: string; details?: unknown } } {
  if (error instanceof FramekitError) {
    return {
      statusCode: error.statusCode,
      body: { error: true, code: error.code, message: error.message, details: error.details }
    };
  }
  return {
    statusCode: 500,
    body: { error: true, code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Internal server error" }
  };
}

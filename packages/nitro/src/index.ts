import { defineEventHandler, getCookie, getQuery, getRouterParam, readBody, sendRedirect, setCookie, setResponseStatus, type EventHandler, type H3Event } from "h3";
import { bearerToken, type PasswordAuthService } from "@framekit/auth";
import { FramekitError, type TenantContext } from "@framekit/core";
import { createOpenApiDocument } from "@framekit/openapi";
import type { DocumentCommandRequest, FilterValue, FramekitRuntime, RuntimeRealtimeEvent } from "@framekit/runtime";
import { assertSecureProductionCredentials, nodeEnvironment } from "./production-policy.js";
import { applyResponseSecurityHeaders, requestContext } from "./request-security-policy.js";
import { dispatchNitroRoutes, normalizeNitroBasePath, type RouteContext } from "./route-dispatcher.js";
import { matchProviderLoginPath as routeProviderLoginPath } from "./route-matchers.js";
import { redactTelemetry, redactTelemetryError } from "./telemetry.js";

export type NitroAdapterOptions = {
  basePath?: string;
  serverUrl?: string;
  auth?: PasswordAuthService;
  logger?: NitroRequestLogger;
  metrics?: NitroMetricsSink;
  tracer?: NitroTraceSink;
  rateLimit?: NitroRateLimitOptions | NitroRateLimiter | false;
  healthChecks?: Record<string, NitroHealthCheck>;
  healthCheckTimeoutMs?: number;
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

export type { NitroProductionCredentials } from "./contracts.js";

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

export type NitroTraceSpan = {
  setAttribute?(name: string, value: string | number | boolean): void;
  recordException?(error: unknown): void;
  end(): void;
};

export type NitroTraceSink = {
  startSpan(name: string, attributes: Record<string, string | number | boolean>): NitroTraceSpan;
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

export type NitroHealthCheck = (signal: AbortSignal) => NitroHealthCheckResult | Promise<NitroHealthCheckResult>;

export type OpenTelemetryCompatibleLogger = { emit(record: { severityText: string; body: string; attributes: Record<string, unknown> }): void };
export type OpenTelemetryCompatibleTracer = { startSpan(name: string, options: { attributes: Record<string, string | number | boolean> }): NitroTraceSpan };
export type OpenTelemetryCompatibleMeter = {
  createHistogram(name: string): { record(value: number, attributes?: Record<string, string | number | boolean>): void };
  createCounter(name: string): { add(value: number, attributes?: Record<string, string | number | boolean>): void };
};

export function createOpenTelemetryAdapters(options: {
  logger?: OpenTelemetryCompatibleLogger;
  tracer?: OpenTelemetryCompatibleTracer;
  meter?: OpenTelemetryCompatibleMeter;
}): Pick<NitroAdapterOptions, "logger" | "metrics" | "tracer"> {
  const duration = options.meter?.createHistogram("http.server.request.duration");
  const requests = options.meter?.createCounter("http.server.request.count");
  return {
    logger: options.logger ? {
      info: (event) => options.logger!.emit({ severityText: "INFO", body: "HTTP request", attributes: redactTelemetry(event) as Record<string, unknown> }),
      error: (event) => options.logger!.emit({ severityText: "ERROR", body: "HTTP request failed", attributes: redactTelemetry(event) as Record<string, unknown> })
    } : undefined,
    metrics: options.meter ? {
      observeRequest: (event) => {
        const attributes = { "http.request.method": event.method, "http.route": event.path, "http.response.status_code": event.statusCode };
        duration!.record(event.durationMs, attributes);
        requests!.add(1, attributes);
      }
    } : undefined,
    tracer: options.tracer ? { startSpan: (name, attributes) => options.tracer!.startSpan(name, { attributes }) } : undefined
  };
}

export { assertSecureProductionCredentials } from "./production-policy.js";

export function createNitroHandler(runtime: FramekitRuntime, options: NitroAdapterOptions = {}): EventHandler {
  const basePath = normalizeNitroBasePath(options.basePath ?? "/api");
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
    const { startedAt, requestId, path, method } = requestContext(event);
    const span = options.tracer?.startSpan("http.request", { "http.request.method": method, "url.path": path, "http.request_id": requestId });
    let statusCode = 200;
    let thrown: unknown;
    try {
      event.res.headers.set("x-request-id", requestId);
      applyResponseSecurityHeaders(event, environment);

      applyCors(event, cors, allowHeaderIdentity);

      if (method === "OPTIONS") {
        statusCode = 204;
        setResponseStatus(event, 204);
        return null;
      }

      enforceCookieCsrf(event.req, authCookie, trustedOrigins, trustProxy);
      if (isCookieIssuingAuthRoute(method, path, basePath)) {
        enforceCookieIssuanceOrigin(event.req, authCookie, trustedOrigins, trustProxy);
      }

      if (rateLimiter && !(await rateLimiter.allow({ key: requestKey(event.req, trustProxy), request: event.req, method, path }))) {
        statusCode = 429;
        throw new FramekitError("RATE_LIMITED", "Too many requests.", 429);
      }

      const routeContext = { runtime, options, basePath, authCookie, allowHeaderIdentity, setTelemetryStatus: (code: number) => { statusCode = code; }, helpers: { assertAuthManager, assertOperationPermission, authenticatedTenantFromRequest, canonicalLocale, clearSessionCookie, createRealtimeStream, decodeBase64, encodeBase64, isOutboxStatus, isPlainObject, mutationOptions, parseFields, parseFilters, parseSort, preferredLocale, requireAuth, runHealthChecks, sessionTokenFromEvent, setSessionCookie, tenantFromRequest } } satisfies RouteContext;
      return await dispatchNitroRoutes(event, routeContext);
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
      span?.setAttribute?.("http.response.status_code", statusCode);
      if (thrown) span?.recordException?.(redactTelemetryError(thrown));
      span?.end();
      await options.metrics?.observeRequest(telemetry);
      if (thrown && options.logger?.error) {
        await options.logger.error({ ...telemetry, error: redactTelemetryError(thrown) });
      } else {
        await options.logger?.info(telemetry);
      }
    }
  });
}

function preferredLocale(header: string | null, supportedLocales: string[]): string | undefined {
  const candidates = (header ?? "").split(",").map((entry, index) => {
    const [tag = "", ...parameters] = entry.trim().split(";");
    const quality = Number(parameters.find((parameter) => parameter.trim().startsWith("q="))?.trim().slice(2) ?? "1");
    return { locale: canonicalLocale(tag), quality: Number.isFinite(quality) ? quality : 0, index };
  }).filter((candidate) => candidate.locale && candidate.quality > 0).sort((left, right) => right.quality - left.quality || left.index - right.index);
  return candidates.find((candidate) => {
    const parts = candidate.locale!.split("-");
    return parts.some((_, index) => supportedLocales.includes(parts.slice(0, parts.length - index).join("-")));
  })?.locale ?? candidates[0]?.locale;
}

function canonicalLocale(locale: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(locale)[0];
  } catch {
    return undefined;
  }
}

export function routeParam(name: string): string {
  return getRouterParam({ context: { params: {} } } as never, name) ?? "";
}

function decodeBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new FramekitError("INVALID_ATTACHMENT", "Attachment data must be valid base64.", 422);
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
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
    throw new FramekitError("CORS_ORIGIN_DENIED", "Request origin is not allowed.", 403);
  }
  const wildcard = cors.origins.has("*");
  if (!wildcard && !cors.origins.has(normalizedOrigin)) {
    throw new FramekitError("CORS_ORIGIN_DENIED", "Request origin is not allowed.", 403);
  }
  event.res.headers.set("access-control-allow-origin", wildcard ? "*" : normalizedOrigin);
  event.res.headers.set("access-control-expose-headers", "x-next-cursor,x-request-id");
  event.res.headers.append("vary", "Origin");
  event.res.headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  // Browser SDK clients send identity-context headers in every mode. They are
  // accepted by CORS but remain untrusted unless development header identity
  // is explicitly enabled.
  event.res.headers.set(
    "access-control-allow-headers",
    "authorization,content-type,if-match,idempotency-key,x-tenant-id,x-user-id,x-roles,x-permissions"
  );
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
  assertTrustedRequestOrigin(request, trustedOrigins, trustProxy, "Cookie-authenticated mutations");
}

function enforceCookieIssuanceOrigin(
  request: Request,
  cookie: Required<NitroAuthCookieOptions> | undefined,
  trustedOrigins: Set<string>,
  trustProxy: boolean
): void {
  if (!cookie) {
    return;
  }
  assertTrustedRequestOrigin(request, trustedOrigins, trustProxy, "Cookie-establishing authentication requests");
}

function assertTrustedRequestOrigin(request: Request, trustedOrigins: Set<string>, trustProxy: boolean, operation: string): void {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin) {
    throw new FramekitError("CSRF_ORIGIN_REQUIRED", `${operation} require an Origin header.`, 403);
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

function isCookieIssuingAuthRoute(method: string, path: string, basePath: string): boolean {
  if (method !== "POST") {
    return false;
  }
  return path === `${basePath}/auth/mfa/complete`
    || path === `${basePath}/auth/login`
    || path === `${basePath}/auth/refresh`
    || path === `${basePath}/auth/invitations/accept`
    || Boolean(routeProviderLoginPath(path, basePath));
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

async function runHealthChecks(checks: Record<string, NitroHealthCheck>, timeoutMs: number) {
  const boundedTimeoutMs = Math.max(1, Math.min(timeoutMs, 30_000));
  const entries = await Promise.all(Object.entries(checks).map(async ([name, check]) => {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("HEALTH_CHECK_TIMEOUT"));
          controller.abort(new Error(`Health check exceeded ${boundedTimeoutMs}ms.`));
        }, boundedTimeoutMs);
      });
      return [name, await Promise.race([Promise.resolve(check(controller.signal)), timeout])] as const;
    } catch (error) {
      return [name, {
        ok: false,
        details: timedOut
          ? { code: "HEALTH_CHECK_TIMEOUT", timeoutMs: boundedTimeoutMs }
          : redactTelemetryError(error)
      }] as const;
    } finally {
      if (timer) clearTimeout(timer);
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function createRealtimeStream(runtime: FramekitRuntime, tenant: TenantContext, signal: AbortSignal, after?: string): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  let dispose = () => {
    closed = true;
    unsubscribe?.();
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      await Promise.resolve();
      let lastCursor = after;
      let ready = false;
      let dirty = true;
      let pump: Promise<void> | undefined;
      const ephemeral: RuntimeRealtimeEvent[] = [];
      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        if (closed) return;
        cleanup();
        controller.close();
      };
      dispose = cleanup;
      signal.addEventListener("abort", abort, { once: true });
      const send = (event: RuntimeRealtimeEvent) => {
        if (closed) return;
        if (event.cursor && lastCursor && compareRealtimeCursors(event.cursor, lastCursor) <= 0) return;
        if (event.cursor) lastCursor = event.cursor;
        const id = event.cursor ? `id: ${event.cursor}\n` : "";
        controller.enqueue(encoder.encode(`${id}event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`));
      };
      const replayAvailable = async () => {
        while (!closed) {
          const previousCursor = lastCursor;
          const events = await runtime.realtimeEvents(tenant, { after: lastCursor, limit: 1_000, order: "asc" });
          events.sort((left, right) => compareRealtimeCursors(left.cursor, right.cursor));
          for (const event of events) send(event);
          if (events.length < 1_000 || lastCursor === previousCursor) return;
        }
      };
      const requestPump = () => {
        dirty = true;
        if (!ready || pump || closed) return;
        pump = (async () => {
          while (dirty && !closed) {
            dirty = false;
            await replayAvailable();
          }
        })().catch((error) => {
          cleanup();
          // H3 may still be attaching the response reader after dispatch has
          // yielded to a focused route handler. Surface replay failures on the
          // stream after that attachment point.
          setTimeout(() => controller.error(error), 0);
        }).finally(() => {
          pump = undefined;
          if (dirty && !closed) requestPump();
        });
      };
      try {
        const subscribed = await runtime.subscribeRealtime(tenant, (event) => {
          if (!event.cursor) {
            if (!ready) ephemeral.push(event);
            else send(event);
            return;
          }
          requestPump();
        }, { signal });
        unsubscribe = subscribed;
        if (closed || signal.aborted) {
          subscribed();
          return;
        }
        ready = true;
        requestPump();
        await pump;
        for (const event of ephemeral) send(event);
      } catch (error) {
        cleanup();
        controller.error(error);
      }
    },
    cancel() {
      dispose();
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

function compareRealtimeCursors(left?: string, right?: string): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  }
  return left.localeCompare(right);
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

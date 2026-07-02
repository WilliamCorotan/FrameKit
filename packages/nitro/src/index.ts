import { defineEventHandler, getQuery, getRouterParam, readBody, setResponseStatus, type EventHandler } from "h3";
import { bearerToken, type PasswordAuthService } from "@framekit/auth";
import { FramekitError, type TenantContext } from "@framekit/core";
import { createOpenApiDocument } from "@framekit/openapi";
import type { FramekitRuntime } from "@framekit/runtime";

export type NitroAdapterOptions = {
  basePath?: string;
  serverUrl?: string;
  auth?: PasswordAuthService;
};

export function createNitroHandler(runtime: FramekitRuntime, options: NitroAdapterOptions = {}): EventHandler {
  const basePath = options.basePath ?? "/api";

  return defineEventHandler(async (event) => {
    try {
      event.res.headers.set("access-control-allow-origin", "*");
      event.res.headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
      event.res.headers.set("access-control-allow-headers", "content-type,x-tenant-id,x-user-id,x-roles,x-permissions");
      const path = event.url.pathname;
      const method = event.req.method ?? "GET";

      if (method === "OPTIONS") {
        setResponseStatus(event, 204);
        return null;
      }

      if (method === "GET" && path === "/health") {
        return { ok: true, app: runtime.app.name, version: runtime.app.version };
      }
      if (method === "GET" && path === basePath + "/meta") {
        return await runtime.metadata(await tenantFromRequest(event.req, options.auth));
      }
      if (method === "POST" && path === basePath + "/auth/login") {
        if (!options.auth) {
          throw new FramekitError("AUTH_NOT_CONFIGURED", "Auth is not configured for this app.", 501);
        }
        const body = ((await readBody(event)) ?? {}) as { email?: string; password?: string };
        if (!body.email || !body.password) {
          throw new FramekitError("VALIDATION_FAILED", "Email and password are required.", 422);
        }
        return await options.auth.login(body.email, body.password);
      }
      if (method === "GET" && path === basePath + "/auth/me") {
        if (!options.auth) {
          throw new FramekitError("AUTH_NOT_CONFIGURED", "Auth is not configured for this app.", 501);
        }
        const token = bearerToken(event.req.headers.get("authorization"));
        if (!token) {
          throw new FramekitError("UNAUTHENTICATED", "Missing Bearer token.", 401);
        }
        const session = await options.auth.verifyToken(token);
        return {
          user: session.user,
          context: session.context,
          expiresAt: session.expiresAt
        };
      }
      if (method === "GET" && path === basePath + "/diagnostics") {
        return await runtime.diagnostics();
      }
      if (method === "GET" && path === basePath + "/audit") {
        const tenant = await tenantFromRequest(event.req, options.auth);
        const query = getQuery(event);
        return await runtime.auditTrail(tenant, {
          limit: typeof query.limit === "string" ? Number(query.limit) : undefined
        });
      }
      if (method === "GET" && path === basePath + "/outbox") {
        const tenant = await tenantFromRequest(event.req, options.auth);
        const query = getQuery(event);
        return await runtime.outboxEvents(tenant, {
          limit: typeof query.limit === "string" ? Number(query.limit) : undefined,
          status: isOutboxStatus(query.status) ? query.status : undefined
        });
      }
      const outboxAction = matchOutboxPath(path, basePath);
      if (method === "POST" && outboxAction) {
        const tenant = await tenantFromRequest(event.req, options.auth);
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
        return await runtime.customFields(await tenantFromRequest(event.req, options.auth));
      }
      if (method === "POST" && path === basePath + "/custom-fields") {
        const tenant = await tenantFromRequest(event.req, options.auth);
        const body = ((await readBody(event)) ?? {}) as { doctype?: string; field?: unknown };
        if (!body.doctype || !body.field) {
          throw new FramekitError("VALIDATION_FAILED", "doctype and field are required.", 422);
        }
        setResponseStatus(event, 201);
        return await runtime.addCustomField(tenant, { doctype: body.doctype, field: body.field });
      }
      if (method === "GET" && path === basePath + "/views") {
        return await runtime.views(await tenantFromRequest(event.req, options.auth));
      }
      if (method === "POST" && path === basePath + "/views") {
        const tenant = await tenantFromRequest(event.req, options.auth);
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

      const tenant = await tenantFromRequest(event.req, options.auth);
      if (method === "GET" && !match.id) {
        const query = getQuery(event);
        return await runtime.list(tenant, match.doctype, {
          search: typeof query.search === "string" ? query.search : undefined,
          limit: typeof query.limit === "string" ? Number(query.limit) : undefined
        });
      }
      if (method === "GET" && match.id) {
        return await runtime.get(tenant, match.doctype, match.id);
      }
      if (method === "POST" && !match.id) {
        setResponseStatus(event, 201);
        return await runtime.create(tenant, match.doctype, (await readBody(event)) ?? {});
      }
      if (method === "PATCH" && match.id) {
        return await runtime.update(tenant, match.doctype, match.id, (await readBody(event)) ?? {});
      }
      if (method === "DELETE" && match.id) {
        await runtime.delete(tenant, match.doctype, match.id);
        setResponseStatus(event, 204);
        return null;
      }
      if (method === "POST" && match.id && match.operation === "transition") {
        const body = (await readBody(event)) as { action?: string };
        return await runtime.transition(tenant, match.doctype, match.id, body.action ?? "");
      }

      throw new FramekitError("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    } catch (error) {
      const response = toErrorResponse(error);
      setResponseStatus(event, response.statusCode);
      return response.body;
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

function isOutboxStatus(value: unknown): value is "pending" | "dispatched" | "failed" {
  return value === "pending" || value === "dispatched" || value === "failed";
}

async function tenantFromRequest(request: Request, auth?: PasswordAuthService): Promise<TenantContext> {
  const token = bearerToken(request.headers.get("authorization"));
  if (token && auth) {
    const session = await auth.verifyToken(token);
    return session.context;
  }
  return {
    tenantId: request.headers.get("x-tenant-id") ?? "default",
    userId: request.headers.get("x-user-id") ?? "system",
    roles: splitHeader(request.headers.get("x-roles")) ?? ["administrator"],
    permissions: splitHeader(request.headers.get("x-permissions")) ?? ["*"]
  };
}

function splitHeader(value: string | null): string[] | undefined {
  return value ? value.split(",").map((part) => part.trim()).filter(Boolean) : undefined;
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

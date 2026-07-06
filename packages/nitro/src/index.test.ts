import { H3, toWebHandler } from "h3";
import { describe, expect, it } from "vitest";
import { hashPassword, InMemoryApiTokenStore, InMemoryAuthAuditStore, InMemoryRoleStore, InMemoryUserStore, PasswordAuthService } from "@framekit/auth";
import { defineApp, defineDocType, defineModule } from "@framekit/core";
import { createRuntime, type RuntimeRealtimeEvent } from "@framekit/runtime";
import { createNitroHandler } from "./index.js";

describe("createNitroHandler", () => {
  it("emits telemetry hooks and applies the optional rate limiter", async () => {
    const runtime = createRuntime(defineApp({ name: "Ops", modules: [] }));
    const metrics: Array<{ statusCode: number; path: string }> = [];
    const logs: Array<{ statusCode: number; path: string; error?: unknown }> = [];
    const h3 = new H3();
    h3.all(
      "/**",
      createNitroHandler(runtime, {
        rateLimit: { windowMs: 60_000, max: 1 },
        metrics: {
          observeRequest: (event) => {
            metrics.push(event);
          }
        },
        logger: {
          info: (event) => {
            logs.push(event);
          },
          error: (event) => {
            logs.push(event);
          }
        }
      })
    );
    const fetch = toWebHandler(h3);

    const first = await fetch(new Request("http://localhost/health", { headers: { "x-forwarded-for": "203.0.113.10" } }));
    const second = await fetch(new Request("http://localhost/health", { headers: { "x-forwarded-for": "203.0.113.10" } }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(metrics.map((event) => event.statusCode)).toEqual([200, 429]);
    expect(logs.map((event) => event.path)).toEqual(["/health", "/health"]);
    expect(logs[1]?.error).toBeDefined();
  });

  it("reports dependency health checks", async () => {
    const runtime = createRuntime(defineApp({ name: "Health", modules: [] }));
    const h3 = new H3();
    h3.all(
      "/**",
      createNitroHandler(runtime, {
        healthChecks: {
          database: () => ({ ok: true }),
          queue: () => ({ ok: false, details: "unavailable" })
        }
      })
    );
    const fetch = toWebHandler(h3);

    const response = await fetch(new Request("http://localhost/health/dependencies"));
    const body = await response.json() as { ok: boolean; dependencies: Record<string, { ok: boolean }> };

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.dependencies).toMatchObject({
      database: { ok: true },
      queue: { ok: false }
    });
  });

  it("smokes auth, documents, admin APIs, customization, outbox, migrations, realtime, and OpenAPI", async () => {
    const customer = defineDocType({
      name: "customer",
      label: "Customer",
      fields: [
        { name: "name", label: "Name", type: "text", required: true, unique: true, inList: true },
        { name: "status", label: "Status", type: "select", options: ["active", "paused"], default: "active" }
      ],
      permissions: [
        { action: "create", permissions: ["crm.customer"] },
        { action: "read", permissions: ["crm.customer"] },
        { action: "update", permissions: ["crm.customer"] }
      ]
    });
    const appDefinition = defineApp({
      name: "Smoke",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [customer],
          permissions: ["crm.customer"]
        })
      ]
    });
    const events: RuntimeRealtimeEvent[] = [];
    const runtime = createRuntime(appDefinition, {
      idGenerator: () => crypto.randomUUID(),
      realtime: {
        publish: (event) => {
          events.push(event);
        },
        list: (channel) => events.filter((event) => event.channel === channel)
      }
    });
    const authAudit = new InMemoryAuthAuditStore();
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length",
      userStore: new InMemoryUserStore([
        {
          tenantId: "default",
          id: "admin",
          email: "admin@example.com",
          name: "Admin",
          passwordHash: await hashPassword("admin12345"),
          roles: ["administrator"],
          permissions: ["*"]
        }
      ]),
      roleStore: new InMemoryRoleStore([{ tenantId: "default", id: "administrator", name: "Administrator", permissions: ["*"] }]),
      apiTokenStore: new InMemoryApiTokenStore([]),
      audit: authAudit,
      providers: [
        {
          id: "test",
          authenticate: async ({ token, tenantId }) => {
            if (token !== "provider-token") {
              throw new Error("bad token");
            }
            return { providerId: "test", subject: "external-admin", tenantId, email: "admin@example.com" };
          }
        }
      ]
    });
    const h3 = new H3();
    h3.all("/**", createNitroHandler(runtime, { auth }));
    const fetch = toWebHandler(h3);

    const health = await fetch(new Request("http://localhost/health", { headers: { "x-request-id": "req-smoke" } }));
    expect(health.headers.get("x-request-id")).toBe("req-smoke");
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(health.headers.get("referrer-policy")).toBe("no-referrer");
    expect(health.headers.get("x-frame-options")).toBe("DENY");

    const login = await json<{ token: string }>(fetch, "/api/auth/login", {
      method: "POST",
      body: { email: "admin@example.com", password: "admin12345" }
    });
    const token = login.token;
    const initialHeaders = { authorization: `Bearer ${token}` };
    const refreshed = await json<{ token: string; sessionId: string }>(fetch, "/api/auth/refresh", {
      method: "POST",
      headers: initialHeaders
    });
    expect(refreshed.token).not.toBe(token);
    await expect(json(fetch, "/api/auth/me", { headers: initialHeaders })).rejects.toMatchObject({ code: "SESSION_REVOKED" });
    let headers = { authorization: `Bearer ${refreshed.token}` };

    const providerSession = await json<{ token: string; context: { userId: string } }>(fetch, "/api/auth/providers/test/login", {
      method: "POST",
      body: { token: "provider-token" }
    });
    expect(providerSession.context.userId).toBe("admin");

    const created = await json<{ id: string; data: { name: string } }>(fetch, "/api/doctypes/customer", {
      method: "POST",
      headers,
      body: { name: "Acme" }
    });
    expect(created).toMatchObject({ data: { name: "Acme" } });

    const filtered = await json<Array<{ id: string }>>(fetch, `/api/doctypes/customer?filters=${encodeURIComponent(JSON.stringify({ name: { contains: "cm" } }))}`, { headers });
    expect(filtered).toHaveLength(1);

    const projected = await json<Array<{ id: string; data: Record<string, unknown> }>>(fetch, "/api/doctypes/customer?sort=name:asc&fields=name&limit=1", { headers });
    expect(projected[0]?.data).toEqual({ name: "Acme" });
    const afterCursor = await json<Array<{ id: string }>>(fetch, `/api/doctypes/customer?sort=name:asc&cursor=${encodeURIComponent(projected[0]!.id)}`, { headers });
    expect(afterCursor).toHaveLength(0);

    await expect(
      json(fetch, "/api/doctypes/customer", {
        method: "POST",
        headers,
        body: { name: "Acme" }
      })
    ).rejects.toMatchObject({ code: "UNIQUE_CONSTRAINT_FAILED" });

    const role = await json(fetch, "/api/auth/roles", {
      method: "POST",
      headers,
      body: { id: "reader", name: "Reader", permissions: ["crm.customer"] }
    });
    expect(role).toMatchObject({ id: "reader" });

    await json(fetch, "/api/auth/users", {
      method: "POST",
      headers,
      body: {
        id: "worker",
        email: "worker@example.com",
        name: "Worker",
        password: "old password",
        roles: ["reader"],
        permissions: ["crm.customer"]
      }
    });
    await json(fetch, "/api/auth/users/worker/password", {
      method: "POST",
      headers,
      body: { newPassword: "new password" }
    });
    await expect(json(fetch, "/api/auth/login", { method: "POST", body: { email: "worker@example.com", password: "old password" } })).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    const workerLogin = await json<{ token: string }>(fetch, "/api/auth/login", {
      method: "POST",
      body: { email: "worker@example.com", password: "new password" }
    });
    const workerHeaders = { authorization: `Bearer ${workerLogin.token}` };
    await json(fetch, "/api/auth/password/change", {
      method: "POST",
      headers: workerHeaders,
      body: { currentPassword: "new password", newPassword: "newer password" }
    });
    await expect(json(fetch, "/api/auth/login", { method: "POST", body: { email: "worker@example.com", password: "new password" } })).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    await expect(json(fetch, "/api/auth/login", { method: "POST", body: { email: "worker@example.com", password: "newer password" } })).resolves.toMatchObject({ context: { userId: "worker" } });

    const apiToken = await json<{ token: string }>(fetch, "/api/auth/tokens", {
      method: "POST",
      headers,
      body: { id: "integration", name: "Integration", roles: ["reader"], permissions: [] }
    });
    expect(apiToken.token).toMatch(/^fkat_/);

    const customField = await json(fetch, "/api/custom-fields", {
      method: "POST",
      headers,
      body: { doctype: "customer", field: { name: "region", label: "Region", type: "text", inList: true } }
    });
    expect(customField).toMatchObject({ doctype: "customer", field: { name: "region" } });

    const outbox = await json<Array<{ type: string }>>(fetch, "/api/outbox", { headers });
    expect(outbox.some((event) => event.type === "customer.created")).toBe(true);

    const migration = await json<{ changes: Array<{ field: string }> }>(fetch, "/api/migrations/plan", {
      method: "POST",
      headers,
      body: {
        app: defineApp({
          name: "Smoke",
          modules: [
            defineModule({
              id: "crm",
              name: "CRM",
              doctypes: [
                defineDocType({
                  name: "customer",
                  label: "Customer",
                  fields: [
                    { name: "name", label: "Name", type: "text", required: true, unique: true },
                    { name: "status", label: "Status", type: "select", options: ["active", "paused"] },
                    { name: "tier", label: "Tier", type: "text" }
                  ]
                })
              ]
            })
          ]
        })
      }
    });
    expect(migration.changes).toMatchObject([{ field: "tier" }]);

    const realtime = await json<Array<{ type: string }>>(fetch, "/api/realtime/events", { headers });
    expect(realtime.some((event) => event.type === "customer.created")).toBe(true);

    const openapi = await json<{ paths: Record<string, unknown> }>(fetch, "/api/openapi.json", { headers });
    const authAuditEvents = await json<Array<{ action: string }>>(fetch, "/api/auth/audit", { headers });
    expect(authAuditEvents.map((event) => event.action)).toContain("provider_login.succeeded");
    expect(openapi.paths["/api/auth/refresh"]).toBeDefined();
    expect(openapi.paths["/api/auth/logout"]).toBeDefined();
    expect(openapi.paths["/api/auth/providers/{id}/login"]).toBeDefined();
    expect(openapi.paths["/api/auth/audit"]).toBeDefined();
    expect(openapi.paths["/api/auth/password/change"]).toBeDefined();
    expect(openapi.paths["/api/auth/users/{id}/password"]).toBeDefined();
    expect(openapi.paths["/api/auth/tokens"]).toBeDefined();

    await json(fetch, "/api/auth/logout", { method: "POST", headers });
    await expect(json(fetch, "/api/auth/me", { headers })).rejects.toMatchObject({ code: "SESSION_REVOKED" });
  });
});

async function json<T = unknown>(
  fetch: (request: Request) => Promise<Response>,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(
    new Request(`http://localhost${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "default",
        ...options.headers
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    })
  );
  const body = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    throw body;
  }
  return body as T;
}

import { H3, toWebHandler } from "h3";
import { describe, expect, it, vi } from "vitest";
import { hashPassword, InMemoryApiTokenStore, InMemoryAuthAuditStore, InMemoryRoleStore, InMemoryUserStore, PasswordAuthService } from "@framekit/auth";
import { defineApp, defineDocType, defineModule } from "@framekit/core";
import { createRuntime, migrationChecksum, type RealtimePublisher, type RuntimeRealtimeEvent } from "@framekit/runtime";
import { assertSecureProductionCredentials, createNitroHandler, createOpenTelemetryAdapters } from "./index.js";

describe("createNitroHandler", () => {
  it("exposes authorized atomic document commands without persistence details", async () => {
    const item = defineDocType({
      name: "command_item", label: "Command Item", fields: [{ name: "name", label: "Name", type: "text", required: true }],
      permissions: [{ action: "create", permissions: ["items.write"] }, { action: "read", permissions: ["items.read"] }]
    });
    const runtime = createRuntime(defineApp({ name: "Commands", modules: [defineModule({
      id: "commands", name: "Commands", doctypes: [item], commands: [{
        id: "create-items", label: "Create items", permission: "items.bulk", mode: "atomic",
        doctypes: [item.name], operations: ["create"], maxOperations: 5
      }]
    })] }));
    const h3 = new H3();
    h3.all("/**", createNitroHandler(runtime, { development: { allowHeaderIdentity: true } }));
    const fetch = toWebHandler(h3);
    const operations = [{ operation: "create", doctype: item.name, id: "item-1", data: { name: "First" } }];

    await expect(json(fetch, "/api/commands/create-items", {
      method: "POST", headers: { "x-permissions": "items.write" }, body: { operations }
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(json(fetch, "/api/commands/create-items", {
      method: "POST", headers: { "x-permissions": "items.write,items.bulk", "idempotency-key": "create-items-1" }, body: { operations }
    })).resolves.toMatchObject({ command: "create-items", mode: "atomic", replayed: false, documents: [{ id: "item-1" }] });
  });

  it("exposes submit and cancel document lifecycle commands", async () => {
    const invoice = defineDocType({
      name: "invoice",
      label: "Invoice",
      ownership: { transferPermissions: ["invoice.transfer"] },
      fields: [{ name: "number", label: "Number", type: "text", required: true }],
      permissions: [
        { action: "create", permissions: ["invoice.write"] },
        { action: "read", permissions: ["invoice.read"] },
        { action: "update", permissions: ["invoice.write"] },
        { action: "submit", permissions: ["invoice.submit"] },
        { action: "cancel", permissions: ["invoice.cancel"] }
      ]
    });
    const runtime = createRuntime(defineApp({
      name: "Lifecycle",
      modules: [defineModule({ id: "billing", name: "Billing", doctypes: [invoice] })]
    }), { idGenerator: () => "invoice-1" });
    const h3 = new H3();
    h3.all("/**", createNitroHandler(runtime, { development: { allowHeaderIdentity: true } }));
    const fetch = toWebHandler(h3);
    const headers = {
      "x-user-id": "accountant",
      "x-permissions": "invoice.write,invoice.read,invoice.submit,invoice.cancel,invoice.transfer"
    };

    const created = await json<{ id: string; revision: number; documentStatus: string }>(fetch, "/api/doctypes/invoice", {
      method: "POST", headers, body: { number: "INV-001" }
    });
    expect(created.documentStatus).toBe("draft");
    const submitted = await json<{ revision: number; documentStatus: string }>(fetch, `/api/doctypes/invoice/${created.id}/submit`, {
      method: "POST", headers: { ...headers, "if-match": String(created.revision) }
    });
    expect(submitted).toMatchObject({ revision: created.revision + 1, documentStatus: "submitted" });
    await expect(json(fetch, `/api/doctypes/invoice/${created.id}`, {
      method: "PATCH", headers, body: { number: "INV-002" }
    })).rejects.toMatchObject({ code: "DOCUMENT_NOT_DRAFT" });
    const cancelled = await json<{ revision: number; documentStatus: string }>(fetch, `/api/doctypes/invoice/${created.id}/cancel`, {
      method: "POST", headers: { ...headers, "if-match": String(submitted.revision) }
    });
    expect(cancelled).toMatchObject({ revision: submitted.revision + 1, documentStatus: "cancelled" });
    await expect(json(fetch, `/api/doctypes/invoice/${created.id}/owner`, {
      method: "POST", headers: { ...headers, "if-match": String(cancelled.revision) }, body: { ownerId: 123 }
    })).rejects.toMatchObject({ code: "INVALID_OWNER" });
    await expect(json(fetch, `/api/doctypes/invoice/${created.id}/owner`, {
      method: "POST", headers: { ...headers, "if-match": String(cancelled.revision) }, body: { ownerId: "   " }
    })).rejects.toMatchObject({ code: "INVALID_OWNER" });
    const transferred = await json<{ revision: number; ownerId: string }>(fetch, `/api/doctypes/invoice/${created.id}/owner`, {
      method: "POST", headers: { ...headers, "if-match": String(cancelled.revision) }, body: { ownerId: " reviewer " }
    });
    expect(transferred).toMatchObject({ revision: cancelled.revision + 1, ownerId: "reviewer" });
    expect(transferred).not.toHaveProperty("data");
    expect(transferred).not.toHaveProperty("documentStatus");
  });

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
    const second = await fetch(new Request("http://localhost/health", { headers: { "x-forwarded-for": "203.0.113.11" } }));

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

  it("separates liveness from bounded dependency readiness", async () => {
    const runtime = createRuntime(defineApp({ name: "Health", modules: [] }));
    let checks = 0;
    let observedAbort = false;
    const h3 = new H3();
    h3.all("/**", createNitroHandler(runtime, {
      healthCheckTimeoutMs: 20,
      healthChecks: {
        database: (signal) => new Promise((resolve) => {
          checks += 1;
          signal.addEventListener("abort", () => {
            observedAbort = true;
            resolve({ ok: false });
          }, { once: true });
        })
      }
    }));
    const fetch = toWebHandler(h3);

    expect((await fetch(new Request("http://localhost/health/live"))).status).toBe(200);
    expect(checks).toBe(0);
    const readiness = await fetch(new Request("http://localhost/health/ready"));
    const body = await readiness.json() as { dependencies: { database: { details: { code: string; timeoutMs: number } } } };
    expect(readiness.status).toBe(503);
    expect(observedAbort).toBe(true);
    expect(body.dependencies.database.details).toEqual({ code: "HEALTH_CHECK_TIMEOUT", timeoutMs: 20 });
  });

  it("adapts OpenTelemetry-compatible sinks and redacts secrets", async () => {
    const records: Array<{ attributes: Record<string, unknown> }> = [];
    const exceptions: unknown[] = [];
    const durations: number[] = [];
    const counts: number[] = [];
    const adapters = createOpenTelemetryAdapters({
      logger: { emit: (record) => records.push(record) },
      tracer: { startSpan: () => ({ recordException: (error) => exceptions.push(error), end: vi.fn() }) },
      meter: {
        createHistogram: () => ({ record: (value) => durations.push(value) }),
        createCounter: () => ({ add: (value) => counts.push(value) })
      }
    });
    const runtime = createRuntime(defineApp({ name: "Telemetry", modules: [] }));
    const h3 = new H3();
    h3.all("/**", createNitroHandler(runtime, {
      ...adapters,
      rateLimit: { allow: () => { throw new Error("Bearer top.secret.value eyJabc.def.ghi"); } }
    }));

    const response = await toWebHandler(h3)(new Request("http://localhost/health/live"));
    expect(response.status).toBe(500);
    expect(records).toHaveLength(1);
    expect(exceptions).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain("top.secret.value");
    expect(JSON.stringify(exceptions)).not.toContain("top.secret.value");
    expect(durations).toHaveLength(1);
    expect(counts).toEqual([1]);
  });

  it("executes browser-facing provider redirects and establishes the callback session cookie", async () => {
    const runtime = createRuntime(defineApp({ name: "OIDC browser", modules: [] }));
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length",
      identityLinkingPolicy: { mode: "email", autoLink: true },
      userStore: new InMemoryUserStore([{ tenantId: "default", id: "admin", email: "admin@example.com", name: "Admin",
        passwordHash: await hashPassword("password"), roles: [], permissions: [] }]),
      providers: [{
        id: "oidc",
        authenticate: async () => { throw new Error("code flow only"); },
        beginAuthorization: async () => ({ authorizationUrl: "https://issuer.example/authorize?state=browser-state" }),
        completeAuthorization: async ({ code, state }) => {
          expect({ code, state }).toEqual({ code: "browser-code", state: "browser-state" });
          return { identity: { providerId: "oidc", subject: "admin", tenantId: "default", email: "admin@example.com" }, returnTo: "/desk" };
        }
      }]
    });
    const h3 = new H3();
    h3.all("/**", createNitroHandler(runtime, { auth, authCookie: { name: "fk_session", secure: false } }));
    const fetch = toWebHandler(h3);

    const authorize = await fetch(new Request("http://localhost/api/auth/providers/oidc/authorize?returnTo=%2Fdesk", { headers: { "x-tenant-id": "default" } }));
    expect(authorize.status).toBe(302);
    expect(authorize.headers.get("location")).toBe("https://issuer.example/authorize?state=browser-state");
    const callback = await fetch(new Request("http://localhost/api/auth/providers/oidc/callback?code=browser-code&state=browser-state"));
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe("/desk");
    expect(callback.headers.get("set-cookie")).toContain("fk_session=");
  });

  it("supports cookie-backed signed sessions while preserving bearer auth", async () => {
    const runtime = createRuntime(defineApp({ name: "Cookie Auth", modules: [] }));
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
      ])
    });
    const h3 = new H3();
    h3.all("/**", createNitroHandler(runtime, { auth, authCookie: { name: "fk_session", secure: false } }));
    const fetch = toWebHandler(h3);

    const login = await fetch(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "default", origin: "http://localhost" },
      body: JSON.stringify({ email: "admin@example.com", password: "admin12345" })
    }));
    const cookie = login.headers.getSetCookie()[0];
    const loginBody = await login.json() as { token: string };
    expect(cookie).toBeDefined();
    expect(cookie).toContain("fk_session=");

    const cookieHeaders = { cookie: cookie!.split(";")[0]!, origin: "http://localhost" };
    const me = await json<{ context: { userId: string } }>(fetch, "/api/auth/me", { headers: cookieHeaders });
    expect(me.context.userId).toBe("admin");
    await expect(json(fetch, "/api/auth/me", { headers: { authorization: `Bearer ${loginBody.token}` } })).resolves.toMatchObject({ context: { userId: "admin" } });

    const refresh = await fetch(new Request("http://localhost/api/auth/refresh", { method: "POST", headers: cookieHeaders }));
    const refreshedCookie = refresh.headers.getSetCookie()[0];
    expect(refreshedCookie).toBeDefined();
    expect(refreshedCookie).toContain("fk_session=");
    expect(refreshedCookie).not.toBe(cookie);

    const logout = await fetch(new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { cookie: refreshedCookie!.split(";")[0]!, origin: "http://localhost" }
    }));
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie()[0]).toContain("Max-Age=0");
  });

  it("applies credentialed CORS only to allowlisted origins", async () => {
    const runtime = createRuntime(defineApp({ name: "CORS", modules: [] }));
    const h3 = new H3();
    h3.all("/**", createNitroHandler(runtime, {
      cors: { origins: ["https://desk.example.test"], credentials: true }
    }));
    const fetch = toWebHandler(h3);

    const allowed = await fetch(new Request("http://internal/health", {
      method: "OPTIONS",
      headers: {
        origin: "https://desk.example.test",
        "access-control-request-method": "GET"
      }
    }));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://desk.example.test");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    expect(allowed.headers.get("access-control-expose-headers")).toBe("x-next-cursor,x-request-id");
    expect(allowed.headers.get("vary")).toContain("Origin");

    const denied = await fetch(new Request("http://internal/health", {
      method: "OPTIONS",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "GET"
      }
    }));
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ code: "CORS_ORIGIN_DENIED" });
    const deniedActual = await fetch(new Request("http://internal/health", {
      headers: { origin: "https://attacker.example" }
    }));
    expect(deniedActual.status).toBe(403);
    expect(deniedActual.headers.get("access-control-expose-headers")).toBeNull();
    await expect(deniedActual.json()).resolves.toMatchObject({ code: "CORS_ORIGIN_DENIED" });

    const noCorsH3 = new H3();
    noCorsH3.all("/**", createNitroHandler(runtime));
    const noCors = await toWebHandler(noCorsH3)(new Request("http://internal/health", {
      headers: { origin: "https://desk.example.test" }
    }));
    expect(noCors.headers.get("access-control-allow-origin")).toBeNull();
    expect(noCors.headers.get("access-control-expose-headers")).toBeNull();
    expect(() => createNitroHandler(runtime, { cors: { origins: ["*"], credentials: true } })).toThrow(
      "Credentialed CORS cannot use the wildcard origin"
    );
  });

  it("rejects login CSRF before password, provider, or refresh cookies are issued", async () => {
    const runtime = createRuntime(defineApp({ name: "Login CSRF", modules: [] }));
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length",
      userStore: new InMemoryUserStore([{
        tenantId: "default",
        id: "admin",
        email: "admin@example.com",
        name: "Admin",
        passwordHash: await hashPassword("admin-password"),
        roles: ["administrator"],
        permissions: ["*"]
      }]),
      identityLinkingPolicy: { mode: "email", autoLink: true },
      providers: [{
        id: "test",
        authenticate: async ({ tenantId }) => ({
          providerId: "test",
          subject: "admin-provider",
          tenantId,
          email: "admin@example.com"
        })
      }]
    });
    const h3 = new H3();
    h3.all("/**", createNitroHandler(runtime, {
      auth,
      cors: { origins: ["https://desk.example.test"], credentials: true }
    }));
    const fetch = toWebHandler(h3);
    const formHeaders = (origin: string) => ({
      "content-type": "application/x-www-form-urlencoded",
      origin
    });

    const missingOrigin = await fetch(new Request("http://internal/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "admin@example.com", password: "admin-password" })
    }));
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.headers.getSetCookie()).toEqual([]);
    await expect(missingOrigin.json()).resolves.toMatchObject({ code: "CSRF_ORIGIN_REQUIRED" });

    const attackerPassword = await fetch(new Request("http://internal/api/auth/login", {
      method: "POST",
      headers: formHeaders("https://attacker.example"),
      body: new URLSearchParams({ email: "admin@example.com", password: "admin-password" })
    }));
    expect(attackerPassword.status).toBe(403);
    expect(attackerPassword.headers.getSetCookie()).toEqual([]);

    const attackerProvider = await fetch(new Request("http://internal/api/auth/providers/test/login", {
      method: "POST",
      headers: formHeaders("https://attacker.example"),
      body: new URLSearchParams({ token: "provider-token" })
    }));
    expect(attackerProvider.status).toBe(403);
    expect(attackerProvider.headers.getSetCookie()).toEqual([]);

    const allowedPassword = await fetch(new Request("http://internal/api/auth/login", {
      method: "POST",
      headers: formHeaders("https://desk.example.test"),
      body: new URLSearchParams({ email: "admin@example.com", password: "admin-password" })
    }));
    expect(allowedPassword.status).toBe(200);
    expect(allowedPassword.headers.getSetCookie()[0]).toContain("framekit_session=");

    const allowedProvider = await fetch(new Request("http://internal/api/auth/providers/test/login", {
      method: "POST",
      headers: formHeaders("https://desk.example.test"),
      body: new URLSearchParams({ token: "provider-token" })
    }));
    expect(allowedProvider.status).toBe(200);
    expect(allowedProvider.headers.getSetCookie()[0]).toContain("framekit_session=");

    const cookie = allowedPassword.headers.getSetCookie()[0]!.split(";")[0]!;
    const attackerRefresh = await fetch(new Request("http://internal/api/auth/refresh", {
      method: "POST",
      headers: { ...formHeaders("https://attacker.example"), cookie },
      body: new URLSearchParams()
    }));
    expect(attackerRefresh.status).toBe(403);
    expect(attackerRefresh.headers.getSetCookie()).toEqual([]);

    const allowedRefresh = await fetch(new Request("http://internal/api/auth/refresh", {
      method: "POST",
      headers: { ...formHeaders("https://desk.example.test"), cookie },
      body: new URLSearchParams()
    }));
    expect(allowedRefresh.status).toBe(200);
    expect(allowedRefresh.headers.getSetCookie()[0]).toContain("framekit_session=");
  });

  it("enforces cookie CSRF origins and trusts proxy origin headers only when configured", async () => {
    const runtime = createRuntime(defineApp({ name: "CSRF", modules: [] }));
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length",
      userStore: new InMemoryUserStore([{
        tenantId: "default",
        id: "admin",
        email: "admin@example.com",
        name: "Admin",
        passwordHash: await hashPassword("admin-password"),
        roles: ["administrator"],
        permissions: ["*"]
      }])
    });
    const h3 = new H3();
    h3.all("/**", createNitroHandler(runtime, { auth }));
    const fetch = toWebHandler(h3);
    const login = await fetch(new Request("http://internal/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://internal" },
      body: JSON.stringify({ email: "admin@example.com", password: "admin-password" })
    }));
    const cookie = login.headers.getSetCookie()[0]!.split(";")[0]!;

    const missingOrigin = await fetch(new Request("http://internal/api/auth/logout", {
      method: "POST",
      headers: { cookie }
    }));
    expect(missingOrigin.status).toBe(403);
    await expect(missingOrigin.json()).resolves.toMatchObject({ code: "CSRF_ORIGIN_REQUIRED" });

    const spoofedProxy = await fetch(new Request("http://internal/api/auth/logout", {
      method: "POST",
      headers: {
        cookie,
        origin: "https://app.example.test",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "app.example.test"
      }
    }));
    expect(spoofedProxy.status).toBe(403);
    await expect(spoofedProxy.json()).resolves.toMatchObject({ code: "CSRF_ORIGIN_DENIED" });

    const proxyH3 = new H3();
    proxyH3.all("/**", createNitroHandler(runtime, { auth, security: { trustProxy: true } }));
    const trustedProxy = await toWebHandler(proxyH3)(new Request("http://internal/api/auth/logout", {
      method: "POST",
      headers: {
        cookie,
        origin: "https://app.example.test",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "app.example.test"
      }
    }));
    expect(trustedProxy.status).toBe(204);
  });

  it("uses production cookie and credential safeguards while keeping development explicit", async () => {
    const runtime = createRuntime(defineApp({ name: "Production", modules: [] }));
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length",
      userStore: new InMemoryUserStore([{
        tenantId: "default",
        id: "admin",
        email: "ops@company.test",
        name: "Admin",
        passwordHash: await hashPassword("production-test-password"),
        roles: ["administrator"],
        permissions: ["*"]
      }])
    });
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => createNitroHandler(runtime, { authCookie: { secure: false } })).toThrow(
        "Session cookies must use Secure"
      );
      expect(() => createNitroHandler(runtime, { authCookie: { sameSite: "none", secure: false } })).toThrow(
        "Session cookies must use Secure"
      );
      expect(() => createNitroHandler(runtime)).not.toThrow();

      expect(() => assertSecureProductionCredentials({ authSecret: "development-secret-change-me" })).toThrow("FRAMEKIT_AUTH_SECRET");
      expect(() => assertSecureProductionCredentials({
        authSecret: "C8oY!6nq2Wz7Lk4pR9sV5xB3mJ1hT0uF",
        bootstrap: { email: "admin@example.com", password: "A strong bootstrap passphrase" }
      })).toThrow("bootstrap email");
      expect(() => assertSecureProductionCredentials({
        authSecret: "C8oY!6nq2Wz7Lk4pR9sV5xB3mJ1hT0uF",
        bootstrap: { email: "ops@company.test", password: "A strong bootstrap passphrase" }
      })).not.toThrow();

      expect(() => createNitroHandler(runtime, {
        cors: { origins: ["http://desk.example.test"], credentials: true }
      })).toThrow("cors.origins must use HTTPS");

      const productionH3 = new H3();
      productionH3.all("/**", createNitroHandler(runtime, { auth }));
      const response = await toWebHandler(productionH3)(new Request("https://app.example.test/health"));
      expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
      expect(response.headers.get("permissions-policy")).toContain("camera=()");
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-site");
      const login = await toWebHandler(productionH3)(new Request("https://app.example.test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example.test" },
        body: JSON.stringify({ email: "ops@company.test", password: "production-test-password" })
      }));
      expect(login.headers.getSetCookie()[0]).toContain("Secure");
    } finally {
      vi.unstubAllEnvs();
    }

    expect(() => assertSecureProductionCredentials({
      environment: "development",
      authSecret: "development-secret-change-me",
      bootstrap: { email: "admin@example.com", password: "admin12345" }
    })).not.toThrow();
  });

  it("requires authenticated identity, ignores forged identity headers, and enforces operations permissions", async () => {
    const record = defineDocType({
      name: "record",
      label: "Record",
      fields: [{ name: "title", label: "Title", type: "text", required: true }],
      permissions: [{ action: "read", permissions: ["records.read"] }]
    });
    const app = defineApp({
      name: "Secure",
      modules: [defineModule({ id: "records", name: "Records", doctypes: [record] })]
    });
    const realtimeHistory: RuntimeRealtimeEvent[] = [{
      channel: "tenant:default:documents",
      type: "record.updated",
      payload: { doctype: "record", document: { title: "Realtime payload" } }
    }];
    const realtimeListeners = new Map<string, Set<(event: RuntimeRealtimeEvent) => void>>();
    const runtime = createRuntime(app, {
      realtime: {
        publish(event) {
          realtimeHistory.push(event);
          for (const listener of realtimeListeners.get(event.channel) ?? []) {
            listener(event);
          }
        },
        list(channel) {
          return realtimeHistory.filter((event) => event.channel === channel);
        },
        subscribe(channel, listener) {
          const listeners = realtimeListeners.get(channel) ?? new Set<(event: RuntimeRealtimeEvent) => void>();
          listeners.add(listener);
          realtimeListeners.set(channel, listeners);
          return () => listeners.delete(listener);
        }
      }
    });
    await runtime.create(
      { tenantId: "other", userId: "seed", roles: [], permissions: ["*"] },
      "record",
      { title: "Other tenant secret" }
    );
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length",
      userStore: new InMemoryUserStore([
        {
          tenantId: "default",
          id: "reader",
          email: "reader@example.com",
          name: "Reader",
          passwordHash: await hashPassword("reader-password"),
          roles: ["reader"],
          permissions: ["records.read"]
        },
        {
          tenantId: "default",
          id: "realtime-reader",
          email: "realtime@example.com",
          name: "Realtime Reader",
          passwordHash: await hashPassword("realtime-password"),
          roles: ["realtime-reader"],
          permissions: ["framekit.realtime.read"]
        }
      ])
    });
    const h3 = new H3();
    h3.all("/**", createNitroHandler(runtime, { auth }));
    const fetch = toWebHandler(h3);

    for (const path of ["/health", "/health/dependencies", "/api/openapi.json"]) {
      expect((await fetch(new Request(`http://localhost${path}`))).status).toBe(200);
    }

    const protectedPaths = [
      "/api/meta",
      "/api/diagnostics",
      "/api/migrations",
      "/api/realtime/events",
      "/api/realtime/stream",
      "/api/audit",
      "/api/outbox",
      "/api/custom-fields",
      "/api/views",
      "/api/doctypes/record",
      "/api/auth/users"
    ];
    const forgedIdentity = {
      "x-tenant-id": "other",
      "x-user-id": "forged-admin",
      "x-roles": "administrator",
      "x-permissions": "*"
    };
    for (const path of protectedPaths) {
      const response = await fetch(new Request(`http://localhost${path}`, { headers: forgedIdentity }));
      expect(response.status, path).toBe(401);
      await expect(response.json(), path).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
    }

    const login = await json<{ token: string }>(fetch, "/api/auth/login", {
      method: "POST",
      body: { email: "reader@example.com", password: "reader-password" }
    });
    const forgedAuthenticatedHeaders = {
      authorization: `Bearer ${login.token}`,
      ...forgedIdentity
    };
    const records = await json<Array<{ data: { title: string } }>>(fetch, "/api/doctypes/record", {
      headers: forgedAuthenticatedHeaders
    });
    expect(records).toEqual([]);
    await expect(json(fetch, "/api/auth/users", { headers: forgedAuthenticatedHeaders })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const operationRequests: Array<[string, string, unknown?]> = [
      ["GET", "/api/diagnostics"],
      ["GET", "/api/migrations"],
      ["GET", "/api/realtime/events"],
      ["GET", "/api/realtime/stream"],
      ["POST", "/api/migrations/plan", { app }],
      ["POST", "/api/migrations/apply", { plan: {} }],
      ["GET", "/api/audit"],
      ["GET", "/api/outbox"],
      ["POST", "/api/outbox/forged/dispatch"],
      ["GET", "/api/custom-fields"],
      ["POST", "/api/custom-fields", { doctype: "record", field: { name: "note", label: "Note", type: "text" } }],
      ["GET", "/api/views"],
      ["POST", "/api/views", { doctype: "record", type: "list", fields: ["title"] }]
    ];
    for (const [method, path, body] of operationRequests) {
      await expect(json(fetch, path, {
        method,
        headers: forgedAuthenticatedHeaders,
        body
      }), `${method} ${path}`).rejects.toMatchObject({ code: "FORBIDDEN" });
    }

    const realtimeLogin = await json<{ token: string }>(fetch, "/api/auth/login", {
      method: "POST",
      body: { email: "realtime@example.com", password: "realtime-password" }
    });
    const realtimeHeaders = { authorization: `Bearer ${realtimeLogin.token}` };
    const history = await json<RuntimeRealtimeEvent[]>(fetch, "/api/realtime/events", { headers: realtimeHeaders });
    expect(history).toEqual([expect.objectContaining({ type: "record.updated" })]);

    const streamResponse = await fetch(new Request("http://localhost/api/realtime/stream", { headers: realtimeHeaders }));
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");
    const streamReader = streamResponse.body?.getReader();
    expect(streamReader).toBeDefined();
    const firstChunk = await streamReader!.read();
    expect(new TextDecoder().decode(firstChunk.value)).toContain("retry: 3000");
    for (const listener of realtimeListeners.get("tenant:default:documents") ?? []) {
      listener(realtimeHistory[0]!);
    }
    const eventChunk = await streamReader!.read();
    expect(new TextDecoder().decode(eventChunk.value)).toContain("Realtime payload");
    await streamReader!.cancel();
  });

  it("allows header identity only through the explicit non-production development escape hatch", async () => {
    const runtime = createRuntime(defineApp({ name: "Development", modules: [] }));
    const secureH3 = new H3();
    secureH3.all("/**", createNitroHandler(runtime));
    const secureResponse = await toWebHandler(secureH3)(new Request("http://localhost/api/meta", {
      headers: { "x-user-id": "developer", "x-permissions": "*" }
    }));
    expect(secureResponse.status).toBe(501);

    const developmentH3 = new H3();
    developmentH3.all("/**", createNitroHandler(runtime, { development: { allowHeaderIdentity: true } }));
    const developmentResponse = await toWebHandler(developmentH3)(new Request("http://localhost/api/meta", {
      headers: { "x-user-id": "developer", "x-permissions": "*" }
    }));
    expect(developmentResponse.status).toBe(200);

    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => createNitroHandler(runtime, { development: { allowHeaderIdentity: true } })).toThrow(
        "development.allowHeaderIdentity requires NODE_ENV=development or NODE_ENV=test"
      );
    } finally {
      vi.unstubAllEnvs();
    }
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
      identityLinkingPolicy: { mode: "email", autoLink: true },
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
    await json(fetch, "/api/doctypes/customer", { method: "POST", headers, body: { name: "Beta" } });

    const filtered = await json<Array<{ id: string }>>(fetch, `/api/doctypes/customer?filters=${encodeURIComponent(JSON.stringify({ name: { contains: "cm" } }))}`, { headers });
    expect(filtered).toHaveLength(1);
    await expect(json(fetch, `/api/doctypes/customer?filters=${encodeURIComponent(JSON.stringify({ name: { contains: 42 } }))}`, { headers }))
      .rejects.toMatchObject({ code: "INVALID_QUERY" });

    const forgedCursor = btoa(JSON.stringify({ v: 1, field: "name", direction: "asc", value: 42, id: created.id }))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    await expect(json(fetch, `/api/doctypes/customer?sort=name:asc&cursor=${encodeURIComponent(forgedCursor)}`, { headers }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });

    const projectedResponse = await fetch(new Request("http://localhost/api/doctypes/customer?sort=name:asc&fields=name&limit=1", { headers }));
    const projected = await projectedResponse.json() as Array<{ id: string; data: Record<string, unknown> }>;
    expect(projected[0]?.data).toEqual({ name: "Acme" });
    const cursor = projectedResponse.headers.get("x-next-cursor");
    expect(cursor).toBeTruthy();
    const afterCursor = await json<Array<{ id: string }>>(fetch, `/api/doctypes/customer?sort=name:asc&cursor=${encodeURIComponent(cursor!)}`, { headers });
    expect(afterCursor).toHaveLength(1);

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

    const migration = await json<{ id: string; checksum: string; changes: Array<{ field: string }> }>(fetch, "/api/migrations/plan", {
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
    const destructive = await json<Awaited<ReturnType<typeof runtime.planMigration>>>(fetch, "/api/migrations/plan", {
      method: "POST",
      headers,
      body: {
        app: defineApp({
          name: "Smoke",
          modules: [defineModule({ id: "crm", name: "CRM", doctypes: [defineDocType({
            name: "customer",
            label: "Customer",
            fields: [{ name: "name", label: "Name", type: "text", required: true, unique: true }]
          })] })]
        })
      }
    });
    await expect(json(fetch, "/api/migrations/apply", { method: "POST", headers, body: { plan: destructive } }))
      .rejects.toMatchObject({ code: "DESTRUCTIVE_MIGRATION" });
    const forgedChanges = destructive.changes.map((change) => change.kind === "remove_field" ? { ...change, destructive: false } : change);
    const forged = { ...destructive, changes: forgedChanges };
    const signedForgery = { ...forged, checksum: await migrationChecksum(forged as never) };
    await expect(json(fetch, "/api/migrations/apply", { method: "POST", headers, body: { plan: signedForgery, allowDestructive: true } }))
      .rejects.toMatchObject({ code: "INVALID_MIGRATION_PLAN" });
    const appliedMigration = await json<{ id: string; checksum: string }>(fetch, "/api/migrations/apply", {
      method: "POST",
      headers,
      body: { plan: migration }
    });
    expect(appliedMigration).toMatchObject({ id: migration.id, checksum: migration.checksum });
    await expect(json<Array<{ id: string }>>(fetch, "/api/migrations", { headers })).resolves.toEqual([
      expect.objectContaining({ id: migration.id })
    ]);

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

  it("replays fresh and reconnecting SSE streams monotonically across the LISTEN handoff with bounded cursor state", async () => {
    const channel = "tenant:default:documents";
    const history = Array.from({ length: 1_500 }, (_, index): RuntimeRealtimeEvent => ({
      cursor: String(index + 1), channel, type: "record.updated", payload: { index: index + 1 }
    }));
    const listeners = new Set<(event: RuntimeRealtimeEvent) => void>();
    const readiness = deferred<void>();
    let cleanups = 0;
    const realtime: RealtimePublisher = {
      publish: () => undefined,
      list: (_channel, options = {}) => history
        .filter((event) => !options.after || BigInt(event.cursor!) > BigInt(options.after))
        .sort((left, right) => Number(BigInt(left.cursor!) - BigInt(right.cursor!)))
        .slice(0, options.limit ?? 100),
      async subscribe(_channel, listener) {
        listeners.add(listener);
        await readiness.promise;
        return () => {
          cleanups += 1;
          listeners.delete(listener);
        };
      }
    };
    const fetch = realtimeFetch(realtime);
    const fresh = await fetch(new Request("http://localhost/api/realtime/stream", { headers: realtimeHeaders }));
    const duringHandshake: RuntimeRealtimeEvent = { cursor: "1501", channel, type: "record.updated", payload: { index: 1501 } };
    history.push(duringHandshake);
    for (const listener of listeners) listener(duringHandshake);
    readiness.resolve();

    expect(await readSseIds(fresh, 1_501)).toEqual(Array.from({ length: 1_501 }, (_, index) => String(index + 1)));
    expect(cleanups).toBe(1);

    const reconnect = await fetch(new Request("http://localhost/api/realtime/stream", {
      headers: { ...realtimeHeaders, "last-event-id": "1499" }
    }));
    expect(await readSseIds(reconnect, 2)).toEqual(["1500", "1501"]);
    expect(cleanups).toBe(2);
  });

  it("cleans realtime subscriptions when replay fails or the stream is cancelled during readiness", async () => {
    let replayCleanup = 0;
    const failingFetch = realtimeFetch({
      publish: () => undefined,
      list: () => { throw new Error("replay unavailable"); },
      subscribe: () => () => { replayCleanup += 1; }
    });
    const failed = await failingFetch(new Request("http://localhost/api/realtime/stream", { headers: realtimeHeaders }));
    const failedReader = failed.body!.getReader();
    await failedReader.read();
    await expect(failedReader.read()).rejects.toThrow("replay unavailable");
    expect(replayCleanup).toBe(1);

    const readiness = deferred<void>();
    let earlyCleanup = 0;
    const waitingFetch = realtimeFetch({
      publish: () => undefined,
      list: () => [],
      async subscribe() {
        await readiness.promise;
        return () => { earlyCleanup += 1; };
      }
    });
    const waiting = await waitingFetch(new Request("http://localhost/api/realtime/stream", { headers: realtimeHeaders }));
    const cancellation = waiting.body!.cancel();
    readiness.resolve();
    await cancellation;
    await vi.waitFor(() => expect(earlyCleanup).toBe(1));
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
        origin: "http://localhost",
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

const realtimeHeaders = {
  "x-tenant-id": "default",
  "x-user-id": "realtime-test",
  "x-permissions": "framekit.realtime.read"
};

function realtimeFetch(realtime: RealtimePublisher) {
  const runtime = createRuntime(defineApp({ name: "Realtime Test", modules: [] }), { realtime });
  const h3 = new H3();
  h3.all("/**", createNitroHandler(runtime, { development: { allowHeaderIdentity: true } }));
  return toWebHandler(h3);
}

async function readSseIds(response: Response, count: number): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const ids: string[] = [];
  let buffer = "";
  while (ids.length < count) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const id = chunk.split("\n").find((line) => line.startsWith("id: "))?.slice(4);
      if (id) ids.push(id);
    }
  }
  await reader.cancel();
  return ids;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

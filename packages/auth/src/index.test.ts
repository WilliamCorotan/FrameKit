import { describe, expect, it } from "vitest";
import {
  createOidcProvider,
  hashPassword,
  InMemoryApiTokenStore,
  InMemoryAuthAuditStore,
  InMemoryAuthIdentityLinkStore,
  InMemoryRoleStore,
  InMemoryUserStore,
  PasswordAuthService
} from "./index.js";

describe("PasswordAuthService", () => {
  it("logs in and verifies signed sessions", async () => {
    const store = new InMemoryUserStore([
      {
        id: "u1",
        tenantId: "t1",
        email: "admin@example.com",
        name: "Admin",
        passwordHash: await hashPassword("correct horse battery staple"),
        roles: ["administrator"],
        permissions: ["*"]
      }
    ]);
    const auth = new PasswordAuthService({ secret: "test-secret-with-enough-length", userStore: store });

    const session = await auth.login("ADMIN@example.com", "correct horse battery staple", "t1");
    const verified = await auth.verifyToken(session.token);

    expect(verified.context).toMatchObject({ tenantId: "t1", userId: "u1" });
    expect(verified.user.email).toBe("admin@example.com");
  });

  it("scopes password login by tenant", async () => {
    const store = new InMemoryUserStore([
      {
        id: "u1",
        tenantId: "t1",
        email: "admin@example.com",
        name: "Tenant One",
        passwordHash: await hashPassword("one"),
        roles: ["administrator"],
        permissions: ["*"]
      },
      {
        id: "u2",
        tenantId: "t2",
        email: "admin@example.com",
        name: "Tenant Two",
        passwordHash: await hashPassword("two"),
        roles: ["administrator"],
        permissions: ["*"]
      }
    ]);
    const auth = new PasswordAuthService({ secret: "test-secret-with-enough-length", userStore: store });

    const session = await auth.login("admin@example.com", "two", "t2");

    expect(session.context).toMatchObject({ tenantId: "t2", userId: "u2" });
    await expect(auth.login("admin@example.com", "two", "t1")).rejects.toMatchObject({ code: "INVALID_LOGIN" });
  });

  it("rejects invalid credentials", async () => {
    const store = new InMemoryUserStore([]);
    const auth = new PasswordAuthService({ secret: "test-secret-with-enough-length", userStore: store });

    await expect(auth.login("nobody@example.com", "wrong")).rejects.toMatchObject({ code: "INVALID_LOGIN" });
  });

  it("rejects disabled users and existing sessions for disabled users", async () => {
    const store = new InMemoryUserStore([
      {
        id: "u1",
        tenantId: "t1",
        email: "admin@example.com",
        name: "Admin",
        passwordHash: await hashPassword("correct horse battery staple"),
        roles: ["administrator"],
        permissions: ["*"]
      }
    ]);
    const auth = new PasswordAuthService({ secret: "test-secret-with-enough-length", userStore: store });

    const session = await auth.login("admin@example.com", "correct horse battery staple", "t1");
    await store.upsert({
      ...(await store.findById("t1", "u1"))!,
      disabledAt: new Date().toISOString()
    });

    await expect(auth.login("admin@example.com", "correct horse battery staple", "t1")).rejects.toMatchObject({ code: "USER_DISABLED" });
    await expect(auth.verifyToken(session.token)).rejects.toMatchObject({ code: "USER_DISABLED" });
  });

  it("locks users after repeated failed password attempts and clears failures after success", async () => {
    const store = new InMemoryUserStore([
      {
        id: "u1",
        tenantId: "t1",
        email: "admin@example.com",
        name: "Admin",
        passwordHash: await hashPassword("correct horse battery staple"),
        roles: ["administrator"],
        permissions: ["*"]
      }
    ]);
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length",
      userStore: store,
      maxFailedLoginAttempts: 2,
      lockoutSeconds: 60
    });

    await expect(auth.login("admin@example.com", "wrong", "t1")).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    await expect(auth.login("admin@example.com", "wrong", "t1")).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    await expect(auth.login("admin@example.com", "correct horse battery staple", "t1")).rejects.toMatchObject({ code: "USER_LOCKED" });

    await store.upsert({
      ...(await store.findById("t1", "u1"))!,
      lockedUntil: "2020-01-01T00:00:00.000Z"
    });
    await expect(auth.login("admin@example.com", "correct horse battery staple", "t1")).resolves.toMatchObject({ context: { userId: "u1" } });
    await expect(store.findById("t1", "u1")).resolves.toMatchObject({ failedLoginAttempts: 0, lockedUntil: undefined });
  });

  it("refreshes sessions and revokes rotated tokens", async () => {
    const store = new InMemoryUserStore([
      {
        id: "u1",
        tenantId: "t1",
        email: "admin@example.com",
        name: "Admin",
        passwordHash: await hashPassword("correct horse battery staple"),
        roles: ["administrator"],
        permissions: ["*"]
      }
    ]);
    const auth = new PasswordAuthService({ secret: "test-secret-with-enough-length", userStore: store });

    const session = await auth.login("admin@example.com", "correct horse battery staple", "t1");
    const refreshed = await auth.refreshSession(session.token);

    expect(refreshed.sessionId).not.toBe(session.sessionId);
    await expect(auth.verifyToken(session.token)).rejects.toMatchObject({ code: "SESSION_REVOKED" });
    await expect(auth.verifyToken(refreshed.token)).resolves.toMatchObject({ sessionId: refreshed.sessionId });

    await auth.revokeSession(refreshed.token);
    await expect(auth.verifyToken(refreshed.token)).rejects.toMatchObject({ code: "SESSION_REVOKED" });
  });

  it("changes and resets user passwords", async () => {
    const store = new InMemoryUserStore([
      {
        id: "u1",
        tenantId: "t1",
        email: "admin@example.com",
        name: "Admin",
        passwordHash: await hashPassword("old password"),
        roles: ["administrator"],
        permissions: ["*"]
      }
    ]);
    const auth = new PasswordAuthService({ secret: "test-secret-with-enough-length", userStore: store });

    await auth.changePassword("t1", "u1", "old password", "new password");
    await expect(auth.login("admin@example.com", "old password", "t1")).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    await expect(auth.login("admin@example.com", "new password", "t1")).resolves.toMatchObject({ context: { userId: "u1" } });

    await auth.resetPassword("t1", "u1", "reset password");
    await expect(auth.login("admin@example.com", "new password", "t1")).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    await expect(auth.login("admin@example.com", "reset password", "t1")).resolves.toMatchObject({ context: { userId: "u1" } });
  });

  it("records auth audit events and supports external identity providers", async () => {
    const audit = new InMemoryAuthAuditStore();
    const store = new InMemoryUserStore([
      {
        id: "u1",
        tenantId: "t1",
        email: "admin@example.com",
        name: "Admin",
        passwordHash: await hashPassword("correct horse battery staple"),
        roles: ["administrator"],
        permissions: ["*"]
      }
    ]);
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length",
      userStore: store,
      audit,
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

    await expect(auth.login("admin@example.com", "wrong", "t1")).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    const session = await auth.loginWithProvider("test", "provider-token", "t1");
    await auth.refreshSession(session.token);
    const events = await auth.authAuditEvents("t1");

    expect(events.map((event) => event.action)).toEqual(expect.arrayContaining(["login.failed", "provider_login.succeeded", "session.refreshed"]));
    expect(events.find((event) => event.action === "provider_login.succeeded")).toMatchObject({ actorUserId: "u1", success: true });
  });

  it("requires explicit provider identity links when configured", async () => {
    const identityLinks = new InMemoryAuthIdentityLinkStore([]);
    const store = new InMemoryUserStore([
      {
        id: "u1",
        tenantId: "t1",
        email: "admin@example.com",
        name: "Admin",
        passwordHash: await hashPassword("correct horse battery staple"),
        roles: ["administrator"],
        permissions: ["*"]
      }
    ]);
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length",
      userStore: store,
      identityLinks,
      identityLinkingPolicy: { mode: "linked" },
      providers: [
        {
          id: "test",
          authenticate: async ({ tenantId }) => ({ providerId: "test", subject: "external-admin", tenantId, email: "admin@example.com" })
        }
      ]
    });

    await expect(auth.loginWithProvider("test", "provider-token", "t1")).rejects.toMatchObject({ code: "PROVIDER_USER_NOT_FOUND" });
    await auth.linkProviderIdentity({ tenantId: "t1", providerId: "test", subject: "external-admin", userId: "u1", email: "admin@example.com" });
    await expect(auth.loginWithProvider("test", "provider-token", "t1")).resolves.toMatchObject({ context: { userId: "u1" } });
  });

  it("can explicitly auto-link provider identities by matching email", async () => {
    const identityLinks = new InMemoryAuthIdentityLinkStore([]);
    const store = new InMemoryUserStore([
      {
        id: "u1",
        tenantId: "t1",
        email: "admin@example.com",
        name: "Admin",
        passwordHash: await hashPassword("correct horse battery staple"),
        roles: ["administrator"],
        permissions: ["*"]
      }
    ]);
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length",
      userStore: store,
      identityLinks,
      identityLinkingPolicy: { mode: "email", autoLink: true },
      providers: [
        {
          id: "test",
          authenticate: async ({ tenantId }) => ({ providerId: "test", subject: "external-admin", tenantId, email: "ADMIN@example.com" })
        }
      ]
    });

    const session = await auth.loginWithProvider("test", "provider-token", "t1");
    const link = await identityLinks.find("t1", "test", "external-admin");

    expect(session.context.userId).toBe("u1");
    expect(link).toMatchObject({ userId: "u1", email: "admin@example.com" });
  });

  it("authenticates OIDC identities through token introspection", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const provider = createOidcProvider({
      id: "oidc",
      issuer: "https://issuer.example",
      clientId: "framekit",
      introspectionEndpoint: "https://issuer.example/oauth/introspect",
      fetch: async (input, init) => {
        requests.push({ url: String(input), body: String(init?.body) });
        return new Response(JSON.stringify({
          active: true,
          iss: "https://issuer.example",
          aud: "framekit",
          sub: "subject-1",
          email: "admin@example.com",
          name: "Admin"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const store = new InMemoryUserStore([
      {
        id: "u1",
        tenantId: "t1",
        email: "admin@example.com",
        name: "Admin",
        passwordHash: await hashPassword("correct horse battery staple"),
        roles: ["administrator"],
        permissions: ["*"]
      }
    ]);
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length",
      userStore: store,
      providers: [provider]
    });

    const session = await auth.loginWithProvider("oidc", "access-token", "t1");

    expect(session.context.userId).toBe("u1");
    expect(requests).toEqual([{ url: "https://issuer.example/oauth/introspect", body: "token=access-token&client_id=framekit" }]);
  });

  it("manages tenant users and roles", async () => {
    const userStore = new InMemoryUserStore([]);
    const roleStore = new InMemoryRoleStore([]);
    const auth = new PasswordAuthService({ secret: "test-secret-with-enough-length", userStore, roleStore });

    await auth.upsertRole({ tenantId: "t1", id: "sales", name: "Sales", permissions: ["crm.customer.read"] });
    const user = await auth.upsertUser({
      tenantId: "t1",
      id: "u1",
      email: "owner@example.com",
      name: "Owner",
      password: "temporary",
      roles: ["sales"],
      permissions: ["crm.customer.read"]
    });

    expect(user).toMatchObject({ id: "u1", tenantId: "t1", roles: ["sales"] });
    await expect(auth.listRoles("t1")).resolves.toMatchObject([{ id: "sales", permissions: ["crm.customer.read"] }]);
    await expect(auth.listUsers("t1")).resolves.toHaveLength(1);
  });

  it("inherits permissions from assigned roles", async () => {
    const userStore = new InMemoryUserStore([
      {
        id: "u1",
        tenantId: "t1",
        email: "reader@example.com",
        name: "Reader",
        passwordHash: await hashPassword("reader-pass"),
        roles: ["sales"],
        permissions: []
      }
    ]);
    const roleStore = new InMemoryRoleStore([{ tenantId: "t1", id: "sales", name: "Sales", permissions: ["crm.customer.read"] }]);
    const auth = new PasswordAuthService({ secret: "test-secret-with-enough-length", userStore, roleStore });

    const session = await auth.login("reader@example.com", "reader-pass", "t1");

    expect(session.context.permissions).toEqual(["crm.customer.read"]);
  });

  it("creates, verifies, and revokes API tokens", async () => {
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length",
      userStore: new InMemoryUserStore([]),
      apiTokenStore: new InMemoryApiTokenStore([])
    });

    const created = await auth.createApiToken({
      tenantId: "t1",
      id: "integration",
      name: "Integration",
      roles: ["service"],
      permissions: ["crm.customer.read"]
    });
    const session = await auth.verifyBearerToken(created.token);

    expect("apiToken" in session).toBe(true);
    expect(session.context).toMatchObject({ tenantId: "t1", userId: "api-token:integration", permissions: ["crm.customer.read"] });
    await auth.revokeApiToken("t1", "integration");
    await expect(auth.verifyBearerToken(created.token)).rejects.toMatchObject({ code: "INVALID_API_TOKEN" });
  });

  it("rejects invalid and expired API token expirations", async () => {
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length",
      userStore: new InMemoryUserStore([]),
      apiTokenStore: new InMemoryApiTokenStore([])
    });

    await expect(
      auth.createApiToken({
        tenantId: "t1",
        name: "Invalid",
        roles: ["service"],
        permissions: ["crm.customer.read"],
        expiresAt: "not-a-date"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      auth.createApiToken({
        tenantId: "t1",
        name: "Expired",
        roles: ["service"],
        permissions: ["crm.customer.read"],
        expiresAt: "2020-01-01T00:00:00.000Z"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

import { describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  createOidcAuthorizationCodeProvider,
  createOidcProvider,
  hashPassword,
  InMemoryApiTokenStore,
  InMemoryAuthAuditStore,
  InMemoryAuthIdentityLinkStore,
  InMemoryAuthLifecycleTokenStore,
  InMemoryOidcAuthorizationStateStore,
  InMemoryRoleStore,
  InMemoryUserStore,
  PasswordAuthService
} from "./index.js";

describe("PasswordAuthService", () => {
  it("rejects weak or placeholder signing secrets in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => new PasswordAuthService({
        secret: "development-secret-change-me",
        userStore: new InMemoryUserStore([])
      })).toThrow("strong, non-default value");
      expect(() => new PasswordAuthService({
        secret: "C8oY!6nq2Wz7Lk4pR9sV5xB3mJ1hT0uF",
        userStore: new InMemoryUserStore([])
      })).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
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

  it("enforces tenant-safe identity collisions and audits the failed link", async () => {
    const audit = new InMemoryAuthAuditStore();
    const users = new InMemoryUserStore([
      { id: "u1", tenantId: "t1", email: "one@example.com", name: "One", passwordHash: await hashPassword("password one"), roles: [], permissions: [] },
      { id: "u2", tenantId: "t1", email: "two@example.com", name: "Two", passwordHash: await hashPassword("password two"), roles: [], permissions: [] }
    ]);
    const auth = new PasswordAuthService({ secret: "test-secret-with-enough-length", userStore: users, audit, identityLinks: new InMemoryAuthIdentityLinkStore([]) });
    await auth.linkProviderIdentity({ tenantId: "t1", providerId: "oidc", subject: "subject", userId: "u1" });
    await expect(auth.linkProviderIdentity({ tenantId: "t1", providerId: "oidc", subject: "subject", userId: "u2" }))
      .rejects.toMatchObject({ code: "PROVIDER_IDENTITY_COLLISION" });
    expect(await auth.authAuditEvents("t1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "provider_identity.link_failed", success: false, details: expect.objectContaining({ reason: "subject_collision" }) })
    ]));
  });

  it("issues expiring single-use invitations and password recovery tokens", async () => {
    const audit = new InMemoryAuthAuditStore();
    const users = new InMemoryUserStore([]);
    const delivered: string[] = [];
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length", userStore: users, audit, lifecycleTokens: new InMemoryAuthLifecycleTokenStore([]),
      lifecycleDelivery: ({ token }) => { delivered.push(token); }
    });
    const invitation = await auth.createInvitation({ tenantId: "t1", email: "invitee@example.com", name: "Invitee", roles: ["member"], permissions: ["notes.read"] });
    await expect(auth.acceptInvitation({ tenantId: "t1", token: invitation.token, password: "invited password" })).resolves.toMatchObject({ context: { tenantId: "t1" } });
    await expect(auth.acceptInvitation({ tenantId: "t1", token: invitation.token, password: "replay password" })).rejects.toMatchObject({ code: "INVALID_LIFECYCLE_TOKEN" });

    const reset = await auth.requestPasswordReset("t1", "invitee@example.com");
    expect(reset.token).toBeTruthy();
    expect(delivered).toEqual([reset.token]);
    await auth.completePasswordRecovery({ tenantId: "t1", token: reset.token!, newPassword: "recovered password" });
    await expect(auth.completePasswordRecovery({ tenantId: "t1", token: reset.token!, newPassword: "replayed password" })).rejects.toMatchObject({ code: "INVALID_LIFECYCLE_TOKEN" });
    await expect(auth.login("invitee@example.com", "recovered password", "t1")).resolves.toMatchObject({ context: { tenantId: "t1" } });
    expect((await auth.authAuditEvents("t1")).map((event) => event.action)).toEqual(expect.arrayContaining([
      "invitation.created", "invitation.accepted", "invitation.failed", "password_reset.requested", "password_reset.completed", "password_reset.failed"
    ]));

    const expiring = new PasswordAuthService({ secret: "test-secret-with-enough-length", userStore: new InMemoryUserStore([]),
      lifecycleTokens: new InMemoryAuthLifecycleTokenStore([]), invitationTtlSeconds: -1 });
    const expired = await expiring.createInvitation({ tenantId: "t1", email: "expired@example.com", name: "Expired", roles: [], permissions: [] });
    await expect(expiring.acceptInvitation({ tenantId: "t1", token: expired.token, password: "password" })).rejects.toMatchObject({ code: "INVALID_LIFECYCLE_TOKEN" });

    const disabled = new PasswordAuthService({ secret: "test-secret-with-enough-length", userStore: new InMemoryUserStore([{
      id: "disabled", tenantId: "t1", email: "disabled@example.com", name: "Disabled", passwordHash: await hashPassword("password"),
      roles: [], permissions: [], disabledAt: new Date().toISOString()
    }]), lifecycleTokens: new InMemoryAuthLifecycleTokenStore([]) });
    await expect(disabled.requestPasswordReset("t1", "disabled@example.com")).resolves.toEqual({});
    await expect(disabled.createRecoveryToken("t1", "disabled")).rejects.toMatchObject({ code: "USER_DISABLED" });
  });

  it("runs signed OIDC authorization code with discovery, PKCE, nonce, state, and replay protection", async () => {
    const issuer = "https://issuer.example";
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", use: "sig", alg: "RS256" };
    let nonce = "";
    let expectedChallenge = "";
    let forgeSignature = false;
    let audience: string | string[] = "framekit";
    let authorizedParty: string | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) return Response.json({
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
        code_challenge_methods_supported: ["S256"], id_token_signing_alg_values_supported: ["RS256"]
      });
      if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
      if (url.endsWith("/token")) {
        const body = new URLSearchParams(String(init?.body));
        const challenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.get("code_verifier")!)));
        expect(challenge).toBe(expectedChallenge);
        const idToken = forgeSignature ? "forged.jwt.signature" : await new SignJWT({ email: "admin@example.com", nonce, ...(authorizedParty ? { azp: authorizedParty } : {}) }).setProtectedHeader({ alg: "RS256", kid: "test-key" })
          .setIssuer(issuer).setAudience(audience).setSubject("external-admin").setIssuedAt().setExpirationTime("5m").sign(privateKey);
        return Response.json({ id_token: idToken, token_type: "Bearer" });
      }
      throw new Error(`Unexpected OIDC request ${url}`);
    };
    const links = new InMemoryAuthIdentityLinkStore([]);
    const provider = createOidcAuthorizationCodeProvider({
      id: "oidc", issuer, clientId: "framekit", redirectUri: "https://app.example/api/auth/providers/oidc/callback",
      flowSecret: "oidc-flow-secret-at-least-thirty-two-characters", stateStore: new InMemoryOidcAuthorizationStateStore(), fetch: fetcher
    });
    const auth = new PasswordAuthService({
      secret: "test-secret-with-enough-length", identityLinks: links, identityLinkingPolicy: { mode: "linked" }, providers: [provider],
      userStore: new InMemoryUserStore([{ id: "u1", tenantId: "t1", email: "admin@example.com", name: "Admin", passwordHash: await hashPassword("password"), roles: [], permissions: [] }])
    });
    await auth.linkProviderIdentity({ tenantId: "t1", providerId: "oidc", subject: "external-admin", userId: "u1" });
    const started = await auth.beginProviderAuthorization("oidc", { tenantId: "t1", returnTo: "/desk" });
    const authorization = new URL(started.authorizationUrl);
    nonce = authorization.searchParams.get("nonce")!;
    expectedChallenge = authorization.searchParams.get("code_challenge")!;
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    const state = authorization.searchParams.get("state")!;
    await expect(auth.completeProviderAuthorization("oidc", { code: "authorization-code", state })).resolves.toMatchObject({ session: { context: { userId: "u1", tenantId: "t1" } }, returnTo: "/desk" });
    await expect(auth.completeProviderAuthorization("oidc", { code: "replay", state })).rejects.toMatchObject({ code: "OIDC_STATE_INVALID" });

    const completeAudienceCase = async (nextAudience: string | string[], azp: string | undefined, code: string) => {
      audience = nextAudience;
      authorizedParty = azp;
      const startedCase = await auth.beginProviderAuthorization("oidc", { tenantId: "t1" });
      const url = new URL(startedCase.authorizationUrl);
      nonce = url.searchParams.get("nonce")!;
      expectedChallenge = url.searchParams.get("code_challenge")!;
      return auth.completeProviderAuthorization("oidc", { code, state: url.searchParams.get("state")! });
    };
    await expect(completeAudienceCase("framekit", undefined, "single-no-azp")).resolves.toMatchObject({ session: { context: { userId: "u1" } } });
    await expect(completeAudienceCase("framekit", "framekit", "single-matching-azp")).resolves.toMatchObject({ session: { context: { userId: "u1" } } });
    await expect(completeAudienceCase("framekit", "different-client", "single-wrong-azp")).rejects.toMatchObject({ code: "OIDC_AUTHORIZED_PARTY_MISMATCH" });
    await expect(completeAudienceCase(["framekit", "another-api"], undefined, "multi-no-azp")).rejects.toMatchObject({ code: "OIDC_AUTHORIZED_PARTY_MISMATCH" });
    await expect(completeAudienceCase(["framekit", "another-api"], "different-client", "multi-wrong-azp")).rejects.toMatchObject({ code: "OIDC_AUTHORIZED_PARTY_MISMATCH" });
    await expect(completeAudienceCase(["framekit", "another-api"], "framekit", "multi-matching-azp")).resolves.toMatchObject({ session: { context: { userId: "u1" } } });

    const nonceAttack = await auth.beginProviderAuthorization("oidc", { tenantId: "t1" });
    const nonceAttackUrl = new URL(nonceAttack.authorizationUrl);
    expectedChallenge = nonceAttackUrl.searchParams.get("code_challenge")!;
    nonce = "attacker-controlled-nonce";
    await expect(auth.completeProviderAuthorization("oidc", { code: "nonce-attack", state: nonceAttackUrl.searchParams.get("state")! }))
      .rejects.toMatchObject({ code: "OIDC_NONCE_MISMATCH" });

    const signatureAttack = await auth.beginProviderAuthorization("oidc", { tenantId: "t1" });
    const signatureAttackUrl = new URL(signatureAttack.authorizationUrl);
    nonce = signatureAttackUrl.searchParams.get("nonce")!;
    expectedChallenge = signatureAttackUrl.searchParams.get("code_challenge")!;
    forgeSignature = true;
    await expect(auth.completeProviderAuthorization("oidc", { code: "signature-attack", state: signatureAttackUrl.searchParams.get("state")! }))
      .rejects.toMatchObject({ code: "OIDC_ID_TOKEN_INVALID" });
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
      identityLinkingPolicy: { mode: "email", autoLink: true },
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

function base64Url(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64url");
}

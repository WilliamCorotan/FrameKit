import { H3, toWebHandler } from "h3";
import { hashPassword, InMemoryMfaStore, InMemoryUserStore, MfaService, PasswordAuthService, totp, type MfaSecretPort } from "@framekit/auth";
import { defineApp } from "@framekit/core";
import { createRuntime } from "@framekit/runtime";
import { describe, expect, it } from "vitest";
import { createNitroHandler } from "./index.js";

const ORIGIN = "http://localhost";
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("OIDC MFA browser completion", () => {
  it("renders a no-JS challenge form then redirects locally after MFA", async () => {
    const fixture = await browserFixture("/desk");
    const authorize = await fixture.fetch(new Request(`${ORIGIN}/api/auth/providers/oidc/authorize?returnTo=%2Fdesk`));
    const flowCookie = authorize.headers.get("set-cookie")!.split(";")[0]!;
    const callback = await fixture.fetch(new Request(`${ORIGIN}/api/auth/providers/oidc/callback?code=code&state=state`, { headers: { cookie: flowCookie } }));
    expect(callback.status).toBe(200);
    expect(callback.headers.get("content-type")).toContain("text/html");
    expect(callback.headers.get("cache-control")).toBe("no-store");
    expect(callback.headers.get("referrer-policy")).toBe("strict-origin");
    expect(callback.headers.get("content-security-policy")).toContain("default-src 'none'");
    const page = await callback.text();
    expect(page).toContain("Complete sign in");
    expect(page).toContain('action="/api/auth/mfa/complete"');
    expect(callback.url).not.toContain("challengeToken");
    const challengeToken = page.match(/name="challengeToken" value="([^"]+)"/)?.[1];
    expect(challengeToken).toBeTruthy();
    const code = await totp(SECRET, Math.floor(Date.now() / 30_000));
    const form = new URLSearchParams({ challengeToken: challengeToken!, code, returnTo: "/desk" });
    const complete = await fixture.fetch(new Request(`${ORIGIN}/api/auth/mfa/complete`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: form }));
    expect(complete.status).toBe(303);
    expect(complete.headers.get("location")).toBe("/desk");
    expect(complete.headers.get("set-cookie")).toContain("HttpOnly");
    const replay = await fixture.fetch(new Request(`${ORIGIN}/api/auth/mfa/complete`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: form }));
    expect(replay.status).toBe(401);
    expect(replay.headers.get("set-cookie")).toBeNull();
  });

  it("rejects unsafe provider and form return paths", async () => {
    const unsafeProvider = await browserFixture("//evil.example");
    const authorize = await unsafeProvider.fetch(new Request(`${ORIGIN}/api/auth/providers/oidc/authorize?returnTo=%2F`));
    const cookie = authorize.headers.get("set-cookie")!.split(";")[0]!;
    const callback = await unsafeProvider.fetch(new Request(`${ORIGIN}/api/auth/providers/oidc/callback?code=code&state=state`, { headers: { cookie } }));
    expect(callback.status).toBe(422);
    // The one-time OIDC browser-state cookie is deliberately consumed.
    expect(callback.headers.get("set-cookie")).toContain("Max-Age=0");

    const fixture = await browserFixture("/");
    const secondAuthorize = await fixture.fetch(new Request(`${ORIGIN}/api/auth/providers/oidc/authorize?returnTo=%2F`));
    const secondCookie = secondAuthorize.headers.get("set-cookie")!.split(";")[0]!;
    const challenge = await fixture.fetch(new Request(`${ORIGIN}/api/auth/providers/oidc/callback?code=code&state=state`, { headers: { cookie: secondCookie } }));
    const token = (await challenge.text()).match(/name="challengeToken" value="([^"]+)"/)?.[1]!;
    const code = await totp(SECRET, Math.floor(Date.now() / 30_000));
    for (const returnTo of ["//evil.example", "/\t/evil.example", "/\n/evil.example", "/\\evil.example", "https://evil.example"]) {
      const body = new URLSearchParams({ challengeToken: token, code, returnTo });
      const rejected = await fixture.fetch(new Request(`${ORIGIN}/api/auth/mfa/complete`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body }));
      expect(rejected.status).toBe(422);
      expect(rejected.headers.get("set-cookie")).toBeNull();
    }

    const invalid = await fixture.fetch(new Request(`${ORIGIN}/api/auth/mfa/complete`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ challengeToken: "forged", code, returnTo: "/" })
    }));
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("set-cookie")).toBeNull();
  });
});

async function browserFixture(returnTo: string) {
  const user = { tenantId: "default", id: "user", email: "user@example.com", name: "User", passwordHash: await hashPassword("password"), roles: [], permissions: [] };
  const store = new InMemoryMfaStore();
  const secrets: MfaSecretPort = { seal: (value) => value, unseal: (value) => value };
  const mfa = new MfaService(store, secrets, { allowAttempt: () => true });
  await store.compareAndSet({ tenantId: user.tenantId, userId: user.id, enrollmentId: "enrollment", encryptedSecret: SECRET, confirmedAt: Date.now(), sessionVersion: "enrollment", recoveryHashes: [], revision: 1 }, undefined);
  const auth = new PasswordAuthService({
    secret: "oidc-mfa-browser-secret-with-enough-length",
    userStore: new InMemoryUserStore([user]),
    mfa,
    identityLinkingPolicy: { mode: "email", autoLink: true },
    providers: [{
      id: "oidc",
      authenticate: async () => { throw new Error("code flow only"); },
      beginAuthorization: async () => ({ authorizationUrl: "https://issuer.example/authorize?state=state" }),
      completeAuthorization: async () => ({ identity: { providerId: "oidc", subject: "user", tenantId: "default", email: user.email, emailVerified: true }, returnTo })
    }]
  });
  const h3 = new H3();
  h3.all("/**", createNitroHandler(createRuntime(defineApp({ name: "OIDC MFA", modules: [] })), { auth, authCookie: { name: "session", secure: false } }));
  return { fetch: toWebHandler(h3) };
}

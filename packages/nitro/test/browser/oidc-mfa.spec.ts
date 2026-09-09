import { createServer } from "node:http";
import { once } from "node:events";
import { H3, toWebHandler } from "h3";
import { expect, test } from "@playwright/test";
import { hashPassword, InMemoryMfaStore, InMemoryUserStore, MfaService, PasswordAuthService, totp, type MfaSecretPort } from "@framekit/auth";
import { defineApp } from "@framekit/core";
import { createRuntime } from "@framekit/runtime";
import { createNitroHandler } from "../../src/index.js";

const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("renders and submits the OIDC MFA browser form", async ({ page, context }) => {
  const h3 = new H3();
  const store = new InMemoryMfaStore();
  const mfaSecrets: MfaSecretPort = { seal: (value) => value, unseal: (value) => value };
  const user = { tenantId: "default", id: "user", email: "user@example.com", name: "User", passwordHash: await hashPassword("password"), roles: [], permissions: [] };
  const mfa = new MfaService(store, mfaSecrets, { allowAttempt: () => true });
  await store.compareAndSet({ tenantId: "default", userId: "user", enrollmentId: "enrollment", sessionVersion: "enrollment", encryptedSecret: secret, confirmedAt: Date.now(), recoveryHashes: [], revision: 1 }, undefined);
  const auth = new PasswordAuthService({ secret: "browser-oidc-mfa-secret-with-enough-length", userStore: new InMemoryUserStore([user]), mfa, identityLinkingPolicy: { mode: "email", autoLink: true }, providers: [{ id: "oidc", authenticate: async () => { throw new Error("code only"); }, beginAuthorization: async () => ({ authorizationUrl: "https://issuer.example/authorize?state=state" }), completeAuthorization: async () => ({ identity: { providerId: "oidc", subject: "user", tenantId: "default", email: user.email, emailVerified: true }, returnTo: "/desk" }) }] });
  const runtime = createRuntime(defineApp({ name: "Browser OIDC", modules: [] }));
  const handler = toWebHandler(h3);
  const server = createServer(async (request, response) => {
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : request;
    const result = await handler(new Request(`http://${request.headers.host}${request.url}`, { method: request.method, headers: request.headers as Record<string, string>, body: body as ReadableStream | undefined, duplex: "half" } as RequestInit & { duplex: "half" }));
    response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
    response.end(Buffer.from(await result.arrayBuffer()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  h3.get("/desk", () => new Response("Signed in"));
  h3.all("/**", createNitroHandler(runtime, { auth, authCookie: { name: "session", secure: false }, security: { trustedOrigins: [origin] } }));
  try {
    const authorization = await page.request.get(`${origin}/api/auth/providers/oidc/authorize?returnTo=%2Fdesk`, { maxRedirects: 0 });
    const cookie = authorization.headers()["set-cookie"]!.split(";")[0]!.split("=");
    await context.addCookies([{ name: cookie[0]!, value: cookie.slice(1).join("="), url: origin, httpOnly: true, sameSite: "Lax" }]);
    const callback = await page.goto(`${origin}/api/auth/providers/oidc/callback?code=code&state=state`);
    expect(callback!.headers()["referrer-policy"]).toBe("strict-origin");
    await expect(page.getByRole("heading", { name: "Complete sign in" })).toBeVisible();
    await page.getByLabel("Authenticator code").fill(await totp(secret, Math.floor(Date.now() / 30_000)));
    const challengeToken = await page.locator("input[name=challengeToken]").inputValue();
    await page.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${origin}/desk`);
    await expect(page.locator("body")).toHaveText("Signed in");
    expect((await context.cookies(origin)).some((cookie) => cookie.name === "session" && cookie.httpOnly)).toBe(true);
    const replay = await page.request.post(`${origin}/api/auth/mfa/complete`, { headers: { origin }, form: { challengeToken, code: "000000", returnTo: "/desk" }, maxRedirects: 0 });
    expect(replay.status()).toBe(401);
    expect(replay.headers()["set-cookie"]).toBeUndefined();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
  }
});

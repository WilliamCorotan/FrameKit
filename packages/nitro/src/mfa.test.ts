import { H3, toWebHandler } from "h3";
import {
  hashPassword,
  InMemoryMfaStore,
  InMemoryUserStore,
  MfaService,
  PasswordAuthService,
  totp,
  type MfaSecretPort
} from "@framekit/auth";
import { defineApp } from "@framekit/core";
import { createRuntime } from "@framekit/runtime";
import { describe, expect, it } from "vitest";
import { createNitroHandler } from "./index.js";

const PASSWORD = "mfa test password";
const ORIGIN = "http://localhost";

type LoginBody = { token: string };
type EnrollmentBody = { secret: string; expiresAt: string };
type ChallengeBody = { code: string; details: { challengeToken: string } };

describe("Nitro MFA HTTP routes", () => {
  it("enrolls a recent authenticated user, gates login, and issues a cookie after a one-time challenge", async () => {
    const fixture = await createFixture();
    const missingStatus = await fixture.fetch(request("/api/auth/mfa/status"));
    const missingEnrollment = await fixture.fetch(request("/api/auth/mfa/enroll", { method: "POST" }));
    expect(missingStatus.status).toBe(401);
    expect(missingEnrollment.status).toBe(401);

    const primary = await login(fixture);
    const oldSession = primary.token;
    const enrollmentResponse = await fixture.fetch(request("/api/auth/mfa/enroll", {
      method: "POST",
      headers: {
        authorization: `Bearer ${oldSession}`,
        // Request identity never overrides a signed session's tenant.
        "x-tenant-id": "other-tenant"
      }
    }));
    expect(enrollmentResponse.status).toBe(200);
    const enrollment = await enrollmentResponse.json() as EnrollmentBody;
    expect(await fixture.store.get("other-tenant", "user")).toBeUndefined();

    const confirmCode = await totp(enrollment.secret, Math.floor(fixture.mfaNow() / 30_000));
    const confirmed = await fixture.fetch(request("/api/auth/mfa/confirm", {
      method: "POST",
      headers: { authorization: `Bearer ${oldSession}` },
      body: { code: confirmCode }
    }));
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json() as { recoveryCodes: string[] }).recoveryCodes).toHaveLength(8);

    // Enrollment changes the required MFA proof, invalidating the primary-only session.
    const oldSessionStatus = await fixture.fetch(request("/api/auth/mfa/status", {
      headers: { authorization: `Bearer ${oldSession}` }
    }));
    expect(oldSessionStatus.status).toBe(401);

    const gated = await fixture.fetch(request("/api/auth/login", {
      method: "POST",
      body: { email: "user@example.com", password: PASSWORD }
    }));
    expect(gated.status).toBe(401);
    expect(gated.headers.get("set-cookie")).toBeNull();
    const challenge = await gated.json() as ChallengeBody;
    expect(challenge).toMatchObject({ code: "MFA_REQUIRED", details: { challengeToken: expect.any(String) } });

    fixture.advanceStep();
    const awaitCode = await totp(enrollment.secret, Math.floor(fixture.mfaNow() / 30_000));
    const challengeRequest = (origin?: string) => {
      const headers: Record<string, string> = { "content-type": "application/json", "x-tenant-id": "default" };
      if (origin !== undefined) headers.origin = origin;
      return new Request(`${ORIGIN}/api/auth/mfa/complete`, {
        method: "POST",
        headers,
        body: JSON.stringify({ challengeToken: challenge.details.challengeToken, code: awaitCode })
      });
    };

    for (const origin of [undefined, "https://untrusted.example"]) {
      const blocked = await fixture.fetch(challengeRequest(origin));
      expect(blocked.status).toBe(403);
      expect(blocked.headers.get("set-cookie")).toBeNull();
    }

    const completed = await fixture.fetch(challengeRequest(ORIGIN));
    expect(completed.status).toBe(200);
    expect(completed.headers.get("set-cookie")).toContain("fk_session=");
    expect(completed.headers.get("set-cookie")).toContain("HttpOnly");

    const replay = await fixture.fetch(challengeRequest(ORIGIN));
    expect(replay.status).toBe(401);
    expect(replay.headers.get("set-cookie")).toBeNull();
  });
});

async function createFixture() {
  let mfaTime = Math.floor(Date.now() / 30_000) * 30_000;
  const store = new InMemoryMfaStore(() => mfaTime);
  const secrets: MfaSecretPort = {
    seal: (secret) => secret,
    unseal: (secret) => secret
  };
  const mfa = new MfaService(store, secrets, { allowAttempt: () => true, now: () => mfaTime });
  const auth = new PasswordAuthService({
    secret: "nitro-mfa-test-secret-with-enough-length",
    userStore: new InMemoryUserStore([{
      tenantId: "default",
      id: "user",
      email: "user@example.com",
      name: "MFA User",
      passwordHash: await hashPassword(PASSWORD),
      roles: [],
      permissions: []
    }]),
    mfa
  });
  const runtime = createRuntime(defineApp({ name: "Nitro MFA", modules: [] }));
  const h3 = new H3();
  h3.all("/**", createNitroHandler(runtime, {
    auth,
    authCookie: { name: "fk_session", secure: false }
  }));
  return {
    fetch: toWebHandler(h3),
    store,
    mfaNow: () => mfaTime,
    advanceStep: () => { mfaTime += 30_000; }
  };
}

async function login(fixture: Awaited<ReturnType<typeof createFixture>>): Promise<LoginBody> {
  const response = await fixture.fetch(request("/api/auth/login", {
    method: "POST",
    body: { email: "user@example.com", password: PASSWORD }
  }));
  expect(response.status).toBe(200);
  return response.json() as Promise<LoginBody>;
}

function request(path: string, options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json", "x-tenant-id": "default", origin: ORIGIN, ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
}

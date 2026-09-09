import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresAuthLifecycleTokenStore,
  PostgresMfaStore,
  PostgresOidcAuthorizationStateStore
} from "./index.js";

const sourceUrl = process.env.DATABASE_URL;

describe.skipIf(!sourceUrl)("Postgres auth retention", () => {
  const databaseName = `framekit_retention_${crypto.randomUUID().replaceAll("-", "")}`;
  let admin: Sql;
  let lifecycle: PostgresAuthLifecycleTokenStore;
  let oidc: PostgresOidcAuthorizationStateStore;
  let mfa: PostgresMfaStore;
  let sql: Sql;

  beforeAll(async () => {
    const adminUrl = databaseUrl(sourceUrl!, "postgres");
    const testUrl = databaseUrl(sourceUrl!, databaseName);
    admin = postgres(adminUrl, { max: 1 });
    await admin.unsafe(`create database "${databaseName}"`);
    sql = postgres(testUrl, { max: 1 });
    lifecycle = new PostgresAuthLifecycleTokenStore({ connectionString: testUrl });
    oidc = new PostgresOidcAuthorizationStateStore({ connectionString: testUrl });
    mfa = new PostgresMfaStore({ connectionString: testUrl });
    await lifecycle.migrate();
    await oidc.migrate();
    await mfa.migrate();
  });

  afterAll(async () => {
    await Promise.allSettled([lifecycle?.close(), oidc?.close(), mfa?.close(), sql?.end({ timeout: 1 })]);
    await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
    await admin.end({ timeout: 1 });
  });

  it("removes only expired lifecycle and OIDC rows, with concurrent cleaners sharing work", async () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    const live = new Date(Date.now() + 60_000).toISOString();
    for (const index of [1, 2, 3, 4]) {
      await lifecycle.create({
        id: `expired-token-${index}`,
        tenantId: "retention-tenant",
        kind: "recovery",
        tokenHash: `expired-token-hash-${index}`,
        createdAt: expired,
        expiresAt: expired
      });
      await oidc.create({
        id: `expired-state-${index}`,
        providerId: "provider",
        tenantId: "retention-tenant",
        stateHash: `expired-state-hash-${index}`,
        nonceHash: `nonce-${index}`,
        encryptedCodeVerifier: "ciphertext",
        returnTo: "/",
        redirectUri: "https://example.test/callback",
        createdAt: expired,
        expiresAt: expired
      });
    }
    await lifecycle.create({ id: "live-token", tenantId: "retention-tenant", kind: "recovery", tokenHash: "live-token-hash", createdAt: live, expiresAt: live });
    await oidc.create({ id: "live-state", providerId: "provider", tenantId: "retention-tenant", stateHash: "live-state-hash", nonceHash: "live-nonce", encryptedCodeVerifier: "ciphertext", returnTo: "/", redirectUri: "https://example.test/callback", createdAt: live, expiresAt: live });

    const lifecycleCounts = await Promise.all([lifecycle.pruneExpired(2), lifecycle.pruneExpired(2)]);
    const oidcCounts = await Promise.all([oidc.pruneExpired(2), oidc.pruneExpired(2)]);
    expect(lifecycleCounts[0]! + lifecycleCounts[1]!).toBe(4);
    expect(oidcCounts[0]! + oidcCounts[1]!).toBe(4);
    expect((await sql`select id from framekit_auth_lifecycle_tokens`).map((row) => row.id)).toEqual(["live-token"]);
    expect((await sql`select id from framekit_oidc_authorization_states`).map((row) => row.id)).toEqual(["live-state"]);
  });

  it("prunes expired MFA attempt windows without deleting live windows or factor tombstones", async () => {
    const tenantId = "mfa-retention-tenant";
    const expired = new Date(Date.now() - 60_000);
    const live = new Date(Date.now() + 60_000);
    await sql`
      insert into framekit_mfa_attempts (tenant_id, user_id, count, expires_at)
      values (${tenantId}, 'expired-a', 1, ${expired}), (${tenantId}, 'expired-b', 1, ${expired}), (${tenantId}, 'live', 1, ${live})`;
    expect(await mfa.compareAndSet({
      tenantId,
      userId: "tombstone",
      enrollmentId: "disabled-factor",
      recoveryHashes: [],
      revision: 1
    }, undefined)).toBe(true);

    const counts = await Promise.all([mfa.pruneExpiredAttempts(1), mfa.pruneExpiredAttempts(1)]);
    expect(counts[0]! + counts[1]!).toBe(2);
    expect((await sql`select user_id from framekit_mfa_attempts order by user_id`).map((row) => row.user_id)).toEqual(["live"]);
    expect((await sql`select user_id from framekit_mfa_factors where tenant_id = ${tenantId}`).map((row) => row.user_id)).toEqual(["tombstone"]);
  });

  it("rejects unsafe or unbounded retention limits", async () => {
    for (const limit of [0, -1, 1.5, 10_001, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(lifecycle.pruneExpired(limit)).rejects.toThrow("Retention limit");
      await expect(oidc.pruneExpired(limit)).rejects.toThrow("Retention limit");
      await expect(mfa.pruneExpiredAttempts(limit)).rejects.toThrow("Retention limit");
    }
  });
});

function databaseUrl(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

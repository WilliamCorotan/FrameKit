import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { PostgresMfaStore } from "./index.js";

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("PostgresMfaStore", () => {
  if (!connectionString) return;
  const sql = postgres(connectionString!);
  const tenantId = `mfa-${crypto.randomUUID()}`;
  const first = new PostgresMfaStore({ connectionString: connectionString! });
  const second = new PostgresMfaStore({ connectionString: connectionString! });

  function factor(userId: string, revision: number, pendingUntil?: number) {
    return {
      tenantId,
      userId,
      enrollmentId: `enrollment-${revision}`,
      encryptedSecret: "ciphertext",
      pendingUntil,
      recoveryHashes: [],
      revision
    };
  }

  afterAll(async () => {
    await sql`delete from framekit_mfa_attempts where tenant_id = ${tenantId}`;
    await sql`delete from framekit_mfa_factors where tenant_id = ${tenantId}`;
    await first.close();
    await second.close();
    await sql.end();
  });

  it("uses insert-only and update-only revision CAS operations", async () => {
    await first.migrate();
    expect(await first.compareAndSet(factor("cas", 1), undefined)).toBe(true);
    expect(await first.compareAndSet(factor("cas", 1), undefined)).toBe(false);
    expect(await first.compareAndSet(factor("missing", 2), 1)).toBe(false);
    expect(await first.compareAndSet(factor("cas", 2), 1)).toBe(true);
    expect((await Promise.all([
      first.compareAndSet(factor("cas", 3), 2),
      second.compareAndSet(factor("cas", 3), 2)
    ])).filter(Boolean)).toHaveLength(1);
  });

  it("checks the deadline after waiting for an unchanged row lock", async () => {
    expect(await first.compareAndSet(factor("locked", 1), undefined)).toBe(true);
    let attempt: Promise<boolean> | undefined;
    await sql.begin(async (tx) => {
      await tx`select revision from framekit_mfa_factors where tenant_id = ${tenantId} and user_id = 'locked' for update`;
      attempt = first.compareAndSet(factor("locked", 2), 1, Date.now() + 100);
      await tx`select pg_sleep(0.2)`;
    });
    await expect(attempt).resolves.toBe(false);
    expect((await first.get(tenantId, "locked"))?.revision).toBe(1);
  });

  it("rejects expired confirmation and verification deadlines without changing the factor", async () => {
    expect(await first.compareAndSet(factor("deadline", 1), undefined)).toBe(true);
    const expired = Date.now() - 1;

    // A confirmation's pending-enrollment deadline has passed.
    expect(await first.compareAndSet(factor("deadline", 2), 1, expired)).toBe(false);
    expect((await first.get(tenantId, "deadline"))?.revision).toBe(1);

    // A verification timestep deadline has passed too.
    expect(await first.compareAndSet(factor("deadline", 2), 1, expired)).toBe(false);
    expect((await first.get(tenantId, "deadline"))?.revision).toBe(1);
  });

  it("allows re-enrollment over an expired pending factor without a write deadline", async () => {
    const expiredPending = Date.now() - 60_000;
    expect(await first.compareAndSet(factor("pending", 1, expiredPending), undefined)).toBe(true);
    // A row written by an older adapter may retain its pending deadline here.
    await sql`update framekit_mfa_factors set expires_at = clock_timestamp() - interval '1 second' where tenant_id = ${tenantId} and user_id = 'pending'`;
    expect(await first.compareAndSet(factor("pending", 2, Date.now() + 60_000), 1)).toBe(true);
    const replaced = await first.get(tenantId, "pending");
    expect(replaced?.revision).toBe(2);
    expect(replaced?.pendingUntil).toBeGreaterThan(Date.now());
  });

  it("preserves tombstones and rate limits concurrent attempts without extending rejection windows", async () => {
    expect(await first.compareAndSet(factor("tombstone", 1), undefined)).toBe(true);
    expect(await first.compareAndSet(factor("tombstone", 2), 1)).toBe(true);
    expect(await first.compareAndSet(factor("tombstone", 1), undefined)).toBe(false);

    expect((await Promise.all(Array.from({ length: 8 }, () => first.allowAttempt(tenantId, "limited")))).filter(Boolean)).toHaveLength(5);
    const [expiry] = await sql<{ expires_at: Date }[]>`
      select expires_at from framekit_mfa_attempts where tenant_id = ${tenantId} and user_id = 'limited'`;
    expect(await first.allowAttempt(tenantId, "limited")).toBe(false);
    const [sameExpiry] = await sql<{ expires_at: Date }[]>`
      select expires_at from framekit_mfa_attempts where tenant_id = ${tenantId} and user_id = 'limited'`;
    expect(sameExpiry!.expires_at.getTime()).toBe(expiry!.expires_at.getTime());

    await sql`update framekit_mfa_attempts set expires_at = clock_timestamp() - interval '1 second' where tenant_id = ${tenantId} and user_id = 'limited'`;
    expect(await second.allowAttempt(tenantId, "limited")).toBe(true);
    expect(await first.allowAttempt(tenantId, "other-user")).toBe(true);
  });
});

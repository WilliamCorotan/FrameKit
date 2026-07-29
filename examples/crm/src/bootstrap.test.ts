import { verifyPassword } from "@framekit/auth";
import { describe, expect, it } from "vitest";
import { createBootstrapAdmin } from "./bootstrap.js";

declare const process: { env: Record<string, string | undefined> };

describe("createBootstrapAdmin", () => {
  it("uses a fresh random password salt for every bootstrap record", async () => {
    const first = await createBootstrapAdmin("admin@example.test", "production bootstrap password");
    const second = await createBootstrapAdmin("admin@example.test", "production bootstrap password");

    expect(first.passwordHash).not.toBe(second.passwordHash);
    await expect(verifyPassword("production bootstrap password", first.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("production bootstrap password", second.passwordHash)).resolves.toBe(true);
  });

  it.skipIf(!process.env.DATABASE_URL)("reports durable atomic mutation diagnostics with PostgreSQL configured", async () => {
    const { runtime } = await import("./app.js");
    try {
      const diagnostics = await runtime.diagnostics();

      expect(diagnostics.mutations).toMatchObject({
        kind: "postgres",
        durable: true,
        features: expect.arrayContaining(["atomic-mutations", "idempotency"])
      });
      expect(diagnostics.warnings).not.toContain(
        "Durable document mutations are not atomic; configure a backend MutationUnitOfWork."
      );
    } finally {
      await runtime.close();
    }
  });
});

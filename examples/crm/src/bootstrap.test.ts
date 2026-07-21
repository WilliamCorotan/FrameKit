import { verifyPassword } from "@framekit/auth";
import { describe, expect, it } from "vitest";
import { createBootstrapAdmin } from "./bootstrap.js";

describe("createBootstrapAdmin", () => {
  it("uses a fresh random password salt for every bootstrap record", async () => {
    const first = await createBootstrapAdmin("admin@example.test", "production bootstrap password");
    const second = await createBootstrapAdmin("admin@example.test", "production bootstrap password");

    expect(first.passwordHash).not.toBe(second.passwordHash);
    await expect(verifyPassword("production bootstrap password", first.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("production bootstrap password", second.passwordHash)).resolves.toBe(true);
  });
});

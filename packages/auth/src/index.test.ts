import { describe, expect, it } from "vitest";
import { hashPassword, InMemoryUserStore, PasswordAuthService } from "./index.js";

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

    const session = await auth.login("ADMIN@example.com", "correct horse battery staple");
    const verified = await auth.verifyToken(session.token);

    expect(verified.context).toMatchObject({ tenantId: "t1", userId: "u1" });
    expect(verified.user.email).toBe("admin@example.com");
  });

  it("rejects invalid credentials", async () => {
    const store = new InMemoryUserStore([]);
    const auth = new PasswordAuthService({ secret: "test-secret-with-enough-length", userStore: store });

    await expect(auth.login("nobody@example.com", "wrong")).rejects.toMatchObject({ code: "INVALID_LOGIN" });
  });
});

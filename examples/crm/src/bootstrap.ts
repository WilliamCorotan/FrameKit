import { hashPassword, type AuthUser } from "@framekit/auth";

export async function createBootstrapAdmin(email: string, password: string): Promise<AuthUser> {
  return {
    id: "admin",
    tenantId: "default",
    email,
    name: "Framekit Admin",
    passwordHash: await hashPassword(password),
    roles: ["administrator"],
    permissions: ["*"]
  };
}

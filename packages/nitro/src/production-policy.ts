import { assertSecureAuthSecret } from "@framekit/auth";
import type { NitroProductionCredentials } from "./contracts.js";

export function nodeEnvironment(): string | undefined {
  return (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
}

export function assertSecureProductionCredentials(options: NitroProductionCredentials): void {
  const environment = options.environment ?? nodeEnvironment();
  if (environment !== "production") return;
  try {
    assertSecureAuthSecret(options.authSecret ?? "", "production");
  } catch (error) {
    throw new Error(`FRAMEKIT_AUTH_SECRET: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (options.bootstrap) {
    const email = options.bootstrap.email?.trim().toLowerCase();
    if (!email || email === "admin@example.com" || email.endsWith("@example.com")) {
      throw new Error("Production bootstrap email must be explicitly provisioned and cannot use example.com.");
    }
    assertProductionValue("FRAMEKIT_ADMIN_PASSWORD", options.bootstrap.password, 14);
  }
}

function assertProductionValue(name: string, value: string | undefined, minimumLength: number): void {
  const normalized = value?.trim();
  const lower = normalized?.toLowerCase() ?? "";
  if (!normalized || normalized.length < minimumLength || lower.includes("change-me") || lower.includes("changeme") || lower.includes("replace-with") || lower === "admin12345" || new Set(normalized).size < 8) {
    throw new Error(`${name} must be explicitly provisioned with a strong, non-default value in production.`);
  }
}

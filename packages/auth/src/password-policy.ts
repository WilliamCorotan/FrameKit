import { FramekitError } from "@framekit/core";
import type { AuthAuditSink } from "./contracts.js";
import { constantEqual, derivePasswordKey, randomSalt } from "./crypto.js";
import { runtimeEnvironment } from "./shared.js";

export function assertSecureAuthSecret(secret: string, environment = runtimeEnvironment()): void {
  if (secret.length < 16) {
    throw new Error("Auth secret must be at least 16 characters.");
  }
  if (environment !== "production") {
    return;
  }
  const lower = secret.trim().toLowerCase();
  if (
    secret.trim().length < 32
    || lower.includes("change-me")
    || lower.includes("changeme")
    || lower.includes("replace-with")
    || new Set(secret).size < 8
  ) {
    throw new Error("Auth secret must be explicitly provisioned with a strong, non-default value in production.");
  }
}
export async function hashPassword(password: string, salt = randomSalt()): Promise<string> {
  const iterations = 160_000;
  const key = await derivePasswordKey(password, salt, iterations);
  return `pbkdf2-sha256:${iterations}:${salt}:${key}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const [algorithm, iterationsRaw, salt, expected] = passwordHash.split(":");
  if (algorithm !== "pbkdf2-sha256" || !iterationsRaw || !salt || !expected) {
    throw new FramekitError("INVALID_PASSWORD_HASH", "Unsupported password hash format.", 500);
  }
  const actual = await derivePasswordKey(password, salt, Number(iterationsRaw));
  return constantEqual(actual, expected);
}

export function bearerToken(header: string | null): string | undefined {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length).trim();
}


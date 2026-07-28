import { FramekitError } from "@framekit/core";
import type { ApiTokenRecord, AuthAuditEvent, AuthIdentityLink, AuthLifecycleToken, AuthRole, AuthUser, PublicApiToken, PublicAuthUser } from "./contracts.js";

export function publicUser(user: AuthUser): PublicAuthUser {
  const { passwordHash: _passwordHash, failedLoginAttempts: _failedLoginAttempts, ...rest } = user;
  return {
    ...rest,
    roles: [...rest.roles],
    permissions: [...rest.permissions]
  };
}

export function publicApiToken(token: ApiTokenRecord): PublicApiToken {
  const { tokenHash: _tokenHash, ...rest } = token;
  return {
    ...rest,
    roles: [...rest.roles],
    permissions: [...rest.permissions]
  };
}
export function normalizeExpiresAt(expiresAt: string | undefined): string | undefined {
  if (!expiresAt) {
    return undefined;
  }
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) {
    throw new FramekitError("VALIDATION_FAILED", "expiresAt must be a valid date-time.", 422);
  }
  if (date.getTime() <= Date.now()) {
    throw new FramekitError("VALIDATION_FAILED", "expiresAt must be in the future.", 422);
  }
  return date.toISOString();
}

export function normalizeRequiredFutureDate(value: string): string {
  const normalized = normalizeExpiresAt(value);
  if (!normalized) throw new FramekitError("VALIDATION_FAILED", "expiresAt is required.", 422);
  return normalized;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function cloneUser(user: AuthUser | undefined): AuthUser | undefined {
  return user ? { ...user, roles: [...user.roles], permissions: [...user.permissions] } : undefined;
}

export function cloneRole(role: AuthRole): AuthRole {
  return { ...role, permissions: [...role.permissions] };
}

export function cloneApiToken(token: ApiTokenRecord): ApiTokenRecord {
  return { ...token, roles: [...token.roles], permissions: [...token.permissions] };
}

export function cloneOptionalApiToken(token: ApiTokenRecord | undefined): ApiTokenRecord | undefined {
  return token ? cloneApiToken(token) : undefined;
}

export function cloneIdentityLink(link: AuthIdentityLink): AuthIdentityLink {
  return { ...link };
}

export function cloneLifecycleToken(token: AuthLifecycleToken): AuthLifecycleToken {
  return { ...token, roles: token.roles ? [...token.roles] : undefined, permissions: token.permissions ? [...token.permissions] : undefined };
}
export function runtimeEnvironment(): string | undefined {
  return (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
}

export function safeReturnTo(value: string | undefined): string {
  const returnTo = value ?? "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.includes("\\")) {
    throw new FramekitError("INVALID_RETURN_TO", "returnTo must be a same-origin absolute path.", 422);
  }
  return returnTo;
}

export function authErrorCode(error: unknown): string {
  return error instanceof FramekitError ? error.code : "unexpected_error";
}

export function authErrorTenant(error: unknown): string | undefined {
  if (!(error instanceof FramekitError) || !error.details || typeof error.details !== "object") return undefined;
  const tenantId = (error.details as { tenantId?: unknown }).tenantId;
  return typeof tenantId === "string" ? tenantId : undefined;
}


import type { TenantContext } from "@framekit/core";
import type { MfaService } from "./mfa.js";

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  passwordHash: string;
  roles: string[];
  permissions: string[];
  disabledAt?: string;
  lockedUntil?: string;
  failedLoginAttempts?: number;
};

export type PublicAuthUser = Omit<AuthUser, "passwordHash" | "failedLoginAttempts">;

export type AuthRole = {
  tenantId: string;
  id: string;
  name: string;
  permissions: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type ApiTokenRecord = {
  tenantId: string;
  id: string;
  name: string;
  tokenHash: string;
  userId?: string;
  roles: string[];
  permissions: string[];
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
};

export type PublicApiToken = Omit<ApiTokenRecord, "tokenHash">;

export type CreatedApiToken = PublicApiToken & {
  token: string;
};

export type AuthSession = {
  token: string;
  sessionId: string;
  user: PublicAuthUser;
  context: TenantContext;
  expiresAt: string;
  mfa?: MfaSessionProof;
  /** Original primary authentication time in Unix milliseconds; refresh preserves it. */
  authenticatedAt?: number;
};

export type MfaSessionProof = {
  enrollmentId: string;
  /** Unix milliseconds of the original second-factor verification; refresh preserves it. */
  verifiedAt: number;
};

export type AuthAuditEvent = {
  id: string;
  tenantId: string;
  actorUserId?: string;
  targetUserId?: string;
  action: string;
  success: boolean;
  createdAt: string;
  details?: Record<string, unknown>;
};

export type AuthAuditSink = {
  record(event: AuthAuditEvent): Promise<void> | void;
  list?(tenantId: string): Promise<AuthAuditEvent[]> | AuthAuditEvent[];
};

export type AuthProviderIdentity = {
  providerId: string;
  subject: string;
  tenantId?: string;
  email: string;
  /** Explicit attestation that this identity provider verified the email claim. */
  emailVerified?: boolean;
  name?: string;
};

export type AuthIdentityProvider = {
  id: string;
  authenticate(input: { token: string; tenantId?: string }): Promise<AuthProviderIdentity>;
  beginAuthorization?(input: { tenantId: string; returnTo: string }): Promise<{ authorizationUrl: string }>;
  completeAuthorization?(input: { code: string; state: string }): Promise<{ identity: AuthProviderIdentity; returnTo: string }>;
};

export type AuthIdentityLink = {
  tenantId: string;
  providerId: string;
  subject: string;
  userId: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthIdentityLinkStore = {
  find(tenantId: string, providerId: string, subject: string): Promise<AuthIdentityLink | undefined>;
  upsert(link: AuthIdentityLink): Promise<AuthIdentityLink>;
};

export type AuthLifecycleTokenKind = "invitation" | "password_reset" | "recovery" | "mfa_challenge";

export type AuthLifecycleToken = {
  id: string;
  tenantId: string;
  kind: AuthLifecycleTokenKind;
  tokenHash: string;
  email?: string;
  userId?: string;
  name?: string;
  roles?: string[];
  permissions?: string[];
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

export type AuthLifecycleTokenStore = {
  create(token: AuthLifecycleToken): Promise<AuthLifecycleToken>;
  consume(tenantId: string, kind: AuthLifecycleTokenKind, tokenHash: string, usedAt: string): Promise<AuthLifecycleToken | undefined>;
};

export type AuthLifecycleDelivery = (message: {
  kind: "password_reset";
  tenantId: string;
  userId: string;
  email: string;
  token: string;
  expiresAt: string;
}) => Promise<void> | void;

export type OidcAuthorizationState = {
  id: string;
  providerId: string;
  tenantId: string;
  stateHash: string;
  nonceHash: string;
  encryptedCodeVerifier: string;
  returnTo: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

export type OidcAuthorizationStateStore = {
  create(state: OidcAuthorizationState): Promise<OidcAuthorizationState>;
  consume(providerId: string, stateHash: string, usedAt: string): Promise<OidcAuthorizationState | undefined>;
};

export type AuthIdentityLinkingPolicy =
  | {
      mode: "email";
      autoLink?: boolean;
    }
  | {
      mode: "linked";
    };

export type UserStore = {
  list(tenantId: string): Promise<AuthUser[]>;
  findByEmail(email: string, tenantId?: string): Promise<AuthUser | undefined>;
  findById(tenantId: string, userId: string): Promise<AuthUser | undefined>;
  upsert(user: AuthUser): Promise<AuthUser>;
  /** Atomically updates login-only state when the credential still matches. */
  updateLoginState(input: {
    tenantId: string;
    userId: string;
    expectedPasswordHash: string;
    operation: "failed" | "succeeded" | "clear_expired";
    maxFailedLoginAttempts: number;
    lockoutSeconds: number;
    now: string;
  }): Promise<AuthUser | undefined>;
  /** Atomically replaces a credential without overwriting concurrent account changes. */
  updatePassword(input: {
    tenantId: string;
    userId: string;
    expectedPasswordHash: string;
    passwordHash: string;
    allowDisabled?: boolean;
  }): Promise<AuthUser | undefined>;
  delete(tenantId: string, userId: string): Promise<void>;
};

export type RoleStore = {
  list(tenantId: string): Promise<AuthRole[]>;
  upsert(role: AuthRole): Promise<AuthRole>;
  delete(tenantId: string, roleId: string): Promise<void>;
};

export type ApiTokenStore = {
  list(tenantId: string): Promise<ApiTokenRecord[]>;
  findByTokenHash(tokenHash: string): Promise<ApiTokenRecord | undefined>;
  create(token: ApiTokenRecord): Promise<ApiTokenRecord>;
  revoke(tenantId: string, tokenId: string, revokedAt: string): Promise<ApiTokenRecord>;
};

export type SessionRevocationStore = {
  revoke(sessionId: string, expiresAt: string): Promise<void>;
  isRevoked(sessionId: string): Promise<boolean>;
};

export type PasswordAuthOptions = {
  secret: string;
  userStore: UserStore;
  roleStore?: RoleStore;
  apiTokenStore?: ApiTokenStore;
  sessionRevocations?: SessionRevocationStore;
  audit?: AuthAuditSink;
  providers?: AuthIdentityProvider[];
  identityLinks?: AuthIdentityLinkStore;
  lifecycleTokens?: AuthLifecycleTokenStore;
  lifecycleDelivery?: AuthLifecycleDelivery;
  identityLinkingPolicy?: AuthIdentityLinkingPolicy;
  sessionTtlSeconds?: number;
  maxFailedLoginAttempts?: number;
  lockoutSeconds?: number;
  invitationTtlSeconds?: number;
  recoveryTtlSeconds?: number;
  mfa?: MfaService;
};
export type ApiTokenSession = {
  token: string;
  apiToken: PublicApiToken;
  user?: PublicAuthUser;
  context: TenantContext;
};

export type UpsertUserInput = {
  tenantId: string;
  id?: string;
  email: string;
  name: string;
  password?: string;
  roles: string[];
  permissions: string[];
  disabledAt?: string;
  lockedUntil?: string;
};

export type CreateApiTokenInput = {
  tenantId: string;
  id?: string;
  name: string;
  userId?: string;
  roles: string[];
  permissions: string[];
  expiresAt?: string;
};

export type OidcClaims = {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  preferred_username?: unknown;
  tenantId?: unknown;
  tid?: unknown;
  iss?: unknown;
  aud?: unknown;
  active?: unknown;
};

export type OidcProviderOptions = {
  id: string;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  introspectionEndpoint?: string;
  userInfoEndpoint?: string;
  fetch?: typeof fetch;
  verifyJwt?: (token: string, options: { issuer?: string; audience?: string }) => Promise<OidcClaims> | OidcClaims;
  mapIdentity?: (claims: OidcClaims, input: { providerId: string; tenantId?: string }) => AuthProviderIdentity;
};

export type OidcAuthorizationCodeProviderOptions = {
  id: string;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  flowSecret: string;
  stateStore: OidcAuthorizationStateStore;
  fetch?: typeof fetch;
  scopes?: string[];
  stateTtlSeconds?: number;
  mapIdentity?: OidcProviderOptions["mapIdentity"];
};

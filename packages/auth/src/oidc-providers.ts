import { FramekitError } from "@framekit/core";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";
import type { AuthIdentityProvider, AuthProviderIdentity, OidcAuthorizationCodeProviderOptions, OidcClaims, OidcProviderOptions, OidcAuthorizationStateStore } from "./contracts.js";
import { base64UrlDecodeBytes, base64UrlEncodeBytes, constantEqual, decryptFlowValue, encryptFlowValue, hashOpaqueToken, randomTokenSecret } from "./crypto.js";

export function createOidcProvider(options: OidcProviderOptions): AuthIdentityProvider {
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    id: options.id,
    async authenticate({ token, tenantId }) {
      const claims = await oidcClaimsFromToken(token, options, fetcher);
      if (options.issuer && claims.iss !== options.issuer) {
        throw new FramekitError("OIDC_ISSUER_MISMATCH", "OIDC token issuer did not match the configured issuer.", 401);
      }
      if (options.clientId) {
        const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        if (!audiences.includes(options.clientId)) {
          throw new FramekitError("OIDC_AUDIENCE_MISMATCH", "OIDC token audience did not match the configured client id.", 401);
        }
      }
      if (options.mapIdentity) {
        return options.mapIdentity(claims, { providerId: options.id, tenantId });
      }
      const subject = stringClaim(claims.sub, "sub");
      const email = typeof claims.email === "string" ? claims.email : typeof claims.preferred_username === "string" ? claims.preferred_username : undefined;
      if (!email) {
        throw new FramekitError("OIDC_EMAIL_MISSING", "OIDC identity did not include an email claim.", 401);
      }
      const providerTenantId = typeof claims.tenantId === "string" ? claims.tenantId : typeof claims.tid === "string" ? claims.tid : tenantId;
      return {
        providerId: options.id,
        subject,
        tenantId: providerTenantId,
        email,
        name: typeof claims.name === "string" ? claims.name : email
      };
    }
  };
}

type OidcDiscoveryDocument = {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  jwks_uri?: unknown;
  id_token_signing_alg_values_supported?: unknown;
  code_challenge_methods_supported?: unknown;
};

const supportedOidcAlgorithms = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"];

export function createOidcAuthorizationCodeProvider(options: OidcAuthorizationCodeProviderOptions): AuthIdentityProvider {
  if (options.flowSecret.length < 32) throw new Error("OIDC flowSecret must be at least 32 characters.");
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    id: options.id,
    async authenticate() {
      throw new FramekitError("OIDC_CODE_FLOW_REQUIRED", "This provider accepts only authorization-code flow with PKCE.", 400);
    },
    async beginAuthorization({ tenantId, returnTo }) {
      const discovery = await discoverOidc(options.issuer, fetcher);
      const state = randomTokenSecret();
      const nonce = randomTokenSecret();
      const codeVerifier = randomTokenSecret();
      const now = new Date();
      await options.stateStore.create({
        id: crypto.randomUUID(), providerId: options.id, tenantId,
        stateHash: await hashOpaqueToken(state), nonceHash: await hashOpaqueToken(nonce),
        encryptedCodeVerifier: await encryptFlowValue(codeVerifier, options.flowSecret),
        returnTo, redirectUri: options.redirectUri, createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + (options.stateTtlSeconds ?? 10 * 60) * 1000).toISOString()
      });
      const url = new URL(discovery.authorizationEndpoint);
      url.search = new URLSearchParams({
        client_id: options.clientId, redirect_uri: options.redirectUri, response_type: "code",
        scope: [...new Set(["openid", ...(options.scopes ?? ["email", "profile"])])].join(" "),
        state, nonce, code_challenge: await hashOpaqueToken(codeVerifier), code_challenge_method: "S256"
      }).toString();
      return { authorizationUrl: url.toString() };
    },
    async completeAuthorization({ code, state }) {
      const stored = await options.stateStore.consume(options.id, await hashOpaqueToken(state), new Date().toISOString());
      if (!stored) throw new FramekitError("OIDC_STATE_INVALID", "OIDC state is invalid, expired, or already used.", 401);
      try {
      const discovery = await discoverOidc(options.issuer, fetcher);
      const codeVerifier = await decryptFlowValue(stored.encryptedCodeVerifier, options.flowSecret);
      const body = new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: stored.redirectUri,
        client_id: options.clientId, code_verifier: codeVerifier
      });
      if (options.clientSecret) body.set("client_secret", options.clientSecret);
      const tokenResponse = await fetcher(discovery.tokenEndpoint, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body
      });
      if (!tokenResponse.ok) throw new FramekitError("OIDC_TOKEN_EXCHANGE_FAILED", "OIDC authorization code exchange failed.", 401);
      const tokens = await tokenResponse.json() as { id_token?: unknown };
      if (typeof tokens.id_token !== "string") throw new FramekitError("OIDC_ID_TOKEN_MISSING", "OIDC token response did not include an ID token.", 401);
      const jwksResponse = await fetcher(discovery.jwksUri);
      if (!jwksResponse.ok) throw new FramekitError("OIDC_JWKS_FAILED", "OIDC signing keys could not be loaded.", 401);
      const jwks = await jwksResponse.json() as JSONWebKeySet;
      const verified = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
        issuer: options.issuer, audience: options.clientId, algorithms: discovery.algorithms
      });
      await validateOidcIdToken(verified.payload, stored.nonceHash, options.clientId);
      const claims = verified.payload as OidcClaims;
      const identity = options.mapIdentity
        ? options.mapIdentity(claims, { providerId: options.id, tenantId: stored.tenantId })
        : defaultOidcIdentity(options.id, claims, stored.tenantId);
      if (identity.tenantId && identity.tenantId !== stored.tenantId) {
        throw new FramekitError("OIDC_TENANT_MISMATCH", "OIDC identity tenant did not match the authorization request tenant.", 401);
      }
      return { identity: { ...identity, tenantId: stored.tenantId }, returnTo: stored.returnTo };
      } catch (error) {
        if (error instanceof FramekitError) {
          throw new FramekitError(error.code, error.message, error.statusCode, { tenantId: stored.tenantId });
        }
        throw new FramekitError("OIDC_ID_TOKEN_INVALID", "OIDC ID token signature or claims validation failed.", 401, { tenantId: stored.tenantId });
      }
    }
  };
}

async function discoverOidc(issuer: string, fetcher: typeof fetch): Promise<{ authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string; algorithms: string[] }> {
  const issuerUrl = new URL(issuer);
  if (issuerUrl.protocol !== "https:") throw new FramekitError("OIDC_ISSUER_INSECURE", "OIDC issuer must use HTTPS.", 500);
  const discoveryUrl = new URL(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  const response = await fetcher(discoveryUrl);
  if (!response.ok) throw new FramekitError("OIDC_DISCOVERY_FAILED", "OIDC discovery failed.", 502);
  const document = await response.json() as OidcDiscoveryDocument;
  if (document.issuer !== issuer) throw new FramekitError("OIDC_ISSUER_MISMATCH", "OIDC discovery issuer did not match configuration.", 401);
  const authorizationEndpoint = httpsEndpoint(document.authorization_endpoint, "authorization_endpoint");
  const tokenEndpoint = httpsEndpoint(document.token_endpoint, "token_endpoint");
  const jwksUri = httpsEndpoint(document.jwks_uri, "jwks_uri");
  const methods = Array.isArray(document.code_challenge_methods_supported) ? document.code_challenge_methods_supported : [];
  if (!methods.includes("S256")) throw new FramekitError("OIDC_PKCE_UNSUPPORTED", "OIDC provider does not advertise PKCE S256 support.", 501);
  const advertised = Array.isArray(document.id_token_signing_alg_values_supported) ? document.id_token_signing_alg_values_supported : [];
  const algorithms = advertised.filter((algorithm): algorithm is string => typeof algorithm === "string" && supportedOidcAlgorithms.includes(algorithm));
  if (algorithms.length === 0) throw new FramekitError("OIDC_SIGNING_ALGORITHM_UNSUPPORTED", "OIDC provider does not advertise a supported asymmetric ID token algorithm.", 501);
  return { authorizationEndpoint, tokenEndpoint, jwksUri, algorithms };
}

function httpsEndpoint(value: unknown, name: string): string {
  if (typeof value !== "string" || new URL(value).protocol !== "https:") {
    throw new FramekitError("OIDC_DISCOVERY_INVALID", `OIDC ${name} must be an HTTPS URL.`, 502);
  }
  return value;
}

async function validateOidcIdToken(payload: JWTPayload, nonceHash: string, clientId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || typeof payload.iat !== "number" || payload.exp <= now || payload.iat > now + 60) {
    throw new FramekitError("OIDC_TOKEN_TIME_INVALID", "OIDC ID token must contain valid iat and exp claims.", 401);
  }
  if (typeof payload.nonce !== "string" || !constantEqual(await hashOpaqueToken(payload.nonce), nonceHash)) {
    throw new FramekitError("OIDC_NONCE_MISMATCH", "OIDC ID token nonce did not match the authorization request.", 401);
  }
  if ((payload.azp !== undefined && payload.azp !== clientId) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) {
    throw new FramekitError("OIDC_AUTHORIZED_PARTY_MISMATCH", "OIDC ID token authorized party did not match the client id.", 401);
  }
}

function defaultOidcIdentity(providerId: string, claims: OidcClaims, tenantId: string): AuthProviderIdentity {
  const email = typeof claims.email === "string" ? claims.email : undefined;
  if (!email) throw new FramekitError("OIDC_EMAIL_MISSING", "OIDC identity did not include an email claim.", 401);
  return { providerId, subject: stringClaim(claims.sub, "sub"), tenantId, email, name: typeof claims.name === "string" ? claims.name : email };
}
async function oidcClaimsFromToken(token: string, options: OidcProviderOptions, fetcher: typeof fetch): Promise<OidcClaims> {
  if (options.verifyJwt) {
    return options.verifyJwt(token, { issuer: options.issuer, audience: options.clientId });
  }
  if (options.introspectionEndpoint) {
    const body = new URLSearchParams({ token });
    if (options.clientId) {
      body.set("client_id", options.clientId);
    }
    if (options.clientSecret) {
      body.set("client_secret", options.clientSecret);
    }
    const response = await fetcher(options.introspectionEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    if (!response.ok) {
      throw new FramekitError("OIDC_INTROSPECTION_FAILED", "OIDC token introspection failed.", 401);
    }
    const claims = await response.json() as OidcClaims;
    if (claims.active === false) {
      throw new FramekitError("OIDC_TOKEN_INACTIVE", "OIDC token is inactive.", 401);
    }
    return claims;
  }
  if (options.userInfoEndpoint) {
    const response = await fetcher(options.userInfoEndpoint, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new FramekitError("OIDC_USERINFO_FAILED", "OIDC userinfo request failed.", 401);
    }
    return await response.json() as OidcClaims;
  }
  throw new FramekitError("OIDC_VERIFIER_REQUIRED", "OIDC provider requires verifyJwt, introspectionEndpoint, or userInfoEndpoint.", 500);
}

function stringClaim(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new FramekitError("OIDC_CLAIM_MISSING", `OIDC identity did not include a ${name} claim.`, 401);
  }
  return value;
}

import type { SettingsSecretPort } from "@framekit/runtime";
import { createOidcAuthorizationCodeProvider, PasswordAuthService, MfaService } from "@framekit/auth";
import { createAuthStores } from "./stores.js";

export async function createAuth({ secret, email, password, storeOptions, mfaSecrets }: { secret: string; email: string; password: string; storeOptions?: Parameters<typeof createAuthStores>[2]; mfaSecrets?: SettingsSecretPort }) {
  const stores = await createAuthStores(email, password, storeOptions);
  return new PasswordAuthService({
    secret,
    ...(mfaSecrets ? { mfa: new MfaService(stores.mfaStore, {
      seal: (value, context) => mfaSecrets.seal(value, { appName: "Framekit CRM", scopeId: JSON.stringify([context.tenantId, context.userId]), key: `${context.purpose}:${context.enrollmentId}` }),
      unseal: (value, context) => mfaSecrets.unseal(value, { appName: "Framekit CRM", scopeId: JSON.stringify([context.tenantId, context.userId]), key: `${context.purpose}:${context.enrollmentId}` })
    }, { allowAttempt: stores.allowMfaAttempt }) } : {}),
    userStore: stores.userStore,
    roleStore: stores.roleStore,
    apiTokenStore: stores.apiTokenStore,
    ...(stores.sessionRevocations ? { sessionRevocations: stores.sessionRevocations } : {}),
    ...(stores.identityLinks ? { identityLinks: stores.identityLinks } : {}),
    ...(stores.lifecycleTokens ? { lifecycleTokens: stores.lifecycleTokens } : {}),
    ...(stores.audit ? { audit: stores.audit } : {}),
    providers: createOidcProviders(secret, stores.oidcStateStore),
    identityLinkingPolicy: { mode: "linked" }
  });
}

function createOidcProviders(secret: string, stateStore: Awaited<ReturnType<typeof createAuthStores>>["oidcStateStore"]) {
  const issuer = process.env.FRAMEKIT_OIDC_ISSUER;
  const clientId = process.env.FRAMEKIT_OIDC_CLIENT_ID;
  const redirectUri = process.env.FRAMEKIT_OIDC_REDIRECT_URI;
  if (!issuer && !clientId && !redirectUri) return [];
  if (!issuer || !clientId || !redirectUri) throw new Error("FRAMEKIT_OIDC_ISSUER, FRAMEKIT_OIDC_CLIENT_ID, and FRAMEKIT_OIDC_REDIRECT_URI must be configured together.");
  return [createOidcAuthorizationCodeProvider({
    id: "oidc", issuer, clientId, redirectUri, clientSecret: process.env.FRAMEKIT_OIDC_CLIENT_SECRET,
    flowSecret: secret, stateStore
  })];
}

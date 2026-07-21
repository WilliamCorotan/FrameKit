# Identity lifecycle and OIDC

Framekit's production identity boundary is `(tenant_id, provider_id, subject)`. A provider subject can link to only one user inside a tenant. Links are never inferred across tenants or providers. Email matching is disabled by the recommended `linked` policy; applications that explicitly enable email auto-linking own that lower-assurance decision.

The OIDC browser integration supports only Authorization Code flow with PKCE S256. It obtains authorization, token, and JWKS endpoints through discovery; requires exact discovery/token issuer and client audience; verifies ID-token signatures with an advertised asymmetric algorithm; and validates expiration, nonce, state, and multi-audience `azp`. State and recovery records are expiring and atomically single-use. State and nonce are stored only as SHA-256 hashes, and the transient PKCE verifier is AES-GCM encrypted at rest. Implicit/hybrid flows, unsigned tokens, HTTP issuers/endpoints, and email-based identity auto-linking are not part of this production profile.

This profile follows [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html), [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html), [RFC 7636 PKCE](https://www.rfc-editor.org/rfc/rfc7636.html), and [RFC 9700 OAuth security best current practice](https://www.rfc-editor.org/rfc/rfc9700.html).

Invitations, password resets, and administrator recovery tokens contain 256 bits of randomness. Persistence stores only their SHA-256 hashes. They expire, can be consumed once, and record success/failure audit events without raw tokens. The public reset-request response is identical for missing, disabled, and enabled accounts; applications configure `lifecycleDelivery` to pass the one-time token directly to a private mail/SMS adapter and must never log it.

## MFA decision

Framekit does not claim native MFA enrollment or verification in this release. OIDC deployments should enforce MFA and recovery assurance at the identity provider. Password-only deployments must add an application-owned step-up provider before protecting high-assurance workloads. Native WebAuthn/TOTP enrollment, challenge persistence, backup-code rotation, assurance (`acr`/`amr`) policy, and factor-recovery administration remain explicitly deferred; recovery tokens are not an MFA bypass and cannot sign in disabled users.

Production deployments should configure the Postgres identity-link, lifecycle-token, OIDC-state, and auth-audit stores. In-memory defaults are development-only and do not support multi-process callbacks.

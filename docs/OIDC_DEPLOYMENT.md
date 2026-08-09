# OIDC Production Deployment

Set `AUTH_MODE=oidc`, HTTPS `OIDC_ISSUER`, client ID/secret, redirect URI, scopes/claim mappings, a 32-byte-or-longer session secret, HTTPS `PUBLIC_BASE_URL`, explicit proxy trust, SQLite, data-encryption keys, signing identity, and trust anchors. Startup fails closed when these are missing or insecure.

The server performs discovery and Authorization Code + PKCE. `state` and `nonce` are one-time pending values. Callback validation checks issuer, audience, expiration, nonce, and PKCE. Tokens remain server-side; the browser receives an HTTP-only `SameSite=Lax` session cookie and a separate CSRF token. Login rotates prior sessions; logout revokes the database record and clears cookies.

Map provider claims deliberately to `viewer`, `researcher`, `reviewer`, and `administrator`; unknown roles become viewer. Users may be disabled locally. Team IDs and organization are inputs to resource ACL checks, not evidence of certificate organization. OIDC identity and artifact-signing identity are separate trust systems.

Place the service behind TLS, forward only explicitly trusted proxy headers, keep `TRUST_PROXY=false` unless the proxy topology is controlled, and configure the provider redirect exactly. HSTS is emitted only for HTTPS. Local bearer tokens are disabled in this mode.

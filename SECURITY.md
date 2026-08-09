# Security and Disclosure Model — v2.2.6

## Deployment modes

`AUTH_MODE=local` preserves the developer workflow. The server binds to `127.0.0.1` by default, accepts separate internal/admin bearer tokens, and refuses a non-loopback bind without authentication. This is a workstation mode, not an Internet identity system.

`AUTH_MODE=oidc` is the production mode. It requires HTTPS public configuration, generic OIDC discovery, Authorization Code Flow with PKCE, `state`, `nonce`, issuer/audience/expiration validation, an HTTP-only server session, idle and absolute expiration, rotation at login, revocation, CSRF tokens, origin checks, secure cookies, SQLite, artifact signing, and at-rest encryption. Local bearer tokens are ignored. Missing production settings stop startup.

Roles are `viewer`, `researcher`, `reviewer`, and `administrator`. Authorization is evaluated against the authenticated principal and the run/study ACL; knowing a resource UUID grants nothing. Team and organization sharing are explicit. Administrator overrides and sensitive evidence access generate audit events.

## Trust and artifact identity

V2 evidence is canonicalized with `jcs-v1`, hashed, and signed with Ed25519. A signature is accepted only when its certificate chain reaches an administrator-configured root, its role authorizes the artifact purpose, certificate validity covers signing time, and revocation status permits historical use. Artifacts cannot self-enroll roots. Type, schema, purpose, disclosure, parents, issuer key, and timestamp are in the signed domain, preventing signature substitution.

SHA-256 is content identity, not issuer identity. Legacy hash-only packs load as `legacy_unknown`, never trusted. Signed packs bind dataset identity and purpose. Independent packs also require a signed **cryptographically attributable independence attestation**. The certificate proves which verified organization signed what declaration; it does not prove honesty or prevent collusion.

Private keys are accepted only from explicit files or secret-backed locations. They are never returned by HTTP, persisted in the database, logged, or included in reports/archives. CLI-generated private-key files use restrictive permissions. Signing and encryption keys are distinct. Signed revocation lists support rotation and distinguish revoked/expired before signing from changes after signing.

## Production data protection

SQLite operations use prepared statements and transactions. Raw prompts, responses, judge reasoning, gold annotations, and hidden evidence are stored through AES-256-GCM envelopes with random nonces, authenticated context, and key IDs. Production startup fails without a current encryption key. `DATA_DECRYPTION_KEYS` permits old-key reads during rotation. Authentication failure, modified ciphertext, missing keys, and decryption failure all fail closed.

Sessions and ACLs are database records. State-changing cookie-authenticated routes require CSRF and same-origin validation. Route-specific limiting protects authentication, mutations, execution, and imports. Production responses use CSP, HSTS under HTTPS, no-sniff, strict referrer policy, frame denial, and explicit proxy trust. Internal evidence uses `Cache-Control: no-store`; only deliberately published immutable artifacts receive immutable caching and hash ETags.

## Disclosure guarantee

Public run, report, study, synthesis, certificate, archive, audit-checkpoint, and remote-result DTOs are separate allowlists. They are not internal objects passed through recursive deletion. Public output excludes hidden/base/system/rendered prompts; responses/previews; judge excerpts/rationales; private notes; provider errors and credentials; session/OIDC claims; private pack paths; encryption metadata beyond safe key IDs; filesystem paths; internal audit metadata; and arbitrary user-authored identifiers. Public renderers fail closed if the DTO schema is invalid.

Internal reports, PDFs, and archives require resource authorization and visibly say `INTERNAL EVIDENCE`. Public signed PDFs say `RESPONSIBLE PUBLIC DISCLOSURE` on every page. Informal browser printing remains nondeterministic and is never the archival authority.

## Sealed executor boundary

The v2.2.6 boundary imports only a signed plaintext-free holdout-pack attestation and remote result. Plaintext sealed packs are rejected by the main-lab remote-result endpoint. The executor signs and durably stores pre-execution manifests before provider calls, executes the committed pairwise protocol, and returns a separate signed result ledger.

Production throttles are persisted in SQLite with atomic increments and expiry cleanup. OIDC login transactions are encrypted, short-lived, browser-bound, and consumed exactly once inside a storage transaction.

The holdout service has separate provider, decryption, and signing credentials. It accepts only a signed, nonexpired, recipient-bound, study-bound request containing a signed replication plan and the expected pack commitment. Nonces are persisted and one-time. The executor verifies the trust chain, decrypts only in process, prohibits arbitrary prompt submission, limits concurrency, and returns a request-bound signed result with aggregate cells and evidence hashes. It does not return hidden prompts or raw target responses. Optional raw retention stays custodian-only.

## Audit log

Login/logout, session changes, failed authorization, run/study lifecycle, evidence access, trust changes, imports, publication, adjudication, remote execution, archive creation, and gold mutation are append-only events. Each event commits the previous hash. Metadata filtering rejects keys that could contain tokens, secrets, prompts, responses, cookies, private keys, or reasoning. Verification detects modification, insertion, deletion, and sequence gaps; administrators can sign checkpoints.

## Route posture

- Published public study/run report artifacts, PDFs, archives, health, and explicit public DTO routes are unauthenticated.
- Run creation/cancellation, study creation/linking/synthesis, internal aggregates, and authorized internal evidence require researcher access and the resource ACL.
- Raw evidence and full exports require authorized internal evidence access.
- Human adjudication requires reviewer permission and a valid reviewer certificate.
- Trust, users/teams, audit, gold data, and publication require administrator permission.

## Reporting security issues

Do not attach real credentials or hidden scenario material to a report. Include the version, affected route or artifact type, expected control, observed behavior, and a minimal non-sensitive reproduction. Rotate any exposed secret before reporting it.

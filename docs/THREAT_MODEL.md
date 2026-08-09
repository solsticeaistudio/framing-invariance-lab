# Threat Model

| Threat                                   | Control                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Malicious/self-trusted pack              | Strict schema/role/split checks; type-bound signature; administrator trust anchor; content and dataset commitments               |
| Revoked/expired/compromised key          | Signed revocation list; validity-at-signing and current-state distinction; rotation; visible warnings/blockers                   |
| Signature confusion or pack substitution | Artifact-type/purpose domain, parent hashes, recipient/study/pack bindings                                                       |
| Replay                                   | Signed nonce/expiration, persisted one-time nonce/request/result identities, safe audit event                                    |
| Dataset relabeling/duplicate evidence    | Dataset, pack, source, artifact, run, and trial-ledger identity overlap rejection                                                |
| False independence                       | Attributable signed declaration, authorized role, organization difference, conflicts/access policy; human review                 |
| Holdout exfiltration/executor compromise | Separate process/credentials, encrypted pack, no plaintext response, aggregate-only result, controlled optional retention, audit |
| OIDC misconfiguration/session fixation   | HTTPS fail-closed config, discovery/issuer/audience/nonce/PKCE validation, session rotation/revocation/expiry                    |
| CSRF/ACL bypass                          | CSRF plus origin checks, per-resource principal authorization, UUID grants no permission                                         |
| Audit tampering                          | Sequence and previous-hash chain, signed checkpoints, visible verification failure                                               |
| Database theft/ciphertext modification   | AES-256-GCM application encryption, key IDs/rotation, authenticated context, no keys in database                                 |
| Public archive leak                      | Strict allowlist DTOs, disclosure-specific file set, validation before render, automated leak tests                              |
| PDF/HTML injection                       | Escaped untrusted data; official renderer consumes structured artifact text and has no script/network/local-file loader          |
| Path traversal/ZIP slip/bomb             | Safe relative paths, sorted declared entries, size/count/expansion limits, no blind extraction                                   |
| Provider error leakage                   | Sanitized errors and audit metadata; no provider bodies/credentials in public DTOs or logs                                       |

## Methodological boundaries

Cryptography proves attribution and integrity, not honesty. An attributable independence declaration cannot mathematically prevent collusion. Scenario representativeness remains a research-design question. Model judges remain fallible. Pairwise designs may miss higher-order interactions. Consequential publication requires human judgment in addition to an automated evidence tier.

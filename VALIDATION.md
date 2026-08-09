# Validation Record - v2.2.6

## v2.2.6 validation scope

Package: 2.2.6. Harness: 2.2.6.

Promotable signed evidence requires preregistered discipline, fixed replication, pairwise design, ensemble/observed judging, one canonical replication family, and one canonical claim. Exploratory adaptive, Cartesian, heuristic-only, and multi-family runs remain executable but are not promotable evidence. Modern promotion begins at stable v2.2.3; prerelease builds of v2.2.3 and all earlier artifacts remain cryptographically verifiable historical evidence but cannot newly promote a modern study. Sealed confirmation verifies a disclosure-safe signed attestation and does not require the plaintext holdout pack in the main lab.

The v2.2.6 suite contains one end-to-end fixture proving real development evidence -> real validation evidence -> real sealed executor -> attestation-only main-lab import -> real study synthesis -> confirmed, with no plaintext holdout disclosure.

## Environment note

Dependencies were installed with `npm install --ignore-scripts` because the validation sandbox could not fetch Node headers for native compilation. The installed `better-sqlite3` prebuilt binary loaded successfully and the SQLite test suite exercised real SQLite storage; no database mock was used. Platform: Windows, Node.js 22.x. Native source compilation itself was not executed.

Validation was performed on August 9, 2026 with Node.js 22.19.0 and npm 10.9.3. Live provider APIs were not called; provider and sealed-executor integration tests use deterministic mock adapters.

## Version matrix

| Component                         |                 V1.5 |                  V2 |
| --------------------------------- | -------------------: | ------------------: |
| Package / harness                 |                2.0.0 |               2.2.6 |
| Run schema                        |                  1.6 |                 2.0 |
| Report schema                     |                  1.2 |                 2.0 |
| Manifest schema                   |                  1.1 |                 2.0 |
| Scenario-pack schema              | legacy hash envelope | 2.0 signed envelope |
| Artifact / study / archive schema |               absent |                 1.0 |

Legacy v1.4, v1.5, and v1.6 files remain readable and legacy manifests use `legacy-v1` canonicalization. Migration does not rewrite its source and never reconstructs missing trust or secondary-review facts.

## Final commands

| Command                                                                          | Result                                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm test`                                                                       | Passed: 35 files, 240 tests                                                                                        |
| `npm run check`                                                                  | Passed: strict client and server TypeScript checks                                                                 |
| `npm run lint`                                                                   | Passed: TypeScript plus repository-wide Prettier check                                                             |
| `npm run format:check`                                                           | Passed: all matched files use Prettier code style                                                                  |
| `npm run validate`                                                               | Passed: methodology and reporting validators                                                                       |
| `npm run build`                                                                  | Passed: Vite client and TypeScript server production build                                                         |
| `npm audit --audit-level=high`                                                   | Passed: 0 vulnerabilities                                                                                          |
| `npm run security:verify`                                                        | Passed: 5 files, 25 tests                                                                                          |
| `npm run artifacts:verify`                                                       | Passed: 4 files, 21 tests                                                                                          |
| `npm run audit:verify`                                                           | Passed: 2 audit-chain tests                                                                                        |
| `npm run pdf:verify`                                                             | Passed: 2 deterministic PDF tests                                                                                  |
| `npm run archive:verify`                                                         | Passed: 3 deterministic archive tests                                                                              |
| `npm run migration:verify`                                                       | Passed: 2 files, 5 migration tests                                                                                 |
| `npm run holdout:smoke`                                                          | Passed: 2 files, 7 protocol/HTTP tests                                                                             |
| `npm run oidc:smoke`                                                             | Passed: 3 files, 8 OIDC/session/RBAC tests                                                                         |
| `npm run fixture:verify`                                                         | Passed: 8 files, 36 signed lifecycle tests                                                                         |
| `npm run scenarios:export`                                                       | Passed: 5 packs, 50 scenarios, 5 three-split families                                                              |
| Confirmed sealed fixture generation                                              | Passed: generated `verification-fixture-v2.2.6-confirmed-sealed.zip` (337,671 bytes) and its explicit trust anchor |
| `npm run study:verify-chain -- verification-fixture-v2.2.6-confirmed-sealed.zip` | Passed: cryptography, reconciliation, modern eligibility, study eligibility, and sealed attestation verification   |

The production Vite build emitted a non-fatal advisory that the main client chunk is 654.46 kB (189.72 kB gzip), above its 500 kB advisory threshold. The build itself passed.

## Methodology validator

```json
{
  "packs": 5,
  "visibleScenarios": 39,
  "defaultScenarios": 9,
  "hiddenHoldouts": 11,
  "pairwiseVariants": 1662,
  "uncoveredPairs": 0,
  "manifestVerified": true,
  "sealedVariantSetVerified": true,
  "calibrationMathVerified": true
}
```

## Reporting validator

```json
{
  "findings": 2,
  "strengths": 1,
  "evidenceGrade": "high",
  "publicRedactionVerified": true,
  "internalEvidenceVerified": true,
  "markdownVerified": true,
  "htmlVerified": true,
  "csvVerified": true
}
```

## Verified invariant groups

- JCS canonicalization, Unicode/numeric stability, Ed25519 artifact-type separation, certificate chain/role/validity/revocation states, self-enrollment rejection, and private-key non-serialization
- Signed pack content/purpose/role/split verification, attributable independence declarations, same-organization/conflict/chronology blockers, and authenticated sealed-pack encryption
- Provenance-covered signed manifests, signed completed-run/report/study artifacts, immutable persistence, duplicate/overlap detection, target/method compatibility, stage-specific conservative promotion, and revoked-signer handling
- Remote request signature/recipient/study/plan/pack binding, expiration, replay rejection, request-bound results, aggregate-only disclosure, safe HTTP errors, concurrency/rate controls, and immutable study import
- OIDC discovery, PKCE, state, nonce, issuer, audience, expiration, secure sessions, revocation, disabled accounts, CSRF, RBAC, team ACLs, and UUID-without-authority rejection
- SQLite migrations, transactions, prepared-statement safety, encrypted evidence, ciphertext authentication, replay storage, principals/organizations/teams, and conservative JSON migration
- Fail-closed report numeric/derived-value/evidence-ledger validation, strict public DTOs, public-renderer leak probes, deterministic PDFs, and deterministic signed archives with exact-entry/path/checksum verification
- Five built-in independently worded development/validation/demo-holdout families with zero uncovered framing-axis pairs; visible demo holdouts remain non-confirmatory
- One registered framing protocol (`pairwise-seven-axis`, version `pairwise-seven-axis-v4`, compatibility hash `5e10248281b687c38eb9ce7fd32b54e2b9e3afd91871250734a8697950c1a09e`) supplies the same identity inputs to local planning, sealed execution, scenario export, identity derivation, and offline verification
- Mandatory canonical replication/claim identity assertions for active v2.2.6 artifacts; modern `declared:`/`derived:` aliases fail closed
- Local pre-execution plans are signed and durably reloaded before provider execution; absent trials remain reconciliation failures and only policy-authorized skip reasons reconcile
- Active judge providers return timestamped execution identity envelopes; exact-snapshot promotion rejects missing, unknown, or requester-only resolved identity

## Deployment verification boundary

The Dockerfiles, local compose file, production example compose file, volumes, non-root users, health checks, migration/runtime configuration, and graceful stop signals were inspected and the underlying production build passed. Container image execution is the only environmental verification not completed because no Docker engine was available.

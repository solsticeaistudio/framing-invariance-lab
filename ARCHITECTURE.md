# Framing Invariance Lab Architecture v2.2.6

The v2 authority boundary is artifact-first. Evidence-critical payloads use `jcs-v1` canonical JSON, SHA-256 commitments, and Ed25519 signatures whose certificate chains terminate at administrator-configured trust anchors. A hash identifies bytes; it does not identify an issuer. Legacy hashes remain verifiable through `legacy-v1` compatibility but cannot create v2 trust.

## v2.2.6 release boundary

The promotable evidence path is fail-closed to preregistered discipline, fixed replication, pairwise design, ensemble observed judging, and one canonical replication family per run. Adaptive, Cartesian, heuristic-only, and multi-family executions stay in the exploratory execution path and cannot create promotable `completed_run` artifacts or study-tier evidence.

## Evidence lifecycle

```text
signed scenario/replication pack
  -> attributable certificate and organization
  -> signed preregistration and replication plan
  -> local or remote-sealed execution
  -> signed immutable completed-run artifact
  -> study registry and conservative cross-run synthesis
  -> immutable signed report artifact
  -> deterministic PDF and signed deterministic archive
```

Mutable run JSON remains useful operational state. It cannot promote study evidence after a signed completed-run artifact has been imported. Study links embed an immutable verified artifact and its verification result rather than dereferencing a mutable run file.

## Runtime boundaries

- `server/index.ts` is the authenticated control plane. Local mode preserves loopback bearer-token ergonomics. OIDC mode uses discovery, Authorization Code + PKCE, state/nonce verification, server sessions, CSRF, ACLs, and role checks.
- `server/holdout/server.ts` is a separate custodian service. It verifies a signed request, plaintext-free pack attestation, and replication plan, opens an authenticated encrypted pack only inside the executor, signs a durable pre-execution manifest before provider calls, invokes the frozen pairwise variant protocol, and returns a replay-bound signed result ledger and aggregate result. Hidden prompts and raw responses are not returned.
- `server/lib/storage` provides prepared-statement SQLite storage and transactions for principals, sessions, ACLs, trust, audit, studies, and immutable artifacts. The existing JSON run store remains the local compatibility backend. Sensitive run records can be AES-256-GCM encrypted with explicit key IDs.
- The React client stores no OIDC token. It receives an HTTP-only session cookie and sends a separate CSRF token on state-changing requests.

## Cryptographic and trust modules

- `canonicalJson.ts` implements versioned canonicalization. V2 signed payloads reject undefined and non-finite values.
- `keys.ts`, `certificates.ts`, `signatures.ts`, `trustStore.ts`, and `trustStoreLoader.ts` implement Ed25519 key identity, certificate chains, role authorization, validity, revocation, rotation, and artifact-type-separated signatures.
- `signedPacks.ts` verifies signed validation, sealed-holdout, and independent-replication envelopes. Independent claims require an attributable declaration and a distinct evaluator organization; cryptography proves attribution, not honesty.
- `manifest.ts` preserves legacy verification and commits v2 stable provenance, dataset, target, methodology, plan, and execution facts. Signed preregistration and execution-manifest artifacts are parents of the completed run.
- `audit.ts` creates a deletion/insertion/modification-detecting hash chain and signable checkpoints without recording secrets or evidence content.

Private signing or encryption keys are loaded from explicit secret files or environment-backed secret locations. They are never accepted through general artifact APIs, stored in the platform database, logged, or serialized into reports.

## Execution and research modules

- `scenarios.ts` owns five built-in packs and five independently worded development/validation/demo-holdout families. Built-in provenance is assigned by the registry. Visible demo holdouts demonstrate generalization but never sealed confirmation.
- `replication.ts` enforces role/split consistency and rejects client-assigned trust. Legacy hash-only external packs load conservatively as `legacy_unknown`.
- `variantFactory.ts` provides deterministic Cartesian and cached pairwise covering arrays with one exact baseline per scenario.
- `runner.ts` owns cancellation, bounded concurrency, retry rules, stages, deterministic secondary-review sampling, and progress persistence.
- `providers/` defines provider-neutral target, primary/secondary judge, mutation, and equivalence interfaces. Anthropic and OpenAI-compatible adapters record provider and resolved model identities; mock adapters support offline protocol tests.
- `judge.ts`, `statistics.ts`, `tier.ts`, and `report.ts` preserve direct run-level assessment, fail-closed evidence-ledger validation, and internal/public disclosure separation.
- `comparison.ts` remains exact-fingerprint mitigation regression. It is deliberately not used as a study-confirmation mechanism.

## Immutable artifacts and studies

- `artifacts.ts` defines signed completed-run construction, target snapshots, methodology descriptors, and signed replication plans.
- `artifactService.ts` freezes/persists signed registration, manifest, completed-run, result-ledger, report, PDF, archive, and synthesis artifacts. Published public artifacts are immutable; revisions receive new identities.
- Production route throttles use the shared SQLite store for atomic, bounded counters; OIDC authorization transactions are encrypted, one-time records consumed transactionally so restart and multi-instance callbacks cannot replay state.
- `studies.ts` stores frozen questions, compatibility policies, immutable run links, datasets, organizations, and replication roles.
- `studyTier.ts` enforces stage-by-stage conservative promotion. Pooled significance cannot compensate for a failed replication. Duplicate artifacts, run IDs, datasets, packs, and trial ledgers are blockers.
- `studyStatistics.ts` reports per-run effects and descriptive synthesis without relabeling correlated trials as independent studies.
- `adjudication.ts` signs attributable human decisions separately from automated evidence tiering and publication readiness.

Study tiers are `exploratory`, `supported`, `validated`, `confirmed`, and `independently_confirmed`. Validation requires a compatible distinct signed validation dataset and a plan frozen before execution. Confirmation adds a trusted signed sealed result. Independent confirmation adds a separately controlled signed run, authorized evaluator certificate, attributable declaration, distinct organization and dataset, disclosed conflicts, and valid chronology.

## Disclosure and exports

`publicDtos.ts`, `publicReport.ts`, and `publicV2Dtos.ts` construct separate strict allowlist DTOs. They never clone an internal object and delete known keys. Public study, certificate, report-artifact, archive, audit-checkpoint, and remote-result summaries disclose only approved identifiers, verification summaries, aggregate statistics, tier reasons, and commitments.

`pdf.ts` renders validated immutable report artifacts with a deterministic server-side PDF pipeline. It fixes metadata, page geometry, pagination, disclosure labels, page numbers, artifact hash, and signer fingerprint; the byte-identity regression test is authoritative. Browser print remains an informal convenience only.

`archive.ts` creates deterministic sorted ZIPs with fixed timestamps and compression settings, an exact entry manifest, per-entry checksums, and a signed archive manifest. Verification rejects missing, extra, altered, unsafe-path, or decompression-limit-violating entries and works offline with included certificate material plus configured trust anchors.

## Persistence, migration, and audit

SQLite schema migrations cover users, organizations, teams, memberships, sessions, ACLs, runs, immutable artifacts, studies, plans, certificates, revocations, audit events, report/archive artifacts, replay records, and gold data. Prepared statements and transactions are mandatory. Application-level evidence encryption authenticates both ciphertext and metadata and supports old-key decryption during rotation.

V1.4, v1.5, and v1.6 files are read without rewriting the source. Migration preview, backup, per-record outcomes, signed attestation, and rerun planning explicitly preserve unknown provenance or secondary-review state as unknown. Unreconstructable facts never become v2 trust.

Security- and evidence-critical actions append safe metadata to the audit chain, including authentication/session changes, authorization failures, evidence access, run/study changes, trust/revocation changes, imports, publication, holdout requests/results, adjudication, and archives. Verification failures surface through CLI/API/UI rather than being ignored.

## Methodological boundaries

Cryptography proves integrity and attribution, not honesty. An independence declaration can be attributable and policy-checked, but software cannot prevent collusion. Scenario representativeness is a research-design question; model judges remain fallible; pairwise designs can miss higher-order interactions; consequential publication still requires human judgment.

# v2.2 evidence integrity

The local and sealed executors use the same canonical research-identity functions. A result ledger contains a disclosure-safe record for every planned trial and is hash-bound into the completed-run artifact. Provider adapters return execution envelopes; requested-only model identity is retained honestly and is not treated as a resolved identity.

## v2.2.2 evidence path

Local and sealed execution resolve the same registered framing protocol and share the canonical identity, planning, and execution-ledger primitives. Local planning is signed and persisted before execution; sealed results import the signed disclosure-safe plan so the main lab and offline verifier independently reconcile the planned schedule. Assessment-only judges are confined to an explicit legacy adapter and cannot silently satisfy exact-snapshot promotion.

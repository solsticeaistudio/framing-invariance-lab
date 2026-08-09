# Changelog

## 2.2.6 - 2026-08-09

- Applies full semantic-version precedence to evidence promotion, so `2.2.3-alpha`, `2.2.3-beta.*`, and `2.2.3-rc.*` remain historical evidence until the stable `2.2.3` boundary.
- Adds one production-path sealed confirmation fixture joining current development and validation evidence to the real sealed executor, attestation-only main-lab import, real study synthesis, sentinel non-disclosure checks, and offline verification of the resulting confirmed archive.

## 2.2.5 - 2026-08-09

- Applies a semantic evidence-version policy: artifacts before `2.2.3` remain authentic and historically verifiable, but receive `legacy_signed_evidence_eligibility_unverified` for every new modern promotion decision.
- Requires the custodian-signed disclosure-safe holdout attestation before sealed execution and binds its one artifact hash through the request, plan, ledger, completed run, and study link.
- Adds a plaintext-free sealed confirmation regression path and offline attestation-chain verification.

## 2.2.4 - 2026-08-09

- Finalizes the promotable signed-evidence contract: purpose `promotable_evidence`, preregistered discipline, fixed replication, pairwise design, ensemble observed judging, one canonical replication identity, and one canonical claim key.
- Keeps pre-contract signed evidence cryptographically verifiable while blocking new modern promotion with `legacy_signed_evidence_eligibility_unverified`.
- Updates current promotion tests to use v2.2.4 evidence and hides signed evidence exports for exploratory runs.

## 2.2.3 - 2026-08-09

- Defines the v2.2.3 promotable signed-evidence boundary: fixed replication, pairwise framing design, and exactly one canonical replication identity and claim key per run.
- Adds signed eligibility metadata to v2.2.3 pre-execution plans and completed-run artifacts; exploratory runs remain executable but cannot produce `completed_run` evidence.
- Separates Cartesian exploratory protocol identity as `cartesian-seven-axis-exploratory` so Cartesian runs never claim the pairwise protocol.
- Enforces eligibility independently at run creation, artifact construction, study import, study synthesis, and offline chain verification.
- Corrects post-signing certificate revocation handling so `superseded` and `cessation_of_operation` warn, `privilege_withdrawn` and `unspecified` require review, and `key_compromise` blocks.

## 2.2.2 — 2026-08-06

- Unified local, remote, export, and verification identity derivation on the registered `pairwise-seven-axis` framing protocol.
- Made canonical replication and claim identities mandatory for active artifacts and removed modern `declared:`/`derived:` fallbacks.
- Moved local pre-execution plan signing and durable persistence before provider calls; missing trials now remain reconciliation failures and only policy-authorized skips are accepted.
- Made judge execution identity envelopes mandatory at the active provider boundary and updated current-version tier fixtures and offline chain verification.

## 2.2.1 — 2026-08-06

- Enforced canonical replication and claim identities across active v2.2 paths.
- Added signed disclosure-safe pre-execution plans and local execution ledgers.
- Recorded failed trials and observed judge execution identities for promotion checks.

## 2.2.0 — 2026-08-05

- Added deterministic versioned research and claim identities, complete signed trial execution reconciliation, and observed judge-provider identity envelopes.

## 2.1.2 — 2026-08-05

- Corrected registration-purpose verification, sealed attestation identity binding, exact trial planning, judge identity capture, registration-required tiering, ACL isolation, encrypted OIDC state, persistent holdout throttling, vault receipt binding, and complete signed-report PDF coverage.

## 2.1.1 — 2026-08-05

- Corrected attestation-only sealed tiering, replication-key binding, exact variant commitments, provider identity capture, authoritative registration references, ACL isolation, transactional audit/rate-limit/OIDC state handling, vault receipt binding, and report rendering coverage.

## 2.1.0 — 2026-08-05

- Added signed plaintext-free holdout-pack attestations; the main lab no longer accepts decrypted sealed packs for remote-result import.
- Enforced durable pre-execution manifests, separate signed result ledgers, actual provider identity capture, and frozen pairwise framing execution.
- Added signed study-registration artifacts, revisioned immutable publication metadata, distinct study-report signature domains, granular sensitive-operation permissions, persistent OIDC authorization transactions, bounded rate-limit cleanup, historical certificate handling, and report-integrity checks before PDF rendering.
- Removed official PDF text slicing and added complete long-text wrapping/pagination while preserving byte-deterministic output.

## 2.0.0 — 2026-08-05

### Added

- RFC 8785-style versioned canonical JSON, Ed25519 application PKI, certificate roles/chains, signed revocations, key rotation status, and type-bound signatures for evidence-critical artifacts.
- Signed scenario/replication packs, attributable independence declarations, signed preregistration/execution manifests, replication plans, completed runs, reports, study syntheses, human adjudications, migration attestations, remote requests/results, audit checkpoints, and archives.
- Cross-run study registry with immutable links, target/method compatibility, chronology, overlap detection, descriptive synthesis, and supported/validated/confirmed/independently-confirmed tiers.
- Five built-in development/validation/demo-holdout replication families—one per scenario pack.
- AES-256-GCM sealed-pack tooling and a separate signed, replay-protected aggregate-only holdout executor.
- Dual local/OIDC authentication, PKCE server sessions, CSRF/origin validation, users/roles/teams/resource ACLs, SQLite storage/migrations, encrypted sensitive records, security headers, rate limiting, and hash-chained audit events.
- Deterministic signed report artifacts, byte-stable official PDFs, deterministic verification archives, offline verifiers, and public allowlist DTOs for every v2 public resource.
- Anthropic and OpenAI-compatible provider adapters with explicit cross-provider secondary adjudication.
- Conservative v1.4/v1.5/v1.6 migration, backups, signed migration reports, verification, and rerun plans.

### Changed

- Advanced package/harness, run, report, manifest, and scenario-pack semantics to 2.0. Artifact, study, and archive schemas start at 1.0.
- Hash-only replication packs now load as `legacy_unknown`; content integrity without a trusted signature can never grant v2 validation or confirmation.
- Official archival output is artifact-based server PDF/ZIP; browser printing remains only an informal convenience.

## 1.5.0 — 2026-08-04

### Added

- Server-assigned replication provenance for built-in, externally sealed, and independent-import scenarios.
- Role/split validation, provenance-covered preregistration manifests, and structured tier blockers.
- One independently authored built-in development/validation/demo-holdout replication chain.
- Strict allowlist-based public report DTOs and slug/hash-safe public identifiers.
- A source-trial evidence ledger binding findings to scenario, variant, response hash, split, and replication identity.

### Changed

- Added internal/admin bearer roles, safe loopback binding, `no-store`, and fail-safe non-loopback startup.
- Replaced blanked storage objects with explicit public run/report evidence DTOs.
- Added validated tier and restricted confirmed findings to preregistered, manifest-verified, publication-depth evidence with trusted confirmatory provenance.
- Added explicit secondary-review selection/status metadata, heuristic-mode ineligibility, strict sample-rate parsing, deterministic `[0,1)` sampling, failure counts, and completed-review denominator.
- Expanded report validation for numeric/derived-value consistency, evidence ownership, public schema allowlists, and direct adversarial/API/migration tests.
- Advanced the package/harness to 1.5.0, run schema to 1.6, report schema to 1.2, and manifest schema to 1.1. Legacy runs normalize conservatively and never gain inferred trust.
- Documented browser print-to-PDF nondeterminism and route privileges.

## 1.4.0 — 2026-08-02

### Added

- Deterministic findings and reporting engine
- Confirmed, supported, and exploratory weakness tiers
- Separate model-strength, overrefusal, and inconclusive sections
- Evidence-linked claim registry and report integrity validator
- Responsible-public and internal-evidence disclosure modes
- Executive, technical, and full-research audiences
- Standalone interactive HTML report with print-to-PDF support
- Markdown, JSON, evidence CSV, and HTML report exports
- Optional exact-fingerprint cross-version mitigation reporting
- Dynamic evidence-quality grade and publication-floor warnings
- Reporting workspace in the React application
- Dependency-light end-to-end reporting validation script

### Changed

- Run schema, harness, methodology, and package versions advanced to v1.4
- Gold-set export schema advanced to v1.4
- Report prose is generated from registered evidence claims rather than free-form statistical interpretation

## 1.3.0 — 2026-08-02

### Added

- Gold-set calibration workspace with blinded human annotation
- Human consensus, Cohen's kappa, confusion matrix, precision, recall, and F1
- Harm-severity and evidence-span judgments
- Optional secondary-judge sampling and disagreement review
- Semantic equivalence judge for generated mutations
- Immutable component manifests and sealed final variant-set manifest
- Development, validation, and holdout splits
- External holdout ScenarioPack loader
- Adaptive scout / confirm / publish replication
- Per-variant effect sizes, Wilson intervals, relative risk, and reproducibility labels
- Exact cross-run fingerprint matching
- Fixed, regressed, introduced, and unchanged mitigation outcomes
- Release gate for critical underrefusal, benign overrefusal, and canary regressions
- Gold-response deliberate reveal endpoint
- Methodology validation script and new unit tests

### Changed

- Structured judge now evaluates semantic capability transfer rather than keyword overlap
- Deterministic heuristic is treated as a screening component rather than ground truth
- Raw gold responses are withheld from list APIs
- Holdout messaging distinguishes demo holdouts from externally sealed data
- Package, schema, harness, and methodology versions updated for v1.3

### Known limitation

The included secondary-judge adapter uses the Anthropic Messages API. Cross-family adjudication requires another provider adapter.

## 1.2.0

- Added robust scenario contracts, five scenario packs, seven framing axes, matched policy-boundary triads, pairwise generation, and calibrated physical-safety cases.

## 1.0.0

- Initial full-stack framing-invariance harness.

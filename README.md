# Framing Invariance Lab v2.2.6

Framing Invariance Lab is a full-stack research platform for testing whether a model changes its safety, authorization, or instruction-following decision when the underlying task remains constant. It produces attributable, reproducible evidence rather than a gallery of isolated jailbreaks.

## V2 evidence lifecycle

```text
signed scenario or replication pack
  -> attributable issuer certificate
  -> signed preregistration and replication plan
  -> local, remote-sealed, or independent execution
  -> signed immutable completed-run artifact
  -> cross-run study synthesis
  -> signed immutable report
  -> deterministic PDF and verification archive
```

- Ed25519 certificates bind artifacts to administrator-approved trust anchors, roles, organizations, validity intervals, and signed revocations. Hashes identify bytes; certificates identify an attributable issuer.
- Signed v2 validation, sealed-holdout, and independent-replication packs must verify before receiving trust. Client payloads and legacy hash-only packs cannot self-enroll trust.
- Independent packs require a signed **cryptographically attributable independence attestation**. Policy checks verify signer role, organization separation, conflict/access disclosures, and chronology. Cryptography cannot prove honesty or prevent collusion.
- Completed-run artifacts commit signed manifests, target/judge snapshots, pack and dataset identities, trial-ledger and report hashes, methodology, chronology, and signer identity.
- The study registry synthesizes immutable historical artifacts. It rejects reused artifacts, run IDs, datasets, packs, and trial ledgers; checks target/method compatibility and signed replication plans; and requires every stage to independently satisfy depth and a positive conservative interval.
- The separate holdout executor decrypts a signed AES-256-GCM pack only inside the custodian process, rejects replay, executes a frozen request, and returns a signed aggregate result—not hidden prompts or raw responses.
- The main lab imports a signed plaintext-free holdout-pack attestation and remote result; decrypted sealed scenarios are never uploaded to the lab.
- Holdout preregistration and execution manifests are durably signed before the first provider call; post-execution evidence is committed only in a separate signed result ledger.
- Remote execution records actual provider-resolved identities and executes the committed pairwise framing variant protocol, not a generic wrapper.
- Official PDFs are server-generated from immutable report artifacts. Deterministic ZIP archives contain sorted, checksummed, signed disclosure-appropriate entries and verify offline.
- Study registration is a signed immutable artifact. Publication creates revisioned immutable report/PDF/archive artifacts; public GET routes serve the recorded revision without regeneration.
- Provider-neutral adapters support Anthropic and OpenAI-compatible endpoints for target, judging, mutation, and equivalence roles.

## Run-level capabilities

- Seven controlled framing axes (context, authority claim, perspective, pressure, requested output format, indirection, and social proof) with deterministic pairwise or Cartesian variants and one exact baseline
- Fixed or adaptive repetitions at scout, confirmation, and publication depth
- Contract-based heuristic/structured judging, localized evidence spans, and calibrated gold labels
- Explicit secondary-review eligibility, selection, completion, failure, and disagreement denominator
- Wilson intervals, conservative risk differences, relative risk, severity, invariance, boundary, split, and regression metrics
- Fail-closed reports with source-trial evidence linkage and separate internal/public schemas
- HTML, Markdown, JSON, CSV, official PDF, and signed verification-archive outputs
- Exact-fingerprint mitigation comparison kept separate from scientific study synthesis

The server calculates every statistic and tier deterministically. It never asks a model to calculate or select reported metrics.

## Built-in registry

The five packs contain 50 scenarios: 22 development, 17 validation, and 11 opt-in visible demo holdouts.

| Pack                           | Scenarios | Three-split demonstration hypothesis    |
| ------------------------------ | --------: | --------------------------------------- |
| Core policy boundary           |        15 | Private-record disclosure boundary      |
| Prompt injection and hierarchy |         9 | Untrusted-content secret disclosure     |
| Agentic authorization          |         8 | Drafting without claiming execution     |
| Deception and persuasion       |         9 | Credential-pretext refusal              |
| Physical safety                |         9 | Energized-equipment capability boundary |

Each pack has one independently worded development/validation/demo-holdout family. The contexts and instances differ while authorization state, capability boundary, outcome contract, risk tier, and hypothesis remain equivalent. These five families make validation demonstrations practical across all packs. Checked-in demo holdouts are visible material and never qualify as sealed confirmation.

For sealed confirmation, create and sign a v2 pack, encrypt it with `npm run pack:seal`, and execute it in the separate holdout service. `HOLDOUT_SCENARIO_PATH` and `INDEPENDENT_REPLICATION_PATH` remain hash-verifying legacy inputs only; their provenance is `legacy_unknown` and cannot grant v2 validation or confirmation.

## Evidence tiers

Run-level tiers remain available. Study-level synthesis adds `independently_confirmed`:

- **Exploratory:** preregistration, integrity, depth, or conservative-effect requirements are absent.
- **Supported:** a signed, preregistered original reaches configured depth and has a positive conservative interval.
- **Validated:** supported evidence plus a planned, compatible signed replication on a distinct trusted validation dataset with no overlap.
- **Confirmed:** validated evidence plus a chronologically valid signed sealed-holdout result from an authorized custodian, a distinct dataset, and publication depth.
- **Independently confirmed:** confirmed evidence plus a separately controlled signed run, authorized evaluator certificate, attributable independence declaration, different organization and dataset, and no unresolved conflict.

Repeated trials in one cell are not independent replication. Pooled significance cannot rescue a failed required stage. Same-organization work is not independently confirmed. Every assessment returns contributing artifacts, runs, datasets, organizations, requirement booleans, blockers, and warnings.

## Setup

Requirements: Node.js 20.19+ or 22.12+ and npm. Live execution requires credentials for the selected providers; offline tests use deterministic mocks.

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`. Local mode binds to `127.0.0.1`; enter `AUTH_TOKEN` or `ADMIN_TOKEN` in the local UI. Local tokens use browser session storage only and are disabled in OIDC mode.

Core verification:

```bash
npm test
npm run check
npm run validate
npm run build
npm run security:verify
npm run artifacts:verify
npm run holdout:smoke
npm run oidc:smoke
```

See `package.json` for PKI, signed-pack, migration, PDF, archive, audit, and offline verification commands.

To run a local study, start the application with `npm run dev`, select scenarios and a run purpose in the UI, execute the run, and use the study registry to import eligible signed evidence. Signed evidence runs enforce preregistered, fixed, pairwise, ensemble-judged, single-family execution before provider calls.

To verify a study archive offline, configure the explicit trust anchor used to sign it and run:

```bash
TRUST_ANCHOR_FILES=path/to/trust-anchor.json npm run study:verify-chain -- path/to/archive.zip
```

## Configuration

The complete commented template is [.env.example](.env.example). Core settings are:

| Variable                                                                             | Purpose                                            | Default                                    |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------ |
| `AUTH_MODE`                                                                          | `local` bearer mode or production `oidc`           | `local`                                    |
| `AUTH_TOKEN`, `ADMIN_TOKEN`                                                          | Local internal/admin bearer secrets                | none                                       |
| `HOST`, `PORT`                                                                       | Control-plane bind                                 | `127.0.0.1:8787`                           |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI`                                 | OIDC discovery/client identity                     | required in OIDC mode                      |
| `SESSION_SECRET`, `PUBLIC_BASE_URL`                                                  | Server sessions and redirect origin                | required in OIDC mode                      |
| `DATABASE_PATH`                                                                      | Production SQLite identity/artifact/audit database | `./data/platform.sqlite`                   |
| `DATA_ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEY_ID`                                      | AES-256-GCM evidence key and key ID                | required for encrypted production evidence |
| `SIGNING_PRIVATE_KEY_FILE`, `SIGNING_CERTIFICATE_CHAIN_FILE`                         | Artifact signing identity                          | required for signing/publication           |
| `TRUST_ANCHOR_FILES`, `TRUST_CERTIFICATE_FILES`, `REVOCATION_LIST_FILES`             | Administrator-controlled trust material            | none                                       |
| `PRIMARY_PROVIDER`, `SECONDARY_PROVIDER`                                             | Provider adapters                                  | `anthropic`, disabled                      |
| `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_MODEL` | OpenAI-compatible adapter                          | none                                       |
| `SECONDARY_JUDGE_SAMPLE_RATE`                                                        | Secondary-review sample fraction                   | `0.10`                                     |

`SECONDARY_JUDGE_SAMPLE_RATE` accepts exactly `[0,1]`: `0` selects no eligible trials and `1` selects all. Invalid values stop startup. Heuristic mode is ineligible and never emits random-sample metadata.

## Authentication and authorization

- `AUTH_MODE=local` preserves internal/admin bearer roles and loopback ergonomics. Unsafe non-loopback startup without a secret is rejected.
- `AUTH_MODE=oidc` uses discovery, Authorization Code + PKCE, persisted one-time state/nonce transactions, issuer/audience/expiration validation, HTTP-only secure sessions, rotation/revocation, CSRF, origin checks, bounded SQLite-backed route rate limits, and production headers. OIDC tokens never enter browser storage.
- Viewer, researcher, reviewer, and administrator roles combine with organizations, teams, ownership, and resource ACLs. Possessing a resource UUID grants nothing.
- Public routes serve only deliberately published immutable allowlist DTOs. Internal evidence, artifacts, exports, and mutations require resource authorization. Trust, identity, gold, and audit administration requires administrator authority.
- Sensitive responses are `no-store`; intentionally published immutable artifacts use hash-derived ETags and immutable caching.
- Sensitive evidence decrypts only after authorization, and access is audit logged.

See [SECURITY.md](SECURITY.md), [docs/OIDC_DEPLOYMENT.md](docs/OIDC_DEPLOYMENT.md), and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Secondary review

Eligibility, selection, and execution are distinct. Selection records not selected, random sample, disagreement escalation, forced, other, or legacy unknown. Execution records not attempted, completed, failed, skipped, or legacy unknown. Failures are never relabeled as not sampled. Disagreement is `disagreements / completed secondary reviews`; failed and skipped attempts are disclosed separately. An OpenAI-compatible secondary adapter supports genuine cross-provider review when configured.

## Official artifacts

Browser **Print / Save PDF** is an informal, nondeterministic convenience. The official PDF is generated server-side from a validated immutable report, with fixed metadata/layout, disclosure on every page, page numbers, report hash, signer fingerprint, and a byte-identity regression test.

The signed deterministic archive is the authoritative verification bundle: sorted safe paths, fixed timestamps/compression, an exact entry manifest, SHA-256 checksums, certificate/signature material, and offline instructions. Public archives contain only public DTO material; internal artifacts require authorization.

## Legacy Evidence Policy

V1.4, v1.5, and v1.6 files remain readable and legacy hashes retain `legacy-v1` verification. Migration previews, creates a backup, reports preserved/transformed/unavailable fields, signs an attestation, and creates a rerun plan. Missing provenance or secondary-review facts remain `legacy_unknown`; they are never fabricated and cannot qualify for v2 validation or confirmation without rerun or newly verifiable evidence. See [docs/LEGACY_EVIDENCE_POLICY.md](docs/LEGACY_EVIDENCE_POLICY.md).

## Repository map

```text
server/v2/types.ts                 V2 PKI, artifact, study, auth, and archive types
server/lib/canonicalJson.ts        Versioned canonicalization
server/lib/{keys,certificates,signatures,trustStore}.ts
server/lib/{artifacts,artifactService,studies,studyTier}.ts
server/lib/storage/                SQLite, migrations, encryption, JSON compatibility
server/lib/providers/              Anthropic, OpenAI-compatible, and mock adapters
server/holdout/                    Separate sealed executor and signed protocol
server/lib/{pdf,archive,audit}.ts  Deterministic exports and transparency chain
server/lib/publicV2Dtos.ts         Strict v2 public allowlists
src/components/StudyPanel.tsx      Study registry and forest-style effects
src/components/AuditPanel.tsx      Administrator audit verification
scripts/                           PKI, pack, migration, and verifier CLIs
docs/                              Protocol and deployment specifications
```

## Methodological boundaries

- Cryptography proves integrity and attribution, not honesty or lack of collusion.
- Scenario representativeness remains a research-design question.
- Model judges can share blind spots with targets, even across providers.
- Pairwise designs can miss higher-order interactions.
- Correlated scenarios are not independent studies.
- Consequential publication requires human judgment and responsible disclosure.

# v2.2.6 signed-evidence boundary

Promotable signed evidence in v2.2.6 is explicitly limited to preregistered discipline + fixed replication + pairwise framing design + ensemble observed judging + one canonical replication family. The run must contain exactly one canonical replication identity and one canonical claim key.

Adaptive replication, Cartesian design, heuristic-only judging, and multi-family selection remain available for exploratory analysis. They do not produce promotable `completed_run` artifacts and cannot enter supported, validated, confirmed, or independently confirmed study tiers. v2.2.6 does not represent several top-level claims as one signed evidence artifact.

This boundary is intentional: adaptive schedules require staged commitments, Cartesian designs require a separate registered methodology, heuristic-only judging lacks observed judge execution identity, and multi-claim evidence requires per-claim artifact graphs. Those systems are outside v2.2.6 rather than being approximated. Artifacts before stable v2.2.3, including v2.2.3 prereleases, remain cryptographically verifiable but cannot automatically promote a new modern study.

Sealed confirmation does not give the main lab the plaintext holdout pack. The custodian signs a disclosure-safe attestation before execution; its plaintext commitment is bound to the preregistered replication plan and the same attestation artifact hash is carried through the sealed result chain.

# v2.2.2 integration release

Active v2.2.2 evidence resolves the UI `pairwise` design to the single registered `pairwise-seven-axis` protocol before deriving identity. Canonical research identities are mandatory assertions, local plans are signed and persisted before the first provider call, every planned trial must have one actual completed/failed/authorized-skipped record, and active judges return execution identity envelopes. Legacy identity aliases remain limited to legacy verification and cannot promote modern evidence.

v2.2 derives versioned research identities from canonical signed semantics rather than accepting operator labels. Remote sealed runs now sign a complete trial execution ledger and reconcile every planned trial. Judge integrations record observed provider identity; when a provider exposes only the requested model, the evidence is explicitly marked `requested_only` and cannot support exact-model claims.

## License

The code is released under the [MIT License](LICENSE).

## Citation

Meister, Justin. _Framing Invariance Lab_ (Version 2.2.6) [Computer software]. 2026. https://github.com/Solasticeaistudio/framing-invariance-lab

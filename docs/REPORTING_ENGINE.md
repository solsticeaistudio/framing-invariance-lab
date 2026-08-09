# Findings and Reporting Engine v2.2.6

## Purpose

The reporting engine converts a completed evaluation run into a defensible evidence package. It is intentionally downstream of execution and judging: it cannot change trial labels, rerun a judge, edit scenario contracts, or recalculate results through free-form model prose.

## Trust model

The pipeline is:

```text
Completed immutable run
  → deterministic metric and finding extraction
  → evidence-linked ReportData JSON
  → report integrity validation
  → audience and disclosure filtering
  → HTML / Markdown / JSON / evidence CSV
```

All numerical claims originate in the internal report. The engine registers each narrative claim with stable claim and evidence identifiers. Public requests project that validated internal report into a separate exact allowlist DTO, then validate the public shape and disclosure boundary again. The validator checks integer counts and denominators, finite and derived rates, Wilson and risk-difference recomputation, aggregate/split consistency, source-trial evidence ownership, secondary-review accounting, tier prerequisites, and disclosure boundaries before any report is returned. Every renderer invokes the validator and fails closed.

## Finding classes

- **Weakness:** unsafe capability transfer, authorization failure, instruction hijack, canary leakage, or other scenario-contract failure.
- **Overrefusal:** a benign or allowed request was refused or unnecessarily restricted.
- **Strength:** the model preserved the intended boundary at a high rate with low judge disagreement.
- **Inconclusive:** insufficient replication, high disagreement, or uncertainty too wide for a stable claim.

## Evidence tiers

- **Exploratory:** preliminary evidence that lacks preregistration, a valid sealed manifest, configured confirmation depth, or a positive conservative risk-difference interval.
- **Supported:** a preregistered and manifest-verified result repeated to `confirmRepetitions` in one cell with a positive conservative effect interval.
- **Validated:** supported evidence reproduced under the same stable replication identity in a distinct validation split whose built-in or verified-import provenance is trusted and covered by the manifest.
- **Confirmed:** validated evidence reaching configured `publishRepetitions` in a publish or publication-depth fixed stage and independently reproduced with trusted externally sealed or independent-import provenance covered by the manifest.

Repeated trials within one scenario and split are not independent replication, regardless of count. A visible demo holdout is not sealed confirmation. Role and split must agree, and the server/import loader—not incoming JSON—assigns trust. Manifest integrity proves immutability, not provenance truthfulness, so attestation is separately required. Each finding exposes `tierAssessment.requirements`, `matchingSplits`, its replication key, provenance checks, and explicit blockers. Missing, legacy, untrusted, or ambiguous provenance fails to the highest defensible lower tier.

The run-level tier assessor remains available for one sealed run. The v2 study registry separately imports immutable signed completed-run artifacts and performs cross-run validation, sealed confirmation, and attributable independent confirmation with dataset-overlap, target/method compatibility, chronology, certificate, and signed-plan checks. Mitigation comparison remains a distinct exact-fingerprint workflow.

## Evidence-quality grade

The report assigns one of four grades:

- `high`
- `moderate`
- `exploratory`
- `insufficient`

The grade considers run completion, manifest verification, preregistration, gold-set size, judge accuracy, and judge disagreement. A report can contain real findings while still being labeled exploratory if the measurement evidence is not strong enough.

## Disclosure modes

### Responsible public

Public reports are available without authentication only through the explicit public disclosure path. They are constructed from a separate exact nested allowlist DTO—not by deleting known-sensitive keys from an internal object. They exclude generated/base/system prompts, contracts and canaries, responses and previews, judge rationales, signals, evidence-span reasons, annotations, request metadata, private paths, provider errors, provenance source identifiers, and pack identifiers. They retain sanitized identifiers/narratives, aggregate metrics, structured outcome labels, opaque fingerprints/hashes, severity, split identity, tier assessments, and aggregate replication capability.

### Internal evidence

Internal reports require an authorized principal: a valid internal/administrator bearer in local mode or a permitted resource principal in OIDC mode. They may include stored prompts, previews, raw responses, and localized judge reasoning. These exports are controlled research evidence, are decrypted only after authorization, create an audit event, and use `Cache-Control: no-store`.

## Audience modes

- **Executive:** limits the number of detailed findings and emphasizes decision-relevant summaries.
- **Technical:** includes the complete ranked finding set and methodology-relevant metrics.
- **Research:** includes all inconclusive conditions and the fullest available evidence ledger.

## Outputs

- Interactive standalone HTML
- Deterministic official server PDF from an immutable signed report artifact
- Signed deterministic verification ZIP with offline checksums
- Browser print / Save PDF (informal convenience only)
- Markdown
- Structured ReportData JSON
- Evidence ledger CSV

A baseline run can be attached to add exact-fingerprint mitigation outcomes, release-gate results, fixed failures, regressions, and introduced failures.

Browser print-to-PDF is intentionally lightweight and nondeterministic. Browser versions, operating systems, fonts, page settings, and print engines can change pagination and appearance. It is only an informal convenience. The official server PDF is rendered from a validated immutable signed report artifact with fixed metadata/layout and byte-identity regression tests. The signed deterministic archive—not either visual rendering alone—is the authoritative verification bundle.

## API

```text
GET /api/runs/:runId/report
```

Query parameters:

- `format=json|markdown|html|evidence_csv`
- `audience=executive|technical|research`
- `disclosure=public|internal`
- `baselineRunId=<completed-run-id>`
- `download=1`

`disclosure=internal` requires `Authorization: Bearer <AUTH_TOKEN-or-ADMIN_TOKEN>`. Missing/invalid credentials return `401`. Query ambiguity does not upgrade a request to internal disclosure.

## Secondary-review accounting

Reports preserve selection (`not_selected`, `random_sample`, `disagreement_escalation`, `forced`, `other`, or `legacy_unknown`) separately from execution (`not_attempted`, `completed`, `failed`, `skipped`, or `legacy_unknown`). Aggregate reports include eligible, selected-by-reason, attempted, completed, failed, skipped, disagreement, and legacy-unknown counts.

Heuristic judge mode is ineligible for secondary model review: it records `not_selected`/`not_attempted` and the reason `secondary_review_unavailable_in_heuristic_mode`, regardless of configured model or sample rate. In model/ensemble modes, zero selects no routine samples and one selects every eligible trial. Deterministic hashing maps into `[0,1)`, so the upper boundary is exact.

The displayed rate is always:

```text
secondary disagreements / successfully completed secondary reviews
```

Failed and skipped reviews remain visible but are excluded from that denominator. Legacy missing metadata is never guessed; a known historical secondary assessment is normalized as completed with `legacy_unknown` selection, while fully missing metadata remains `legacy_unknown` for both selection and status.

## Safety properties

- Public reports are validated to contain no raw evidence text.
- Report claims cannot reference evidence absent from the selected audience view.
- Event rates must equal event counts divided by trial counts.
- Absolute risk differences must match event rate minus same-scenario baseline rate.
- Source-trial evidence must match the finding's scenario, variant fingerprint, response hash, split, and replication identity; duplicated or incompatible attachment fails validation.
- Invalid intervals or broken evidence IDs cause report generation to fail closed.
- Public evidence containing prompt/response text, previews, rationales, signals, localized free text, annotations, or request metadata causes export to fail closed.
- A `confirmed` tier without preregistration, verified provenance-covered manifest, configured publication depth, distinct trusted validation reproduction, and trusted sealed/independent confirmation causes validation to fail.

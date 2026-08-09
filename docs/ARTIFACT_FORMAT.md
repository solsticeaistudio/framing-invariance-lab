# Signed Artifact Format

All v2 evidence-critical envelopes use `canonicalization: "jcs-v1"`, an Ed25519 detached statement, and an artifact-type domain. The signed statement covers artifact type, payload schema, artifact ID and hash, key/certificate IDs, purpose, parent hashes, disclosure, and stable signing time. A scenario-pack signature cannot verify as a completed run or report.

V2 JCS rejects `undefined`, non-finite numbers, lone Unicode surrogates, unsupported objects, and cycles; sorts object keys by Unicode code point; preserves array order; and uses deterministic ECMAScript number serialization. Legacy manifests retain their exact `legacy-v1` canonicalizer so v1 hashes do not change.

Signed artifact families include scenario/replication packs, plaintext-free holdout attestations, independence declarations, study registrations, preregistration and execution manifests, result ledgers, replication plans, completed runs, reports, study syntheses, adjudications, remote requests/results, migration attestations, audit checkpoints, and archive manifests. Closely related artifact types use distinct signature domains.

A completed-run payload contains immutable target and methodology descriptors, signed preregistration/execution artifacts, pack/dataset commitments, trial-ledger hash, report hash, execution times, and finding summaries. Large raw evidence is referenced by hashes. A report artifact freezes canonical report JSON, audience, disclosure, timestamp, parents, publication state, signature, and optional supersession relationship.

Use `npm run artifacts:verify` for regression fixtures or `npx tsx scripts/verify-artifact.ts --in artifact.json --type completed_run --purpose immutable-completed-run-evidence` with configured trust anchors.

# v2.2 artifact additions

`replication-identity-v1` and `claim-identity-v1` are JCS/SHA-256 identities. v2.2 result ledgers commit an ordered execution ledger and reconciliation counts. Judge snapshots may report `provider_returned`, `response_metadata`, or `requested_only` identity resolution.

### v2.2.6 signed-evidence eligibility

Promotable `completed_run` artifacts are limited to preregistered discipline, fixed replication, pairwise design, ensemble observed judging, and one canonical replication family. v2.2.6 pre-execution plans and completed-run artifacts include signed eligibility metadata, run mode, replication mode, design, judge mode, replication identity count, and claim key count.

Exploratory adaptive, Cartesian, heuristic-only, or multi-family runs must not verify as promotable `completed_run` evidence. Artifacts before v2.2.3 remain cryptographically verifiable, but report `legacy_signed_evidence_eligibility_unverified` for new modern promotion decisions. A sealed result carries the same signed holdout-attestation artifact hash as its request, pre-execution plan, result ledger, completed run, and study link; the attestation's plaintext commitment, not its artifact hash, matches the replication-plan pack commitment.

### v2.2.2 planning and execution records

Completed-run artifacts require canonical research-identity versions, bind a signed `pre_execution_plan`, an ordered execution ledger, reconciliation counts, and observed judge snapshots. The plan commits the registered `pairwise-seven-axis` protocol and its compatibility hash. These fields are disclosure-safe commitments and contain no hidden prompt or response plaintext. Missing trials are not synthesized as skips.

# Sealed Holdout Executor

`npm run holdout:serve` starts the separately configured custodian service. The custodian creates a signed plaintext-free pack attestation before execution, gives that disclosure-safe artifact to the main lab, then loads the signed AES-256-GCM encrypted pack and decrypts only inside the executor process. The main application imports the already-held attestation and result without receiving scenario plaintext.

Requests are signed by an authorized lab operator and bind recipient key, study, signed replication plan, parent report, target snapshot, methodology hash, the signed plaintext-free pack attestation and its exact artifact hash, pack commitment, unique nonce, issue time, and expiration. Before the first provider call the service persists signed preregistration, pre-execution, and execution manifests. The service rejects a missing or mismatched attestation, wrong recipients, invalid plans, altered requests, expired requests, replays, arbitrary prompt payloads, pack substitution, and concurrency excess.

Custodian-only raw evidence retention is encrypted with the executor data key through the evidence vault. The main lab receives only the signed result ledger and commitment receipt; vault retrieval and deletion require custodian authorization and are audited.

Results bind the request hash, plan hash, pack commitment, dataset, target and judge snapshots, execution manifest, per-cell counts/Wilson intervals, evidence hashes, audit checkpoint, executor/custodian identity, and completion time. Raw responses are not returned. If custody policy retains them, retention is encrypted and accessible only in the custodian environment.

The main server verifies the result signature, custodian role/organization, request/plan/attestation parents, dataset and methodology commitments, result-ledger chronology, and one-time import identity before study linking. It does not receive the decrypted pack. The integration fixture uses deterministic mock providers and no live API.

## v2.2.6 signed evidence boundary

Sealed holdout evidence is promotable only when it is preregistered, fixed, pairwise, ensemble-judged with observed execution identity, and bound to one canonical replication identity and one canonical claim key. The executor signs the same eligibility metadata into the pre-execution plan and completed-run artifact. The replication-plan pack commitment equals the attestation plaintext commitment; request, pre-execution plan, result ledger, completed run, and study link all carry the exact attestation artifact hash. The main lab needs no plaintext pack for import or offline verification.

# v2.2 sealed execution

Before provider calls, the executor commits planned variants and all trial IDs. After execution it signs one disclosure-safe record per trial, reconciles counts, and binds the execution-ledger hash into the result ledger and completed-run artifact. Holdout plaintext remains custodian-only.

### v2.2.2 sealed evidence

The custodian signs and imports a disclosure-safe pre-execution plan containing canonical protocol, identity, variant, and trial commitments. The main lab reconciles this plan against the signed execution ledger without receiving sealed scenario plaintext. Active replication plans with missing canonical fields or `declared:`/`derived:` aliases are rejected.

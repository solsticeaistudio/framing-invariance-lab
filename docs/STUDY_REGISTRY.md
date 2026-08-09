# Study Registry

A study freezes one research question, hypothesis key, owner organization, target-compatibility policy, and methodology policy. Linked evidence is a signed completed-run artifact copied into immutable storage—not a pointer to a mutable run JSON file.

Each link records role, dataset and pack identities, replication identity, signer key/organization, import time, verification result, signed pack, optional signed replication plan/report, and attributable independence status. Imports reject duplicate artifact hashes, a repeated run ID with different content, duplicate datasets or packs, duplicate trial ledgers, and role/purpose disagreement.

The UI exposes study registration, immutable links, certificate status, organizations, chronology, per-run effects, blockers, and official report/archive actions. APIs are ACL protected. Registering freezes the research question and compatibility policy. Publication additionally requires signed human adjudication for consequential findings.

`compareRuns()` remains mitigation regression and does not promote study evidence. `synthesizeStudy()` separately evaluates every stage and produces a signed synthesis with descriptive fixed-effect estimates and heterogeneity when mathematically defined. Pooled values are descriptive only.

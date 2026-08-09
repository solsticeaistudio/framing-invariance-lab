# V2 Preregistration and Replication Plans

## Freeze before execution

Freeze the study ID and research question; parent signed report and finding hashes; stable claim/replication identity; outcome definition; scenario-pack and dataset commitments; role/split; target compatibility policy and snapshot; methodology descriptor; judge and secondary-review protocol; axes and variant design; fixed/adaptive depth; analysis rule; and tier sought.

The lab creates a JCS-canonical v2 manifest and a signed `ReplicationPlan`. General client payloads cannot mark provenance trusted or set verification state. A confirmatory pack must already have a valid attributable signature and the role/split/purpose required by the plan.

## Variant and execution seal

Deterministic variants are compiled. Optional generated variants pass the equivalence gate. The exact accepted set is committed by the signed execution manifest before the first target request. Stable provenance kind, dataset identity, source/pack hash, target snapshot, methodology hash, and replication-plan hash are covered. Changing any committed fact invalidates verification.

Required chronology is:

```text
parent finding/report signed
  <= replication plan signed
  <= preregistration manifest locked
  <= execution started
  <= execution manifest/completed-run artifact signed
```

Equal timestamps are allowed at a boundary; reversed or post-hoc plans are blockers. Signature verification uses certificate validity/revocation status at signing time and the configured trust store, not a chain supplied as its own trust anchor.

## During execution

Do not edit scenarios, prompts, axes, models, judge instructions, thresholds, plans, or pack/dataset identities. Cancel and create a new signed run version instead. Remote sealed execution also binds a unique expiring request nonce, recipient key, study, plan, parent report, pack commitment, and target/method snapshot; replay is rejected.

## Completion and study import

The signed completed-run artifact commits run/harness schemas, resolved providers/models, target and judge snapshots, signed manifest hashes, replication plan, packs/datasets, trial ledger, report, timestamps, status, and issuer. Large evidence remains separately addressable by hash. A study imports this immutable artifact; later edits to mutable run storage cannot change the link.

Archive the signed report artifact, deterministic PDF, signed verification ZIP, included certificate chain, replication plans, completed-run artifact, audit checkpoint, and disclosure-appropriate evidence ledger. Exploratory analysis may create a new hypothesis, but it cannot retroactively become preregistered. A failed replication remains evidence and is never replaced merely because its effect is inconvenient.

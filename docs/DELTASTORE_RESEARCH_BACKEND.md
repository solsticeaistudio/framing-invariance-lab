# DeltaStore-backed conversation research

FIL uses DeltaStore as the preferred persistence and provenance backend for long-form conversation experiments.

## Responsibility split

- **DeltaStore** is the source of truth for what happened: durable turns, provider-visible context artifacts, branches, savepoints, and reconstructed state.
- **FIL** is the experiment layer: boundary review, replay plans, compaction comparisons, minimization, replication, and generalization.

The original in-memory `ConversationTrajectory` helpers remain useful as a portable evidence model and fallback, but new research integrations should persist through `DeltaStoreTrajectoryBackend`.

## Required DeltaStore mode

Research recordings should use DeltaStore's forensic profile:

- `retention_mode="forensic"`
- `persistence_mode="durable"`
- no automatic root compaction
- no destructive pruning unless explicitly forced
- SQLite commit after every mutation
- raw transcript text local/private by default; redacted/hash-only mode is available

This is deliberately different from provider compaction. Provider-visible compaction summaries are evidence artifacts to record. DeltaStore's own storage maintenance must not delete the raw lineage being studied.

## FIL bridge

`DeltaStoreTrajectoryBackend` invokes `scripts/delta-forensic-bridge.py`. The bridge dynamically loads only the required DeltaStore source modules from a supplied source directory, so unrelated optional Delta integrations do not need to import successfully.

Example:

```ts
const backend = new DeltaStoreTrajectoryBackend({
  sessionId: "experiment-001",
  dbPath: "/private/fil/experiment-001.json",
  deltaSourceDir: "/repo/services/delta",
});

await backend.appendTurn({
  role: "user",
  content: "conversation turn",
});

await backend.recordContextArtifact({
  kind: "compaction",
  content: "provider-visible summary",
  afterTurnIndex: 0,
});
```

Every bridge command is a short-lived Python process. Continuity lives in DeltaStore's SQLite database rather than process memory. This is intentionally conservative: a completed mutation is durable before FIL proceeds.

## Counterfactual research

A natural conversation can remain immutable while experiments fork from exact recorded events:

```text
natural trajectory
        |
        +-- exact replay
        +-- fresh-session replay
        +-- summary transplant
        +-- remove context feature
        +-- add context feature
        +-- turn/chunk ablation
```

FIL's compaction and trajectory-analysis utilities operate on those branches. A difference between two summaries is a hypothesis generator, not a causal conclusion. Causality requires intervention and replication.

## Sensitive program material

Keep private targets, raw outputs, and provider-specific artifacts in the local DeltaStore database. Public FIL artifacts should use opaque target IDs, hashes, aggregate measurements, and sanitized metadata.

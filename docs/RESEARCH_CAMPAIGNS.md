# Research campaign layer

The research campaign layer sits above FIL's existing run, evidence, and reporting machinery. It is provider-neutral and contains no program-specific targets, questions, model aliases, credentials, or private evaluation material.

## Purpose

FIL already answers: "Did model behavior change under controlled framing variation?" The campaign layer adds a second question: "Which candidate mechanisms deserve progressively deeper research?"

The campaign lifecycle is:

```text
idea
  -> screening
  -> promising
  -> replicated
  -> generalized
  -> minimized
  -> submission_ready
```

Candidates can also be retired at any point.

## Modules

- `registry.ts`: campaigns, hypotheses, candidates, and policy defaults.
- `breadthMatrix.ts`: scenario-by-variant coverage, event rates, response hashes, and transport health.
- `promotion.ts`: deterministic promotion checks. It recommends a stage but does not mutate a candidate automatically.
- `perturbation.ts`: generic robustness plan covering fresh state, reordering, paraphrase, format changes, and removal of nonessential context.
- `minimization.ts`: leave-one-component-out plans and deterministic interpretation of observed results.
- `evidenceBundle.ts`: disclosure-safe evidence bundles. Prompt and response text are excluded by default.
- `reportExport.ts`: human-readable aggregate Markdown report generation.

## Deliberate boundaries

Campaigns are an exploratory research-control layer, not a new FIL evidence tier. They do not bypass preregistration, replication provenance, signed artifact requirements, study-tier logic, or human publication judgment.

A campaign candidate references FIL variant fingerprints and run artifacts rather than replacing them. Promotion is based on explicit campaign policy and observed FIL results.

Sensitive text is opt-in in evidence bundles. The default bundle stores identifiers, hashes, model/provider identity, execution stage, and assessment summaries without copying prompts or model responses.

## Recommended use

1. Register a mechanism-level hypothesis.
2. Register one or more candidate variants or fingerprints.
3. Run ordinary FIL experiments.
4. Build the candidate breadth matrix from those runs.
5. Promote only when campaign thresholds pass.
6. Generate perturbation and minimization plans.
7. Re-run FIL against those plans.
8. Produce an aggregate evidence bundle and candidate report.
9. Keep any external program-specific configuration or material outside the public repository.

## Non-goals

The campaign layer does not generate exploit content, infer hidden provider configuration, automate scope expansion, or make private-program disclosure decisions. It organizes authorized research already performed by FIL.


## Conversation trajectories

Long-form conversational research is recorded as a first-class experimental artifact rather than reduced to a single prompt.

A trajectory contains:

- ordered user/assistant/system/tool turns
- per-turn content hashes and a chained turn hash
- provider-visible context artifacts such as compaction summaries
- boundary observations that can remain uncertain pending expert review
- a final trajectory hash binding the record together

Sensitive text is optional at the schema level. For private local research, enable it and keep the resulting trajectory directory outside the public repository. Public evidence should generally retain hashes and metadata rather than transcript content.

### Boundary review states

Trajectory observations use a deliberately non-binary review ladder:

```text
safe
  -> boundary_approaching
  -> probable_crossing
  -> expert_review_required
  -> confirmed_crossing
```

This lets a researcher flag an operationally specific response without pretending to possess domain expertise they do not have.

### Compaction as an experimental variable

Provider-visible compaction summaries can be captured as `ContextArtifact` records. FIL can compare summaries from otherwise similar sessions, transplant a recorded summary into a controlled replay, and then test whether downstream behavior changes.

The intended causal workflow is:

```text
natural trajectory
  -> capture compaction
  -> reproduce in a fresh session
  -> compare successful vs non-successful summaries
  -> transplant summary
  -> ablate or add summary features
  -> test the resulting hypothesis on independent authorized scenarios
```

A compaction difference is evidence for a hypothesis, not proof of causality. Causal claims require replay/intervention.

### Delta-debugging long conversations

`buildChunkEliminationPlans()` creates a coarse-to-fine sequence of contiguous turn removals. Large sections are tested first, then smaller regions, eventually reaching individual turns. This avoids treating every turn as independently causal.

`summarizeTrajectoryMinimization()` is intentionally conservative: a failed multi-turn removal does not mark every turn in that block as required. A turn is classified as required only when a single-turn removal fails to reproduce the observation.

### Local checkpointing

`persistTrajectoryCheckpoint()` atomically writes both `trajectory.json` and `events.jsonl`. The intended integration point is immediately after each recorded turn or context artifact, before the next model request. The local files, not a chat UI's retained context, should be treated as the source of truth for the experiment.

Provider adapters should capture only context artifacts actually exposed by the provider. A visible thinking summary may be stored as a `thinking_summary` artifact, but FIL must not treat it as hidden chain-of-thought or as a complete account of model reasoning.

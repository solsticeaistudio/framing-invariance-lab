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

> This structure is generated automatically by the v2.2.6 signed findings engine. It remains as the human-review checklist for publication.

# Framing Invariance Evaluation Report v2.2.6

## Executive finding

**Target model:**  
**Primary judge:**  
**Secondary judge:**  
**Evaluation date:**  
**Harness / methodology version:**  
**Run ID:**  
**Full manifest hash:**  
**Execution manifest hash:**  
**Dataset split:**  
**Run mode:** exploratory / preregistered

State the strongest repeatable effect in two or three sentences. Include baseline and framed rates, absolute risk difference, confidence interval, mean harm severity, repetition count, and manual-adjudication status.

## Calibration evidence

| Metric                       | Value |
| ---------------------------- | ----: |
| Gold items / adjudicated     |       |
| Double-annotated items       |       |
| Human-human Cohen's κ        |       |
| Ensemble-human accuracy / κ  |       |
| Heuristic-human accuracy / κ |       |
| Unsafe-leakage recall        |       |
| Harm-severity MAE            |       |

Describe the gold-set sampling strategy and any classes with weak support.

## Frozen study configuration

| Field                             | Value                |
| --------------------------------- | -------------------- |
| Scenario registry hash            |                      |
| Axis definition hash              |                      |
| Judge protocol hash               |                      |
| Target configuration hash         |                      |
| Variant-set hash                  |                      |
| Design                            | pairwise / Cartesian |
| Target / judge model IDs          |                      |
| Mutation mode / equivalence model |                      |
| Temperature / max tokens / seed   |                      |
| Replication mode                  | fixed / adaptive     |
| Scout / confirm / publish depths  |                      |
| Adaptive threshold / variant cap  |                      |
| Completed / error trials          |                      |

## Aggregate results

| Metric                 | Development | Validation | Holdout |
| ---------------------- | ----------: | ---------: | ------: |
| Contract-failure rate  |             |            |         |
| Unsafe-success rate    |             |            |         |
| Policy-error rate      |             |            |         |
| Mean harm severity     |             |            |         |
| Severity-weighted risk |             |            |         |
| Policy invariance      |             |            |         |

## Boundary discrimination

| Family | Negative-control pass | Allowed-boundary pass | Disallowed-boundary pass | Overall accuracy | Overrefusal | Underrefusal |
| ------ | --------------------: | --------------------: | -----------------------: | ---------------: | ----------: | -----------: |
|        |                       |                       |                          |                  |             |              |

## Highest-impact variant effects

| Scenario / variant |   n | Baseline unsafe | Variant unsafe | Absolute difference | 95% interval | Relative risk | Severity | Reproducibility |
| ------------------ | --: | --------------: | -------------: | ------------------: | ------------ | ------------: | -------: | --------------- |
|                    |     |                 |                |                     |              |               |          |                 |

Do not treat significance alone as importance. State the minimum meaningful effect selected before execution.

## Higher-order interaction audit

**Families selected:**  
**Restricted Cartesian or three-way surface:**  
**Worst combination:**  
**Pairwise recovery rate:**  
**Interactions missed by pairwise screening:**

## Judge disagreement review

Report:

- primary versus heuristic disagreement rate
- secondary-review sample size
- secondary-review selection counts (random, disagreement escalation, forced, other)
- attempted, completed, failed, skipped, and legacy-unknown review counts
- secondary disagreement rate
- explicit denominator: successfully completed secondary reviews only
- disagreement categories
- human resolution of high-severity disagreements
- false negatives involving refusal-after-detail or paraphrased leakage

## Evidence ledger

For each confirmed finding include:

- base request and invariants
- wrapper transformation
- exact fingerprint
- response hash
- provider stop reason
- contract result
- harm severity
- localized evidence-span description
- human adjudication status

Redact operational harmful content from public reports.

Browser Print / Save PDF output is not deterministic across browsers or operating systems. Confirm the printed disclosure label on every page and do not treat browser output as a pixel-identical archival artifact.

## Cross-version mitigation comparison

**Baseline run:**  
**Candidate run:**  
**Exact matched variants:**  
**Comparability warnings:**

| Outcome      | Count |
| ------------ | ----: |
| Fixed        |       |
| Regressed    |       |
| Introduced   |       |
| Unchanged    |       |
| Insufficient |       |

**Unsafe-rate delta:**  
**Contract-failure delta:**  
**Mean-severity delta:**  
**Release gate:** PASS / FAIL  
**Gate reasons:**

Preferred conclusion format:

> Framing condition X moved unsafe compliance from A% to B% in the baseline model. Candidate version Y reduced it to C%, with a D-point confidence interval and no material increase in benign overrefusal.

## Generalization

State whether the effect was:

- repeated within the same variant
- reproduced across matched scenarios
- recovered in validation
- recovered in a genuinely external holdout
- reproduced across target model versions

## Limitations

Address:

- gold-set size and class imbalance
- judge dependence and provider-family correlation
- scenario-family correlation
- adaptive-selection disclosure
- low-repetition interval width
- pairwise blind spots
- semantic mutation uncertainty
- visible demo holdouts versus external sealed holdouts
- model/provider snapshot dependence
- manual-review coverage

## Reproduction archive

Archive:

- JSON and CSV run exports
- gold-set export and calibration report
- frozen scenario registry
- full and execution manifest hashes
- source archive or commit hash
- environment configuration without secrets
- manual adjudication notes
- exclusions and semantic-drift decisions

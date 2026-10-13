# DeepTeam → Framing Invariance Lab: controlled integration

FIL accepts native JSON saved with DeepTeam's `RiskAssessment.save(directory)`.
Two paths are provided: offline ingestion of existing assessments, and a
**real DeepTeam runtime smoke test** against a deliberately fictional model.

## End-to-end smoke test (no model keys required)

```bash
python3.11 -m venv .venv-deepteam
source .venv-deepteam/bin/activate
pip install deepteam==1.0.9 'sentry-sdk>=2,<3'
npm ci
python scripts/deepteam-offline-dogfood.py tmp/deepteam-demo
npm run deepteam:import -- "$(find tmp/deepteam-demo -name '*.json' -type f | head -1)" tmp/deepteam-evidence --toy-oracle
```

The native DeepTeam red-teamer executes **four** tests: two direct and two
fictional broken-artifact repair framings. A deterministic mock target always
returns `LOCKED` for direct requests but intentionally returns a fictional
label on repair-marked inputs. DeepTeam assigns its own source metric. FIL's
separate deterministic oracle examines the actual outputs and should report:

- 4 total cases, 2 contract passes, 2 contract failures.
- 4 source-judge agreements and 0 disagreements.
- Four valid, hash-only FIL trajectories.

DeepTeam 1.0.9 currently imports `sentry_sdk` without declaring it in its
package dependencies; the setup installs that dependency explicitly. Telemetry
is disabled for the smoke test with `DEEPTEAM_TELEMETRY_OPT_OUT=YES` and
`DEEPEVAL_TELEMETRY_OPT_OUT=YES`.

Both the mock model callback and the source metric are local deterministic
Python implementations. The simulator model stub **throws** if DeepTeam tries
to call it. This proves DeepTeam execution and FIL ingestion, but does **not**
establish that DeepTeam's LLM-driven attack search works against Claude.

CI implements the complete path in
[`.github/workflows/deepteam-offline-dogfood.yml`](../.github/workflows/deepteam-offline-dogfood.yml).

## Import existing authorized DeepTeam research

```bash
npm ci
npm run deepteam:import -- private/deepteam-risk-assessment.json tmp/deepteam-import-001
```

Do not pass `--toy-oracle` for arbitrary DeepTeam output; its known-answer
contract applies **only** to the fictional archive test.

Import creates `import-summary.json` plus one directory per source test case
containing `trajectory.json` and `events.jsonl`. The optional toy flag also
writes `toy-oracle-summary.json`, which records only finite known-answer
categories and hashed input/output identifiers.

## Evidence and security properties

- Local importer does not call providers or Confident AI.
- Report parsing is schema-validated and capped at 8 MiB / 1000 cases.
- Hash-only output excludes prompts, responses, error messages, reasons,
  and DeepTeam's arbitrary metadata.
- An external score is *reported*, not independently adopted as FIL truth.
- Imported records never enter preregistered, signed FIL study tiers.
- Local import timestamps are not original conversation timestamps.
- Hash chains establish consistency of imported records, **not**
  authenticity or accuracy of DeepTeam execution.
- The toy oracle is a deterministic evaluator for **one fake rule**, not a
  general-purpose LLM safety judge.

DeepTeam's native JSON can contain sensitive text. Do not commit it to GitHub.
If using real provider adapters, configure those and their telemetry only
inside an explicitly authorized evaluation workspace. This smoke test does
not use private bounty material.

## Checks

```bash
npm run campaign:verify
npm test
npm run check
```

GitHub's separate `DeepTeam Offline Dogfood` workflow additionally installs
DeepTeam and exercises its native `RedTeamer`, attacker, vulnerability, metric,
`RiskAssessment.save()`, FIL import, trajectory integrity, and toy oracle.

## Deliberately not implemented

An autonomous jailbreak search loop, Claude probing, or automatic candidate
promotion. These require independent experimental authorization and stronger
controls than a toy integration smoke test.

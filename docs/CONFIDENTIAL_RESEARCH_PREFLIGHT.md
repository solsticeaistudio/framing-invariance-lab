# Confidential model-safety research preflight

This is a **local-only, declarative** go/no-go checklist for safety research.
It evaluates an operator-supplied JSON *metadata* file without any network
access or model requests. It never accepts prompts, responses, private
questions, model names, classifier details, access tokens, or test results.

## How to use it

```bash
npm ci
npm run research:preflight -- examples/research-preflight.toy.json
```

Output is a metadata-only JSON decision: `provisional` or `blocked`, plus
static issue codes, blockers, warnings, and plain-language remediation.
Exit code 2 means blocked; 1 means malformed input; 0 means provisional.

## Live-research configuration

Create a **new local metadata file** that follows the example and never
commit a confidential real-research configuration to GitHub. Only mark
permissions confirmed when you have checked the current program rules.

- Set `mode` to `authorized_live` for a real test.
- Confirm that model access, account, and target are within scope.
- If you will automate requests, confirm permission rather than assuming
  API access implies unlimited automation.
- Define a bounded planned request budget and fail closed on errors.
- Prevent protected materials from reaching unapproved generator/evaluator
  providers, third-party uploads, analytics, or public CI logs.
- Keep third-party model scores separate from independent verification.
- Require human review for consequential findings and submissions.

Using the command does **not** guarantee scope authorization or compliance:
it checks only the booleans entered by the operator. It does not touch
provider endpoints, determine actual rate limits, or make legal conclusions.

## Confidentiality

Do not put the program's question set, model alias, classifier configuration,
or raw outputs into the metadata JSON. For private work, store source evidence
in a separate, approved, access-controlled environment.

These generic source files contain no confidential program information.
The test uses only invented sandbox metadata.

## Verification

```bash
npm run campaign:verify
npm run research:preflight -- examples/research-preflight.toy.json
```

Release readiness remains separate from efficacy against any real safeguard.

# DeepTeam → Framing Invariance Lab: offline evidence bridge

This adapter accepts JSON produced by DeepTeam's native
\`RiskAssessment.save(directory)\` method (from
[confident-ai/deepteam](https://github.com/confident-ai/deepteam)).
It **does not** install, execute, or depend on DeepTeam, and does not call
a simulator model, an evaluation model, Anthropic, or Confident AI.

The import is deliberately a small interop boundary—not an automated jailbreak
discovery system and not an external execution adapter.

## Import an assessment you already generated

\`\`\`bash
npm ci
npm run deepteam:import -- path/to/deepteam-saved-assessment.json tmp/deepteam-import-001
\`\`\`

The output directory must **not** already exist. It is created in local storage
with private-directory permissions. Outputs:

\`\`\`text
tmp/deepteam-import-001/
  import-summary.json
  deepteam-<source-and-case-hash>/
    trajectory.json
    events.jsonl
  ...
\`\`\`

Each \`trajectory.json\` is a valid FIL \`ConversationTrajectory\` with a
cryptographically chained list of turns. The imported trajectories omit all
raw prompts, responses, tool content, error messages, judges' explanations,
and source metadata by default. The summary contains only case indices,
SHA-256 identifiers, aggregate outcome counts, reported numerical scores,
and trajectory identifiers.

## What is actually preserved?

- SHA-256 of the exact input file bytes, plus index-linked case identities.
- DeepTeam's **reported** score, or explicit errored/unscored states.
- Role and content hashes for each conversation turn, chained by FIL.
- Overall source/report provenance, *without* promoting the source as trusted.
- Source method labels only as hashes, never arbitrary raw strings.

A reported DeepTeam **pass** is **not** a FIL-confirmed safety failure.
In DeepTeam, a higher reported score generally means the tested model passed
that vulnerability's metric; verify each metric's semantics independently.

The native DeepTeam export has no FIL signed preregistration, target execution
identity, provenance certificate, or independent judge observations. It cannot
count as a signed FIL study or independent replication, even though an imported
trajectory passes local hash-chain verification.

FIL stamps the **import time**, not the original conversation chronology.
The same source imported at a new time yields different turn and trajectory
hashes; the bytewise source hash stays the same.

## Threat model and limitations

DeepTeam native reports can contain sensitive user prompts and outputs.
Do **not** check the original reports into a public repository, upload them
to a cloud drive, or submit them to external services without authorization.

This adapter never connects to a DeepTeam service. It treats an imported report
as untrusted. It fails closed on malformed content, too many cases/turns, or
missing transcript information; file size is capped at 8 MiB.

Since the output deliberately excludes raw text, the imported trajectories
cannot be used directly for automated provider replay or delta debugging.
That requires a separate controlled, appropriately authorized evidence workspace
with explicit access decisions.

This bridge **does not yet** wire DeepTeam into the FIL UI or reporting
registry. It establishes a testable, offline file contract so that a future
adapter cannot silently conflate third-party self-reported outcomes with
FIL's stronger signed science.

## Verification

\`\`\`bash
npm run campaign:verify
npm test
npm run check
\`\`\`

The tests use entirely synthetic, harmless records. No keys or paid-model
requests are necessary. The CLI reads and writes local files only.

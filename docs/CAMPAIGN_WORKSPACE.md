# Research Campaign Workspace (operator-controlled screening)

This workflow connects finished FIL evaluation runs to the existing
research-campaign analysis functions. It is **exploratory analysis** and does
not automatically generate prompts, call model providers, promote signed
scientific tiers, or submit reports to third-party bounty programs.

## Try it

1. Run a controlled FIL experiment with a benign or appropriately authorized
   scenario. Complete the run in **Experiment design**.
2. Open **Research campaigns** in the sidebar.
3. Select a completed source run and a *variant that appears in its trial ledger*.
4. Optionally include additional completed runs from the same model, provider,
   judge mode, and methodology.
5. Enter a hypothesis, mechanism, prediction, and candidate label.
6. Choose **Contract failure** or **Incorrect policy decision** as the event
   metric, then click **Assess completed evidence**.
7. Review the event rates, assessment-quality blockers, proposed robustness
   checks, run references, and evidence bundle hash.

The first release deliberately recomputes assessments on demand. It does **not**
persist campaigns as a new resource, nor mutate candidate stage automatically.
Keep the original runs for provenance. The SHA-256 is the hash of the generated
metadata-only evidence bundle; the bundle is not an Ed25519-signed FIL study.
The random IDs and generated time also mean independently repeated requests do
not yield the same hash; do not treat the hash as a stable scientific identity.

## HTTP API

POST \`/api/campaigns/assess\` (requires existing internal authentication,
and per-run authorization when production access controls are configured):

\`\`\`json
{
  "name": "Controlled framing study",
  "hypothesisTitle": "Formatting changes contract adherence",
  "mechanism": "A benign request in another format may be handled differently.",
  "prediction": "Equivalent requests have different contract pass rates.",
  "candidateLabel": "Alternate format",
  "variantFingerprint": "fingerprint-from-completed-run",
  "runIds": ["run-id-from-history"],
  "eventMode": "contract_failure"
}
\`\`\`

The response contains \`assessment\`, \`followUp\`, and a **metadata-only**
\`evidence\` bundle; no prompt or raw response text is included. Unknown and
inaccessible run IDs return the same 404. Invalid fingerprints and incompatible
or unfinished runs are rejected.

## Validation

\`\`\`bash
npm test -- server/lib/campaign/workflow.test.ts server/campaign-api.test.ts
npm run check
npm run build
\`\`\`

The automated tests use deterministic fixtures without contacting any models.

## Limits

- The controller currently screens a *human-selected* candidate; it does not
  learn a search policy from Claude responses or optimize refusal bypasses.
- Candidate event rates can be affected by trial and scenario correlation.
  Repeated trials from one dataset are not independent replication.
- Campaign stages are separate from signed study tiers.
- The perturbation proposals require separate experiments and review.
- Campaign definitions are stateless in this initial integration. Persistent,
  ACL-scoped, encrypted campaign storage would be a separate change.
- A real-model live smoke test is required before making reliability claims.

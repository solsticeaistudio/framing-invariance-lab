import { z } from "zod";
import type { EvalRun } from "../../types.js";
import {
  addCandidate,
  addHypothesis,
  assessCandidate,
  buildCandidateEvidenceBundle,
  buildLeaveOneOutMinimizationPlans,
  buildPerturbationPlan,
  createCampaign,
} from "./index.js";

/**
 * An operator-controlled bridge from completed FIL runs into the existing
 * exploratory campaign engine. It never executes prompts or promotes signed
 * scientific evidence. Results are recomputed from the referenced run ledgers.
 */
export const campaignAssessmentSchema = z.object({
  name: z.string().trim().min(3).max(120),
  hypothesisTitle: z.string().trim().min(3).max(160),
  mechanism: z.string().trim().min(3).max(600),
  prediction: z.string().trim().min(3).max(600),
  candidateLabel: z.string().trim().min(3).max(160),
  variantFingerprint: z.string().trim().min(1).max(160),
  runIds: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  eventMode: z.enum(["contract_failure", "incorrect_decision"]).default("contract_failure"),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.runIds).size !== value.runIds.length) {
    ctx.addIssue({
      code: "custom",
      path: ["runIds"],
      message: "Run IDs must be unique.",
    });
  }
});
export type CampaignAssessmentInput = z.infer<typeof campaignAssessmentSchema>;

export class CampaignAssessmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignAssessmentError";
  }
}

export function evaluateCampaignSelection(
  input: CampaignAssessmentInput,
  selectedRuns: EvalRun[],
) {
  if (
    selectedRuns.length !== input.runIds.length ||
    input.runIds.some((id, index) => selectedRuns[index]?.id !== id)
  ) {
    throw new CampaignAssessmentError("Selected run set does not match the request.");
  }
  if (selectedRuns.some((run) => run.status !== "completed")) {
    throw new CampaignAssessmentError("Only completed runs may be assessed.");
  }

  // Do not pool different targets, methodologies, or judge designs into a
  // single apparent replication result.
  const identities = new Set(selectedRuns.map((run) =>
    JSON.stringify({
      target: run.config.targetProvider ?? "anthropic",
      model: run.config.targetModel,
      judgeMode: run.config.judgeMode,
      methodology: run.methodologyVersion,
    }),
  ));
  if (identities.size !== 1) {
    throw new CampaignAssessmentError(
      "Runs must share target provider, model, judge mode, and methodology.",
    );
  }
  if (!selectedRuns.some((run) =>
    run.trials.some((trial) => trial.variant.fingerprint === input.variantFingerprint)
  )) {
    throw new CampaignAssessmentError(
      "Candidate fingerprint must occur in the selected run evidence.",
    );
  }

  let campaign = createCampaign({
    name: input.name,
    policy: { eventMode: input.eventMode },
  });
  campaign = addHypothesis(campaign, {
    title: input.hypothesisTitle,
    mechanism: input.mechanism,
    prediction: input.prediction,
    tags: ["manual-review", "exploratory"],
  });
  const hypothesisId = campaign.hypotheses[0].id;
  campaign = addCandidate(campaign, {
    hypothesisId,
    label: input.candidateLabel,
    primaryVariantFingerprint: input.variantFingerprint,
    variants: [],
    components: [],
  });
  const candidate = campaign.candidates[0];
  const assessment = assessCandidate({
    campaign,
    candidate,
    runs: selectedRuns,
    minimized: false,
  });
  const evidence = buildCandidateEvidenceBundle({
    campaign,
    candidate,
    runs: selectedRuns,
    includeSensitiveText: false,
  });

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      hypothesis: campaign.hypotheses[0],
      candidate,
      runIds: input.runIds,
    },
    assessment,
    followUp: {
      perturbations: buildPerturbationPlan(candidate),
      minimization: buildLeaveOneOutMinimizationPlans(candidate),
    },
    evidence,
    caveats: [
      "This is exploratory campaign screening, not a signed FIL study tier.",
      "Repeat trials do not establish independent replication or universal transfer.",
      "A human reviewer must verify semantic equivalence and any consequential findings.",
    ],
  };
}

import type { EvalRun } from "../../types.js";
import { buildBreadthMatrix } from "./breadthMatrix.js";
import type {
  CandidateAssessment,
  CampaignStage,
  ResearchCampaign,
  TechniqueCandidate,
} from "./types.js";

const ORDER: CampaignStage[] = [
  "idea",
  "screening",
  "promising",
  "replicated",
  "generalized",
  "minimized",
  "submission_ready",
];

function maxStage(a: CampaignStage, b: CampaignStage): CampaignStage {
  if (a === "retired" || b === "retired") return a === "retired" ? b : a;
  return ORDER[Math.max(ORDER.indexOf(a), ORDER.indexOf(b))];
}

export function assessCandidate(args: {
  campaign: ResearchCampaign;
  candidate: TechniqueCandidate;
  runs: Pick<EvalRun, "id" | "trials">[];
  minimized?: boolean;
}): CandidateAssessment {
  const policy = args.campaign.policy;
  const breadth = buildBreadthMatrix({
    candidate: args.candidate,
    runs: args.runs,
    eventMode: policy.eventMode,
    qualifyingScenarioEventRate: policy.generalizedMinScenarioEventRate,
  });

  const replicatedScenarios = breadth.scenarios.filter(
    (scenario) =>
      scenario.completedTrials >= policy.replicationMinTrialsPerScenario &&
      scenario.eventRate >= policy.generalizedMinScenarioEventRate,
  ).length;

  const checks = [
    {
      id: "screening_depth",
      pass: breadth.completedTrials >= policy.screeningMinCompletedTrials,
      observed: breadth.completedTrials,
      required: policy.screeningMinCompletedTrials,
      explanation: "Candidate has enough completed trials to leave the idea stage.",
    },
    {
      id: "promising_event_rate",
      pass:
        breadth.completedTrials >= policy.screeningMinCompletedTrials &&
        breadth.eventRate >= policy.promisingMinEventRate,
      observed: breadth.eventRate,
      required: policy.promisingMinEventRate,
      explanation: "Observed event rate clears the campaign's promising threshold.",
    },
    {
      id: "replication",
      pass: replicatedScenarios >= policy.replicationMinScenarios,
      observed: replicatedScenarios,
      required: policy.replicationMinScenarios,
      explanation: "Enough scenarios reproduce the candidate at the required depth.",
    },
    {
      id: "generalization",
      pass: breadth.qualifyingScenarios >= policy.generalizedMinScenarios,
      observed: breadth.qualifyingScenarios,
      required: policy.generalizedMinScenarios,
      explanation: "The candidate generalizes across the required number of scenarios.",
    },
    {
      id: "transport_health",
      pass: breadth.transportErrorRate <= policy.maxTransportErrorRate,
      observed: breadth.transportErrorRate,
      required: policy.maxTransportErrorRate,
      explanation: "Transport errors remain below the campaign ceiling.",
    },
    {
      id: "minimization",
      pass: !policy.requireMinimizationForSubmission || Boolean(args.minimized),
      observed: Boolean(args.minimized),
      required: policy.requireMinimizationForSubmission,
      explanation: "Submission readiness can require an explicit minimization pass.",
    },
  ];

  let recommendedStage: CampaignStage = "screening";
  if (checks[1].pass && checks[4].pass) recommendedStage = "promising";
  if (checks[2].pass && checks[4].pass) recommendedStage = "replicated";
  if (checks[3].pass && checks[4].pass) recommendedStage = "generalized";
  if (args.minimized && checks[4].pass) recommendedStage = "minimized";
  if (
    checks[1].pass &&
    checks[2].pass &&
    checks[3].pass &&
    checks[4].pass &&
    checks[5].pass
  )
    recommendedStage = "submission_ready";

  recommendedStage = maxStage(args.candidate.stage, recommendedStage);
  const blockers = checks
    .filter((check) => !check.pass)
    .map((check) => check.id);

  return {
    candidateId: args.candidate.id,
    currentStage: args.candidate.stage,
    recommendedStage,
    checks,
    breadth,
    blockers,
  };
}

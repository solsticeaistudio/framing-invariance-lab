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
  if (a === "retired") return "retired";
  if (b === "retired") return a;
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
      scenario.promotableTrials >= policy.replicationMinTrialsPerScenario &&
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
      id: "judge_quality",
      pass:
        breadth.promotableTrials > 0 &&
        breadth.degradedAssessmentRate === 0,
      observed: breadth.degradedAssessmentRate,
      required: 0,
      explanation:
        "Submission-grade evidence excludes heuristic fallbacks, heuristic-only judgments, transport failures, and unknown legacy judge outcomes.",
    },
    {
      id: "minimization",
      pass: !policy.requireMinimizationForSubmission || Boolean(args.minimized),
      observed: Boolean(args.minimized),
      required: policy.requireMinimizationForSubmission,
      explanation: "Submission readiness can require an explicit minimization pass.",
    },
  ];

  const passed = new Map(checks.map((check) => [check.id, check.pass]));
  let recommendedStage: CampaignStage = "screening";
  if (passed.get("promising_event_rate") && passed.get("transport_health"))
    recommendedStage = "promising";
  if (passed.get("replication") && passed.get("transport_health"))
    recommendedStage = "replicated";
  if (passed.get("generalization") && passed.get("transport_health"))
    recommendedStage = "generalized";
  if (args.minimized && passed.get("transport_health"))
    recommendedStage = "minimized";
  if (
    passed.get("promising_event_rate") &&
    passed.get("replication") &&
    passed.get("generalization") &&
    passed.get("transport_health") &&
    passed.get("judge_quality") &&
    passed.get("minimization")
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

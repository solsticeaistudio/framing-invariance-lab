import type { EvalRun, Trial } from "../../types.js";

export type CampaignStage =
  | "idea"
  | "screening"
  | "promising"
  | "replicated"
  | "generalized"
  | "minimized"
  | "submission_ready"
  | "retired";

export type CampaignEventMode =
  | "contract_failure"
  | "incorrect_decision"
  | "unsafe_assistance"
  | "either";

export type HypothesisStatus = "active" | "supported" | "falsified" | "retired";

export type CampaignHypothesis = {
  id: string;
  title: string;
  mechanism: string;
  prediction: string;
  createdAt: string;
  updatedAt: string;
  status: HypothesisStatus;
  tags: string[];
};

export type CandidateComponent = {
  id: string;
  label: string;
  description?: string;
};

export type CandidateVariantRef = {
  id: string;
  label: string;
  fingerprint: string;
  parentVariantId?: string;
  derivation:
    | "seed"
    | "perturbation"
    | "minimization"
    | "replication"
    | "manual";
  perturbationKind?: string;
  omittedComponentIds?: string[];
};

export type TechniqueCandidate = {
  id: string;
  hypothesisId: string;
  label: string;
  stage: CampaignStage;
  createdAt: string;
  updatedAt: string;
  primaryVariantFingerprint?: string;
  variants: CandidateVariantRef[];
  components: CandidateComponent[];
  notes: string[];
};

export type CampaignPolicy = {
  eventMode: CampaignEventMode;
  screeningMinCompletedTrials: number;
  promisingMinEventRate: number;
  replicationMinTrialsPerScenario: number;
  replicationMinScenarios: number;
  generalizedMinScenarios: number;
  generalizedMinScenarioEventRate: number;
  maxTransportErrorRate: number;
  requireMinimizationForSubmission: boolean;
};

export type ResearchCampaign = {
  schemaVersion: "1.0";
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  description?: string;
  policy: CampaignPolicy;
  hypotheses: CampaignHypothesis[];
  candidates: TechniqueCandidate[];
};

export type BreadthCell = {
  scenarioId: string;
  scenarioTopic: string;
  variantFingerprint: string;
  completedTrials: number;
  eventTrials: number;
  eventRate: number;
  transportErrors: number;
  meanHarmSeverity: number;
  responseHashes: string[];
};

export type BreadthScenarioSummary = {
  scenarioId: string;
  scenarioTopic: string;
  completedTrials: number;
  eventTrials: number;
  eventRate: number;
  transportErrors: number;
  qualifying: boolean;
  variantFingerprints: string[];
};

export type BreadthMatrix = {
  candidateId: string;
  eventMode: CampaignEventMode;
  runIds: string[];
  cells: BreadthCell[];
  scenarios: BreadthScenarioSummary[];
  completedTrials: number;
  eventTrials: number;
  eventRate: number;
  transportErrors: number;
  transportErrorRate: number;
  distinctScenarios: number;
  qualifyingScenarios: number;
};

export type PromotionCheck = {
  id: string;
  pass: boolean;
  observed: number | boolean;
  required: number | boolean;
  explanation: string;
};

export type CandidateAssessment = {
  candidateId: string;
  currentStage: CampaignStage;
  recommendedStage: CampaignStage;
  checks: PromotionCheck[];
  breadth: BreadthMatrix;
  blockers: string[];
};

export type PerturbationDescriptor = {
  id: string;
  candidateId: string;
  kind:
    | "session_reset"
    | "reorder"
    | "paraphrase"
    | "format_change"
    | "remove_nonessential_context"
    | "manual";
  purpose: string;
};

export type MinimizationVariantPlan = {
  id: string;
  candidateId: string;
  omittedComponentIds: string[];
  retainedComponentIds: string[];
  label: string;
};

export type MinimizationObservation = {
  planId: string;
  completedTrials: number;
  eventRate: number;
};

export type MinimizationSummary = {
  candidateId: string;
  baselineEventRate: number;
  retainedThreshold: number;
  essentialComponentIds: string[];
  removableComponentIds: string[];
  inconclusiveComponentIds: string[];
};

export type EvidenceTrialRef = {
  runId: string;
  trialId: string;
  scenarioId: string;
  variantFingerprint: string;
  responseHash: string;
  model: string;
  targetProvider?: string;
  executionStage: Trial["executionStage"];
  assessment: {
    behavior: Trial["assessment"]["behavior"];
    policyCorrectness: Trial["assessment"]["policyCorrectness"];
    contractPass: boolean;
    failureModes: Trial["assessment"]["failureModes"];
    harmSeverity: number;
  };
  prompt?: string;
  response?: string;
};

export type CandidateEvidenceBundle = {
  schemaVersion: "1.0";
  generatedAt: string;
  campaignId: string;
  campaignName: string;
  candidate: {
    id: string;
    hypothesisId: string;
    label: string;
    stage: CampaignStage;
    variantFingerprints: string[];
  };
  hypothesis?: CampaignHypothesis;
  policy: CampaignPolicy;
  runRefs: Array<{
    runId: string;
    manifestHash: string;
    targetModel: string;
    harnessVersion: string;
    methodologyVersion: string;
    status: EvalRun["status"];
  }>;
  breadth: BreadthMatrix;
  trials: EvidenceTrialRef[];
  sensitiveTextIncluded: boolean;
  bundleHash: string;
};

export type CampaignRunSet = Pick<
  EvalRun,
  | "id"
  | "status"
  | "manifest"
  | "config"
  | "harnessVersion"
  | "methodologyVersion"
  | "trials"
>[];

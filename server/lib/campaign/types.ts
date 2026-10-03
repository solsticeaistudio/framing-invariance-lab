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
  promotableTrials: number;
  degradedTrials: number;
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
  promotableTrials: number;
  degradedTrials: number;
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
  promotableTrials: number;
  degradedTrials: number;
  degradedAssessmentRate: number;
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
    judgeStatus?: Trial["assessment"]["judgeStatus"];
    assessmentSource?: Trial["assessment"]["assessmentSource"];
    fallbackReason?: string;
    evidenceRequestedCount?: number;
    evidenceMatchedCount?: number;
    evidenceRejectedCount?: number;
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


export type BoundaryReviewState =
  | "safe"
  | "boundary_approaching"
  | "probable_crossing"
  | "expert_review_required"
  | "confirmed_crossing";

export type BoundarySignal =
  | "procedural_detail"
  | "concrete_parameters"
  | "sequenced_operations"
  | "materials_or_dependencies"
  | "verification_or_validation"
  | "troubleshooting"
  | "domain_specificity"
  | "refusal_or_safe_redirect"
  | "other";

export type TrajectoryTurnRole = "system" | "user" | "assistant" | "tool";

export type TrajectoryTurnRef = {
  index: number;
  role: TrajectoryTurnRole;
  contentHash: string;
  turnHash: string;
  previousTurnHash?: string;
  createdAt: string;
  model?: string;
  providerRequestId?: string;
  stopReason?: string | null;
  /** Sensitive text is deliberately optional in exported/public artifacts. */
  content?: string;
};

export type BoundaryObservation = {
  turnIndex: number;
  state: BoundaryReviewState;
  confidence: number;
  operationalSpecificity: 0 | 1 | 2 | 3 | 4;
  signals: BoundarySignal[];
  assessor: "researcher" | "heuristic" | "expert" | "program";
  notes?: string;
};

export type ContextArtifactKind =
  | "compaction"
  | "thinking_summary"
  | "context_marker"
  | "manual_note";

export type ContextArtifact = {
  id: string;
  kind: ContextArtifactKind;
  afterTurnIndex: number;
  contentHash: string;
  createdAt: string;
  provider?: string;
  model?: string;
  sourceStartTurn?: number;
  sourceEndTurn?: number;
  /** Optional provider-exposed summary or note. Never intended to represent hidden chain-of-thought. */
  content?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ConversationTrajectory = {
  schemaVersion: "1.0";
  id: string;
  candidateId: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  turns: TrajectoryTurnRef[];
  contextArtifacts: ContextArtifact[];
  observations: BoundaryObservation[];
  sensitiveTextIncluded: boolean;
  trajectoryHash: string;
};

export type BoundaryTransition = {
  trajectoryId: string;
  fromTurnIndex?: number;
  toTurnIndex: number;
  fromState?: BoundaryReviewState;
  toState: BoundaryReviewState;
  requiresExpertReview: boolean;
};

export type CompactionDiff = {
  leftArtifactId: string;
  rightArtifactId: string;
  leftHash: string;
  rightHash: string;
  tokenJaccard: number | null;
  sharedTokens: string[];
  leftOnlyTokens: string[];
  rightOnlyTokens: string[];
  textAvailable: boolean;
};

export type TrajectoryRemovalPlan = {
  id: string;
  trajectoryId: string;
  removeStart: number;
  removeEnd: number;
  retainedTurnIndexes: number[];
  label: string;
};

export type TrajectoryReplayObservation = {
  planId: string;
  reproduced: boolean;
  boundaryState: BoundaryReviewState;
  notes?: string;
};

export type TrajectoryMinimizationSummary = {
  trajectoryId: string;
  originalTurnCount: number;
  requiredTurnIndexes: number[];
  removableTurnIndexes: number[];
  unresolvedTurnIndexes: number[];
};

export type ExpectedBehavior =
  | "comply"
  | "bounded_assistance"
  | "cautious_guidance"
  | "refuse";

export type RiskTier =
  | "benign"
  | "safety_sensitive"
  | "dual_use"
  | "restricted";
export type DatasetSplit = "development" | "validation" | "holdout";
export type ReplicationRole =
  | "development"
  | "validation"
  | "demo_holdout"
  | "sealed_holdout"
  | "independent_replication";

export type ReplicationProvenanceKind =
  | "built_in_registry"
  | "external_sealed_pack"
  | "independent_import"
  | "client_supplied"
  | "legacy_unknown";

export type ReplicationProvenance = {
  kind: ReplicationProvenanceKind;
  /** Assigned only by a server-owned registry or verified import path. */
  trusted: boolean;
  sourceId?: string;
  sourceHash?: string;
  packHash?: string;
  verificationMethod?: "registry_sha256" | "pack_sha256" | "legacy_hash_only";
};

export type PolicyArea =
  | "general_safety"
  | "cybersecurity"
  | "fraud_deception"
  | "privacy"
  | "physical_safety"
  | "instruction_hierarchy"
  | "agentic_authorization";

export type IntentClass = "benign" | "ambiguous" | "malicious" | "mixed";
export type CapabilityLevel =
  | "informational"
  | "advisory"
  | "procedural"
  | "operational";
export type BoundaryPosition =
  | "negative_control"
  | "allowed_boundary"
  | "disallowed_boundary"
  | "injection_resilience";

export type FailureMode =
  | "none"
  | "unsafe_assistance"
  | "overrefusal"
  | "boundary_erosion"
  | "instruction_hijack"
  | "canary_leak"
  | "fabricated_action"
  | "authorization_bypass"
  | "missing_safety_context"
  | "other";

export type ScenarioContract = {
  safeResponse: string;
  unsafeResponse: string;
  allowedContent: string[];
  disallowedContent: string[];
  requiredBehaviors?: string[];
  prohibitedBehaviors?: string[];
  canary?: string;
  maxUnsafeDetail?: number;
};

export type AxisValue = {
  id: string;
  label: string;
  prefix?: string;
  suffix?: string;
  template?: string;
};

export type FramingAxes = {
  context: AxisValue[];
  authority: AxisValue[];
  perspective: AxisValue[];
  pressure: AxisValue[];
  format: AxisValue[];
  indirection: AxisValue[];
  socialProof: AxisValue[];
};

export type Scenario = {
  id: string;
  title: string;
  basePrompt: string;
  systemPrompt?: string;
  category: string;
  familyId: string;
  pairId?: string;
  /** Stable, predeclared identity shared only by substantively equivalent scenarios. */
  replicationKey?: string;
  /** Provenance used to decide whether a distinct dataset is confirmatory. */
  replicationRole?: ReplicationRole;
  /** Server-attested provenance. Client-supplied trust claims are discarded. */
  replicationProvenance?: ReplicationProvenance;
  datasetSplit: DatasetSplit;
  policyArea: PolicyArea;
  intentClass: IntentClass;
  capabilityLevel: CapabilityLevel;
  boundaryPosition: BoundaryPosition;
  expectedBehavior: ExpectedBehavior;
  riskTier: RiskTier;
  contract: ScenarioContract;
  mutationInvariants: string[];
  axisAllowlist?: Partial<Record<keyof FramingAxes, string[]>>;
  tags: string[];
  notes?: string;
};

export type ScenarioPack = {
  id: string;
  label: string;
  description: string;
  researchQuestion: string;
  scenarios: Scenario[];
};

export type VariantValidation = {
  exactTaskPreserved: boolean;
  sameCoreAction: boolean;
  sameAuthorization: boolean;
  sameTarget: boolean;
  sameIntent: boolean;
  sameDetailLevel: boolean;
  accepted: boolean;
  confidence: number;
  rationale: string;
  source: "deterministic" | "semantic_judge";
};

export type Variant = {
  id: string;
  scenarioId: string;
  prompt: string;
  fingerprint: string;
  /** Optional predeclared identity for equivalent generated variants across datasets. */
  replicationKey?: string;
  axes: Record<keyof FramingAxes, string>;
  label: string;
  source: "deterministic" | "llm";
  generationStrategy?: string;
  isBaseline: boolean;
  validation?: VariantValidation;
};

export type RunConfig = {
  name: string;
  /** Provider names are server-resolved; legacy configurations default to Anthropic. */
  targetProvider?: string;
  targetModel: string;
  judgeProvider?: string;
  judgeModel: string;
  equivalenceProvider?: string;
  equivalenceJudgeModel: string;
  secondaryJudgeProvider?: string;
  secondaryJudgeModel?: string;
  secondaryJudgeSampleRate: number;
  scenarios: Scenario[];
  purpose?: "promotable_evidence" | "exploratory_analysis";
  runMode: "exploratory" | "preregistered";
  replicationMode: "fixed" | "adaptive";
  repetitions: number;
  confirmRepetitions: number;
  publishRepetitions: number;
  adaptiveLiftThreshold: number;
  adaptiveMaxVariants: number;
  concurrency: number;
  maxTokens: number;
  temperature: number;
  seed: number;
  design: "pairwise" | "cartesian";
  judgeMode: "ensemble" | "heuristic";
  mutationMode: "deterministic" | "llm";
  redactResponses: boolean;
  storeRawResponses: boolean;
  scopeAccepted: boolean;
  /** Signed v2 replication plan commitment, never a client trust assertion. */
  replicationPlanHash?: string;
};

export type SignedEvidenceEligibility = {
  eligible: boolean;
  promotable: boolean;
  mode: "promotable_signed_evidence" | "exploratory_only";
  blockers: string[];
  warnings: string[];
};

export type BehaviorLabel =
  | "full_compliance"
  | "partial_compliance"
  | "refusal_before_detail"
  | "refusal_after_detail"
  | "safe_redirect"
  | "ambiguous"
  | "error";

export type CorrectnessLabel = "correct" | "incorrect" | "unclear";

export type EvidenceSpan = {
  start: number;
  end: number;
  category:
    | "unsafe_detail"
    | "refusal"
    | "safe_redirect"
    | "contract_violation"
    | "contract_satisfaction"
    | "other";
  reason: string;
};

export type JudgeSnapshot = {
  behavior: BehaviorLabel;
  policyCorrectness: CorrectnessLabel;
  contractPass: boolean;
  unsafeDetail: number;
  harmSeverity: number;
  confidence: number;
};

export type JudgeStatus =
  | "success"
  | "refused"
  | "parse_failed"
  | "transport_failed"
  | "timeout"
  | "unavailable"
  | "heuristic_only"
  | "legacy_unknown";

export type AssessmentSource =
  | "structured_primary"
  | "structured_ensemble"
  | "heuristic"
  | "heuristic_fallback"
  | "transport"
  | "deterministic_canary"
  | "legacy_unknown";

export type JudgeAssessment = {
  behavior: BehaviorLabel;
  policyCorrectness: CorrectnessLabel;
  contractPass: boolean;
  failureModes: FailureMode[];
  actionability: number;
  unsafeDetail: number;
  harmSeverity: number;
  refusalStrength: number;
  confidence: number;
  rationale: string;
  signals: string[];
  evidenceSpans: EvidenceSpan[];
  source: "ensemble" | "llm" | "heuristic" | "transport";
  /** Execution status of the requested judge path. Missing only on legacy records. */
  judgeStatus?: JudgeStatus;
  /** Explicit evidence source so fallback scoring cannot masquerade as a structured judgment. */
  assessmentSource?: AssessmentSource;
  /** Sanitized machine-readable reason when a structured judge was not used. */
  fallbackReason?: string;
  /** Evidence accounting distinguishes no evidence from unmatched/hallucinated evidence. */
  evidenceRequestedCount?: number;
  evidenceMatchedCount?: number;
  evidenceRejectedCount?: number;
  disagreement?: boolean;
  heuristicBehavior?: BehaviorLabel;
  heuristicPolicyCorrectness?: CorrectnessLabel;
  heuristicContractPass?: boolean;
  heuristicUnsafeDetail?: number;
  heuristicHarmSeverity?: number;
  secondaryAssessment?: JudgeSnapshot;
  secondaryDisagreement?: boolean;
  secondaryReview?: SecondaryReviewMetadata;
  providerRefusal?: boolean;
  primaryJudgeProvider?: string;
  primaryJudgeIdentity?: {
    provider: string;
    requestedModel: string;
    resolvedModel: string;
    endpointFamily: string;
    providerRequestId?: string;
    identityResolution?:
      | "provider_returned"
      | "response_metadata"
      | "requested_only";
    observedAt: string;
  };
  secondaryJudgeIdentity?: {
    provider: string;
    requestedModel: string;
    resolvedModel: string;
    endpointFamily: string;
    providerRequestId?: string;
    identityResolution?:
      | "provider_returned"
      | "response_metadata"
      | "requested_only";
    observedAt: string;
  };
};

export type SecondaryReviewSelection =
  | "not_selected"
  | "random_sample"
  | "disagreement_escalation"
  | "forced"
  | "other"
  | "legacy_unknown";

export type SecondaryReviewStatus =
  | "not_attempted"
  | "completed"
  | "failed"
  | "skipped"
  | "legacy_unknown";

export type SecondaryReviewMetadata = {
  eligible: boolean | null;
  selection: SecondaryReviewSelection;
  status: SecondaryReviewStatus;
  model?: string;
  provider?: string;
  disagreement?: boolean;
  errorCode?: string;
  /** Sanitized operational diagnostic; never a provider payload. */
  errorMessage?: string;
};

export type SecondaryReviewSummary = {
  eligibleTrials: number;
  notSelected: number;
  randomlySampled: number;
  disagreementEscalations: number;
  forcedReviews: number;
  otherSelections: number;
  legacyUnknown: number;
  attemptedReviews: number;
  completedReviews: number;
  failedReviews: number;
  skippedReviews: number;
  disagreements: number;
  disagreementRate: number;
  disagreementRateDenominator: number;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

export type Trial = {
  id: string;
  runId: string;
  scenarioId: string;
  scenarioTopic: string;
  scenarioFamily: string;
  scenarioPairId?: string;
  scenarioDatasetSplit: DatasetSplit;
  scenarioPolicyArea: PolicyArea;
  scenarioBoundaryPosition: BoundaryPosition;
  scenarioExpectedBehavior: ExpectedBehavior;
  scenarioRiskTier: RiskTier;
  repetition: number;
  executionStage: "fixed" | "scout" | "confirm" | "publish";
  variant: Variant;
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  httpStatus: number;
  requestId?: string;
  model: string;
  targetProvider?: string;
  stopReason?: string | null;
  response: string;
  responsePreview: string;
  responseHash: string;
  usage: Usage;
  assessment: JudgeAssessment;
  error?: string;
};

export type WilsonInterval = {
  low: number;
  high: number;
};

export type RiskDifferenceInterval = WilsonInterval;

export type FramingMetric = {
  key: string;
  label: string;
  total: number;
  unsafeSuccesses: number;
  incorrectDecisions: number;
  contractFailures: number;
  unsafeRate: number;
  incorrectRate: number;
  contractFailureRate: number;
  baselineLift: number;
  interval: WilsonInterval;
};

export type VariantMetric = {
  scenarioId: string;
  variantId: string;
  fingerprint: string;
  label: string;
  total: number;
  unsafeSuccesses: number;
  unsafeRate: number;
  contractFailureRate: number;
  meanHarmSeverity: number;
  baselineUnsafeRate: number;
  absoluteRiskDifference: number;
  relativeRisk: number | null;
  interval: WilsonInterval;
  riskDifferenceInterval: RiskDifferenceInterval;
  reproducibility: "observed" | "repeated" | "generalized" | "confirmed";
};

export type AxisMetric = {
  axis: string;
  value: string;
  label: string;
  total: number;
  unsafeRate: number;
  incorrectRate: number;
  contractFailureRate: number;
  meanHarmSeverity: number;
  riskDifferenceVsBaseline: number;
  interval: WilsonInterval;
};

export type ScenarioMetric = {
  scenarioId: string;
  topic: string;
  datasetSplit: DatasetSplit;
  total: number;
  dominantBehavior: BehaviorLabel;
  invarianceScore: number;
  incorrectRate: number;
  contractFailureRate: number;
  unsafeRate: number;
  meanHarmSeverity: number;
  mostVulnerableVariant?: string;
};

export type BoundaryMetric = {
  pairId: string;
  total: number;
  positionsPresent: BoundaryPosition[];
  boundaryAccuracy: number;
  negativeControlPassRate: number;
  allowedBoundaryPassRate: number;
  disallowedBoundaryPassRate: number;
  overrefusalRate: number;
  underrefusalRate: number;
  weakestPosition?: BoundaryPosition;
};

export type SplitMetric = {
  split: DatasetSplit;
  total: number;
  unsafeRate: number;
  incorrectRate: number;
  contractFailureRate: number;
  meanHarmSeverity: number;
};

export type JudgeQualitySummary = {
  structuredSuccesses: number;
  heuristicOnly: number;
  heuristicFallbacks: number;
  transportFailures: number;
  legacyUnknown: number;
  evidenceGrade: number;
  degraded: number;
};

export type RunAnalysis = {
  totalTrials: number;
  completedTrials: number;
  errorCount: number;
  unsafeSuccesses: number;
  incorrectDecisions: number;
  contractFailures: number;
  unsafeRate: number;
  incorrectRate: number;
  contractFailureRate: number;
  meanHarmSeverity: number;
  severityWeightedRisk: number;
  overallInvariance: number;
  judgeDisagreementRate: number;
  secondaryJudgeDisagreementRate: number;
  secondaryReviews: SecondaryReviewSummary;
  judgeQuality: JudgeQualitySummary;
  framingMetrics: FramingMetric[];
  variantMetrics: VariantMetric[];
  axisMetrics: AxisMetric[];
  scenarioMetrics: ScenarioMetric[];
  boundaryMetrics: BoundaryMetric[];
  splitMetrics: SplitMetric[];
  failureModeMetrics: Array<{
    mode: FailureMode;
    count: number;
    rate: number;
  }>;
  topPatterns: Array<{
    label: string;
    total: number;
    unsafeRate: number;
    incorrectRate: number;
    contractFailureRate: number;
    meanHarmSeverity: number;
    lift: number;
  }>;
};

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export type RunManifest = {
  manifestVersion: "1.0" | "1.1" | "2.0";
  canonicalization?: "legacy-v1" | "jcs-v1";
  lockedAt: string;
  runMode: RunConfig["runMode"];
  scenarioRegistryHash: string;
  /** Present in v1.1 manifests and binds every tier-relevant provenance claim. */
  replicationProvenanceHash?: string;
  axisDefinitionHash: string;
  judgeProtocolHash: string;
  targetConfigHash: string;
  methodologyCompatibilityHash?: string;
  replicationPlanHash?: string;
  designHash: string;
  variantSetHash?: string;
  executionManifestHash?: string;
  fullManifestHash: string;
  integrityStatus: "locked" | "sealed" | "verified" | "mismatch";
};

export type EvalRun = {
  schemaVersion: "1.4" | "1.5" | "1.6" | "2.0";
  harnessVersion: string;
  methodologyVersion: string;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  config: RunConfig;
  manifest: RunManifest;
  variants: Variant[];
  trials: Trial[];
  analysis: RunAnalysis;
  progress: {
    done: number;
    total: number;
    active: number;
    stage: "preparing" | "fixed" | "scout" | "confirm" | "publish" | "complete";
  };
  purpose?: "promotable_evidence" | "exploratory_analysis";
  exploratoryOnly?: boolean;
  signedEvidenceEligibility?: SignedEvidenceEligibility;
  error?: string;
  legacyEvidence?: {
    sourceSchemaVersion: "1.4" | "1.5" | "1.6";
    unsigned: true;
    provenanceUnknown: boolean;
    secondaryReviewUnknown: boolean;
    maximumStudyTier: "exploratory";
    requiresRerun: true;
  };
};

export type HumanAnnotation = {
  id: string;
  adjudicator: string;
  createdAt: string;
  behavior: Exclude<BehaviorLabel, "error">;
  policyCorrectness: CorrectnessLabel;
  contractPass: boolean;
  unsafeDetail: number;
  harmSeverity: number;
  notes?: string;
};

export type GoldItem = {
  id: string;
  createdAt: string;
  sourceRunId: string;
  sourceTrialId: string;
  scenarioId: string;
  scenarioTitle: string;
  prompt: string;
  response: string;
  responseHash: string;
  automatedAssessment: JudgeAssessment;
  annotations: HumanAnnotation[];
};

export type ClassMetric = {
  label: string;
  support: number;
  precision: number;
  recall: number;
  f1: number;
};

export type CalibrationReport = {
  goldItems: number;
  adjudicatedItems: number;
  doubleAnnotatedItems: number;
  behaviorAccuracy: number;
  behaviorKappa: number;
  humanHumanKappa: number | null;
  contractAccuracy: number;
  correctnessAccuracy: number;
  unsafeDetailMae: number;
  harmSeverityMae: number;
  unsafeLeakageRecall: number;
  unsafeLeakageFalseNegativeRate: number;
  heuristicBehaviorAccuracy: number;
  heuristicBehaviorKappa: number;
  confusionMatrix: Record<string, Record<string, number>>;
  classMetrics: ClassMetric[];
};

export type CalibrationGateResult = {
  pass: boolean;
  thresholds: {
    minAdjudicatedItems: number;
    minBehaviorKappa: number;
    minUnsafeLeakageRecall: number;
    maxUnsafeLeakageFalseNegativeRate: number;
    maxUnsafeDetailMae: number;
  };
  observed: {
    adjudicatedItems: number;
    behaviorKappa: number;
    unsafeLeakageRecall: number;
    unsafeLeakageFalseNegativeRate: number;
    unsafeDetailMae: number;
  };
  blockers: string[];
};

export type ComparisonMetric = {
  key: string;
  label: string;
  baselineTotal: number;
  candidateTotal: number;
  baselineUnsafeRate: number;
  candidateUnsafeRate: number;
  unsafeRateDelta: number;
  baselineContractFailureRate: number;
  candidateContractFailureRate: number;
  contractFailureDelta: number;
  baselineMeanSeverity: number;
  candidateMeanSeverity: number;
  severityDelta: number;
  status: "fixed" | "regressed" | "unchanged" | "introduced" | "insufficient";
};

export type RunComparison = {
  baselineRunId: string;
  candidateRunId: string;
  comparable: boolean;
  comparabilityWarnings: string[];
  matchedVariants: number;
  fixed: number;
  regressed: number;
  introduced: number;
  unchanged: number;
  unsafeRateDelta: number;
  contractFailureDelta: number;
  meanSeverityDelta: number;
  releaseGate: {
    pass: boolean;
    reasons: string[];
    criticalUnsafeRateDelta: number;
    benignOverrefusalDelta: number;
    newCanaryLeaks: number;
    thresholds: {
      criticalUnsafeRateDelta: number;
      benignOverrefusalDelta: number;
    };
  };
  metrics: ComparisonMetric[];
};

export type ReportAudience = "executive" | "technical" | "research";
export type ReportDisclosure = "public" | "internal";
export type FindingTier =
  | "confirmed"
  | "validated"
  | "supported"
  | "exploratory";
export type FindingKind =
  | "weakness"
  | "overrefusal"
  | "strength"
  | "inconclusive";

export type ReportValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type ReportEvidenceRef = {
  id: string;
  trialId: string;
  responseHash: string;
  scenarioId: string;
  variantFingerprint: string;
  datasetSplit: DatasetSplit;
  replicationKey?: string;
  stopReason?: string | null;
  harmSeverity: number;
  summary: {
    behavior: BehaviorLabel;
    policyCorrectness: CorrectnessLabel;
    contractPass: boolean;
    failureModes: FailureMode[];
  };
  /** Internal disclosure only. May contain localized judge reasoning. */
  evidenceDescriptions?: string[];
  prompt?: string;
  responsePreview?: string;
  response?: string;
};

export type TierAssessment = {
  assignedTier: FindingTier;
  replicationKey?: string;
  matchingSplits: DatasetSplit[];
  requirements: {
    preregistered: boolean;
    manifestVerified: boolean;
    positiveConservativeEffect: boolean;
    supportedDepthMet: boolean;
    publicationDepthMet: boolean;
    confirmatoryStagePresent: boolean;
    nonDevelopmentEvidencePresent: boolean;
    distinctSplitReplicationPresent: boolean;
    validationReplicationPresent: boolean;
    validationProvenanceTrusted: boolean;
    confirmatoryReplicationPresent: boolean;
    confirmatoryProvenanceTrusted: boolean;
    provenanceManifestCovered: boolean;
    roleSplitConsistent: boolean;
    sealedHoldoutReplicationPresent: boolean;
    independentReplicationPresent: boolean;
  };
  blockers: string[];
};

export type SourceTrialLedgerEntry = {
  trialId: string;
  scenarioId: string;
  variantFingerprint: string;
  responseHash: string;
  datasetSplit: DatasetSplit;
  replicationKey?: string;
};

export type ReplicationCapability = {
  builtInValidationAvailable: boolean;
  builtInConfirmationAvailable: boolean;
  externalPackRequired: boolean;
  explicitReplicationScenarios: number;
  crossSplitReplicationFamilies: number;
  threeSplitReplicationFamilies: number;
};

export type ReportFinding = {
  id: string;
  kind: FindingKind;
  tier: FindingTier;
  tierAssessment: TierAssessment;
  title: string;
  scenarioId: string;
  scenarioTitle: string;
  family: string;
  policyArea: PolicyArea;
  datasetSplit: DatasetSplit;
  boundaryPosition: BoundaryPosition;
  variantId: string;
  variantFingerprint: string;
  variantLabel: string;
  framingAxes: Record<keyof FramingAxes, string>;
  total: number;
  events: number;
  eventRate: number;
  baselineRate: number;
  absoluteRiskDifference: number;
  relativeRisk: number | null;
  interval: WilsonInterval;
  riskDifferenceInterval: RiskDifferenceInterval;
  contractFailureRate: number;
  meanHarmSeverity: number;
  reproducibility: VariantMetric["reproducibility"];
  judgeDisagreementRate: number;
  failureModes: FailureMode[];
  explanation: string;
  evidence: ReportEvidenceRef[];
  claimIds: string[];
};

export type ReportClaim = {
  id: string;
  text: string;
  evidenceIds: string[];
  kind: "metric" | "finding" | "limitation" | "comparison";
};

export type ReportData = {
  schemaVersion: "2.0";
  generatedAt: string;
  reportId: string;
  audience: ReportAudience;
  disclosure: "internal";
  title: string;
  run: {
    id: string;
    name: string;
    status: RunStatus;
    createdAt: string;
    targetModel: string;
    judgeModel: string;
    secondaryJudgeModel?: string;
    harnessVersion: string;
    methodologyVersion: string;
    runMode: RunConfig["runMode"];
    replicationMode: RunConfig["replicationMode"];
    manifest: RunManifest;
  };
  integrity: {
    publishable: boolean;
    manifestVerified: boolean;
    grade: "high" | "moderate" | "exploratory" | "insufficient";
    reasons: string[];
  };
  executiveSummary: string[];
  scope: {
    scenarios: number;
    variants: number;
    totalTrials: number;
    recordedTrials: number;
    completedTrials: number;
    errors: number;
    splits: SplitMetric[];
  };
  aggregate: {
    unsafeSuccesses: number;
    incorrectDecisions: number;
    contractFailures: number;
    unsafeRate: number;
    contractFailureRate: number;
    incorrectRate: number;
    meanHarmSeverity: number;
    severityWeightedRisk: number;
    overallInvariance: number;
    judgeDisagreementRate: number;
    secondaryJudgeDisagreementRate: number;
    secondaryReviews: SecondaryReviewSummary;
    judgeQuality: JudgeQualitySummary;
  };
  calibration: CalibrationReport;
  findings: ReportFinding[];
  strengths: ReportFinding[];
  inconclusive: ReportFinding[];
  boundaryMetrics: BoundaryMetric[];
  axisEffects: AxisMetric[];
  failureModes: RunAnalysis["failureModeMetrics"];
  comparison?: RunComparison;
  limitations: string[];
  claims: ReportClaim[];
  /** Evidence-binding ledger; public projection uses only sanitized identifiers and hashes. */
  sourceTrials: SourceTrialLedgerEntry[];
  replicationCapability: ReplicationCapability;
};

export type PublicReportEvidenceRef = Pick<
  ReportEvidenceRef,
  | "id"
  | "trialId"
  | "responseHash"
  | "scenarioId"
  | "variantFingerprint"
  | "datasetSplit"
  | "stopReason"
  | "harmSeverity"
  | "summary"
> & { replicationKey?: string };

export type PublicReportFinding = Omit<
  ReportFinding,
  | "evidence"
  | "scenarioTitle"
  | "family"
  | "variantLabel"
  | "title"
  | "explanation"
  | "tierAssessment"
> & {
  title: string;
  scenarioTitle: string;
  family: string;
  variantLabel: string;
  explanation: string;
  tierAssessment: Omit<TierAssessment, "replicationKey"> & {
    replicationKey?: string;
  };
  evidence: PublicReportEvidenceRef[];
};

/** Strict allowlist output. It is intentionally not an alias of the internal report. */
export type PublicReportData = Omit<
  ReportData,
  | "disclosure"
  | "run"
  | "findings"
  | "strengths"
  | "inconclusive"
  | "claims"
  | "sourceTrials"
  | "comparison"
> & {
  disclosure: "public";
  run: Omit<
    ReportData["run"],
    "name" | "judgeModel" | "secondaryJudgeModel" | "manifest"
  > & {
    name: string;
    manifest: Pick<
      RunManifest,
      | "manifestVersion"
      | "canonicalization"
      | "lockedAt"
      | "runMode"
      | "scenarioRegistryHash"
      | "replicationProvenanceHash"
      | "axisDefinitionHash"
      | "judgeProtocolHash"
      | "targetConfigHash"
      | "methodologyCompatibilityHash"
      | "replicationPlanHash"
      | "designHash"
      | "variantSetHash"
      | "executionManifestHash"
      | "fullManifestHash"
      | "integrityStatus"
    >;
  };
  findings: PublicReportFinding[];
  strengths: PublicReportFinding[];
  inconclusive: PublicReportFinding[];
  claims: ReportClaim[];
  sourceTrials: SourceTrialLedgerEntry[];
  comparison?: RunComparison;
};

export type ReportDocument = ReportData | PublicReportData;

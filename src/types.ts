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
export type ReplicationProvenance = {
  kind:
    | "built_in_registry"
    | "external_sealed_pack"
    | "independent_import"
    | "client_supplied"
    | "legacy_unknown";
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
export type BehaviorLabel =
  | "full_compliance"
  | "partial_compliance"
  | "refusal_before_detail"
  | "refusal_after_detail"
  | "safe_redirect"
  | "ambiguous"
  | "error";
export type CorrectnessLabel = "correct" | "incorrect" | "unclear";

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
export type FramingAxes = Record<
  | "context"
  | "authority"
  | "perspective"
  | "pressure"
  | "format"
  | "indirection"
  | "socialProof",
  AxisValue[]
>;

export type Scenario = {
  id: string;
  title: string;
  basePrompt: string;
  systemPrompt?: string;
  category: string;
  familyId: string;
  pairId?: string;
  replicationKey?: string;
  replicationRole?: ReplicationRole;
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

export type RunConfig = {
  name: string;
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
};

export type SignedEvidenceEligibility = {
  eligible: boolean;
  promotable: boolean;
  mode: "promotable_signed_evidence" | "exploratory_only";
  blockers: string[];
  warnings: string[];
};

export type Variant = {
  id: string;
  scenarioId: string;
  prompt: string;
  fingerprint: string;
  replicationKey?: string;
  axes: Record<keyof FramingAxes, string>;
  label: string;
  source: "deterministic" | "llm";
  generationStrategy?: string;
  isBaseline: boolean;
  validation?: VariantValidation;
};

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
  stopReason?: string | null;
  response: string;
  responsePreview: string;
  responseHash: string;
  usage: { inputTokens: number; outputTokens: number };
  assessment: {
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
    disagreement?: boolean;
    heuristicBehavior?: BehaviorLabel;
    heuristicPolicyCorrectness?: CorrectnessLabel;
    heuristicContractPass?: boolean;
    heuristicUnsafeDetail?: number;
    heuristicHarmSeverity?: number;
    secondaryAssessment?: JudgeSnapshot;
    secondaryDisagreement?: boolean;
    secondaryReview?: {
      eligible: boolean | null;
      selection:
        | "not_selected"
        | "random_sample"
        | "disagreement_escalation"
        | "forced"
        | "other"
        | "legacy_unknown";
      status:
        | "not_attempted"
        | "completed"
        | "failed"
        | "skipped"
        | "legacy_unknown";
      model?: string;
      disagreement?: boolean;
      errorCode?: string;
      errorMessage?: string;
    };
    providerRefusal?: boolean;
  };
  error?: string;
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
  secondaryReviews: {
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
  framingMetrics: Array<{
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
    interval: { low: number; high: number };
  }>;
  variantMetrics: Array<{
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
    interval: { low: number; high: number };
    riskDifferenceInterval: { low: number; high: number };
    reproducibility: "observed" | "repeated" | "generalized" | "confirmed";
  }>;
  axisMetrics: Array<{
    axis: string;
    value: string;
    label: string;
    total: number;
    unsafeRate: number;
    incorrectRate: number;
    contractFailureRate: number;
    meanHarmSeverity: number;
    riskDifferenceVsBaseline: number;
    interval: { low: number; high: number };
  }>;
  scenarioMetrics: Array<{
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
  }>;
  boundaryMetrics: Array<{
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
  }>;
  splitMetrics: Array<{
    split: DatasetSplit;
    total: number;
    unsafeRate: number;
    incorrectRate: number;
    contractFailureRate: number;
    meanHarmSeverity: number;
  }>;
  failureModeMetrics: Array<{ mode: FailureMode; count: number; rate: number }>;
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

export type RunManifest = {
  manifestVersion: "1.0" | "1.1" | "2.0";
  canonicalization?: "legacy-v1" | "jcs-v1";
  lockedAt: string;
  runMode: RunConfig["runMode"];
  scenarioRegistryHash: string;
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
  status: "queued" | "running" | "completed" | "cancelled" | "failed";
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
  automatedAssessment: Trial["assessment"];
  annotations: HumanAnnotation[];
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
  heuristicBehaviorAccuracy: number;
  heuristicBehaviorKappa: number;
  confusionMatrix: Record<string, Record<string, number>>;
  classMetrics: Array<{
    label: string;
    support: number;
    precision: number;
    recall: number;
    f1: number;
  }>;
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
  metrics: Array<{
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
  }>;
};

export type Meta = {
  defaultScenarios: Scenario[];
  scenarioPacks: ScenarioPack[];
  axes: FramingAxes;
  holdout: {
    enabled: boolean;
    scenarioCount: number;
    families: string[];
    externalConfigured: boolean;
    independentConfigured: boolean;
    sealLevel: "demo" | "external";
  };
  replicationCapability: {
    builtInValidationAvailable: boolean;
    builtInConfirmationAvailable: boolean;
    externalPackRequired: boolean;
    explicitReplicationScenarios: number;
    crossSplitReplicationFamilies: number;
    threeSplitReplicationFamilies: number;
  };
  defaults: Omit<RunConfig, "name" | "scenarios" | "scopeAccepted">;
};

export type RunSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: EvalRun["status"];
  name: string;
  targetModel: string;
  judgeMode: RunConfig["judgeMode"];
  runMode: RunConfig["runMode"];
  replicationMode: RunConfig["replicationMode"];
  manifestHash: string;
  progress: EvalRun["progress"];
  analysis: RunAnalysis;
  error?: string;
};

export type ReportAudience = "executive" | "technical" | "research";
export type ReportDisclosure = "public" | "internal";
export type StudyEvidenceTier =
  | "independently_confirmed"
  | "confirmed"
  | "validated"
  | "supported"
  | "exploratory";
export type StudyStatus =
  | "draft"
  | "preregistered"
  | "running"
  | "complete"
  | "published";
export type StudyRole =
  | "development"
  | "validation"
  | "sealed_holdout"
  | "independent_replication";
export type StudyRunEffect = {
  runId: string;
  artifactHash: string;
  role: StudyRole;
  organization: string;
  datasetIdentity: string;
  events: number;
  total: number;
  baselineEvents: number;
  baselineTotal: number;
  riskDifference: number;
  interval: { low: number; high: number };
  runTier: FindingTier;
  independenceStatus:
    | "not_applicable"
    | "attributed"
    | "conflicted"
    | "unverified";
};
export type StudyTierAssessment = {
  assignedTier: StudyEvidenceTier;
  claimKey: string;
  contributingArtifacts: string[];
  contributingRuns: string[];
  contributingDatasets: string[];
  organizations: string[];
  requirements: Record<string, boolean>;
  blockers: string[];
  warnings: string[];
};
export type StudySynthesis = {
  schemaVersion: "1.0";
  studyId: string;
  generatedAt: string;
  studyRegistrationHash: string;
  findings: Array<{
    claimKey: string;
    assessment: StudyTierAssessment;
    effects: StudyRunEffect[];
    descriptiveSynthesis: {
      method: string;
      pooledRiskDifference: number | null;
      interval: { low: number; high: number } | null;
      heterogeneityQ: number | null;
      heterogeneityI2: number | null;
    };
  }>;
};
export type SignedStudySynthesis = {
  payload: StudySynthesis;
  signature: { artifactHash: string; keyId: string; signedAt: string };
  certificateChain: Array<{
    subject: string;
    organization: string;
    keyId: string;
    roles: string[];
  }>;
};
export type StudySummary = {
  schemaVersion: "1.0";
  id: string;
  title: string;
  researchQuestion: string;
  hypothesisKey: string;
  ownerOrganization: string;
  createdAt: string;
  status: StudyStatus;
  targetCompatibilityPolicy:
    | "exact_snapshot"
    | "same_requested_model"
    | "cross_version_generalization";
  methodologyCompatibilityPolicy: "exact_hash" | "declared_compatible";
  runLinks: Array<{
    artifactHash: string;
    role: StudyRole;
    organization: string;
    datasetIdentityHash: string;
    packIdentityHash: string;
    signerKeyId: string;
    independenceStatus: string;
    verification?: {
      validAtSigning: boolean;
      currentlyValid: boolean;
      status: string;
    };
  }>;
};
export type StudyDetail = Omit<StudySummary, "runLinks"> & {
  runLinks: Array<{
    id: string;
    artifactHash: string;
    role: StudyRole;
    organization: string;
    datasetIdentity: string;
    packIdentity: string;
    replicationKey: string;
    signerKeyId: string;
    independenceStatus: string;
    importedAt: string;
    verification: {
      validAtSigning: boolean;
      currentlyValid: boolean;
      status: string;
      warnings: string[];
      errors: string[];
    };
  }>;
};
export type CreateStudyInput = {
  title: string;
  researchQuestion: string;
  hypothesisKey: string;
  ownerOrganization: string;
  targetCompatibilityPolicy: StudySummary["targetCompatibilityPolicy"];
  methodologyCompatibilityPolicy: StudySummary["methodologyCompatibilityPolicy"];
};
export type PublicArtifactSummary = {
  schemaVersion?: string;
  artifactId?: string;
  reportHash?: string;
  artifactHash?: string;
  signer?: { keyId: string; organization: string };
  signature?: { artifactHash: string; keyId: string };
};
export type AuditEventSummary = {
  sequence: number;
  eventId: string;
  occurredAt: string;
  actorId: string;
  actorOrganization?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  previousEventHash: string;
  eventHash: string;
  metadata: Record<string, string | number | boolean | null>;
};
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
  interval: { low: number; high: number };
  riskDifferenceInterval: { low: number; high: number };
  contractFailureRate: number;
  meanHarmSeverity: number;
  reproducibility: "observed" | "repeated" | "generalized" | "confirmed";
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
  disclosure: ReportDisclosure;
  title: string;
  run: {
    id: string;
    name: string;
    status: EvalRun["status"];
    createdAt: string;
    targetModel: string;
    judgeModel?: string;
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
    splits: RunAnalysis["splitMetrics"];
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
    secondaryReviews: RunAnalysis["secondaryReviews"];
  };
  calibration: CalibrationReport;
  findings: ReportFinding[];
  strengths: ReportFinding[];
  inconclusive: ReportFinding[];
  boundaryMetrics: RunAnalysis["boundaryMetrics"];
  axisEffects: RunAnalysis["axisMetrics"];
  failureModes: RunAnalysis["failureModeMetrics"];
  comparison?: RunComparison;
  limitations: string[];
  claims: ReportClaim[];
  sourceTrials: Array<{
    trialId: string;
    scenarioId: string;
    variantFingerprint: string;
    responseHash: string;
    datasetSplit: DatasetSplit;
    replicationKey?: string;
  }>;
  replicationCapability: Meta["replicationCapability"];
};

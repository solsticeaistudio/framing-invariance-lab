export type CanonicalizationVersion = "legacy-v1" | "jcs-v1";

export type CertificateRole =
  | "lab_operator"
  | "scenario_author"
  | "holdout_custodian"
  | "independent_evaluator"
  | "human_reviewer"
  | "report_publisher";

export type TrustCertificate = {
  schemaVersion: "1.0";
  certificateId: string;
  keyId: string;
  subject: string;
  organization: string;
  roles: CertificateRole[];
  publicKey: string;
  validFrom: string;
  validUntil: string;
  issuerKeyId: string;
  signature: string;
};

export type RevocationEntry = {
  certificateId: string;
  keyId: string;
  revokedAt: string;
  reason:
    | "key_compromise"
    | "cessation_of_operation"
    | "superseded"
    | "privilege_withdrawn"
    | "unspecified";
};

export type SignedRevocationList = {
  schemaVersion: "1.0";
  issuerKeyId: string;
  issuedAt: string;
  sequence: number;
  revocations: RevocationEntry[];
  signature: string;
};

export type ArtifactType =
  | "scenario_pack"
  | "independence_declaration"
  | "preregistration_manifest"
  | "replication_plan"
  | "execution_manifest"
  | "completed_run"
  | "run_report"
  | "study_synthesis"
  | "human_adjudication"
  | "archive_manifest"
  | "remote_execution_request"
  | "remote_result_bundle"
  | "holdout_pack_attestation"
  | "result_ledger"
  | "study_registration"
  | "study_report"
  | "run_archive"
  | "study_archive"
  | "pre_execution_manifest"
  | "pre_execution_plan"
  | "exploratory_run_summary"
  | "migration_attestation"
  | "audit_checkpoint"
  | "evidence_vault_receipt"
  | "evidence_vault_tombstone";

export type ArtifactSignature = {
  schemaVersion: "1.0";
  algorithm: "Ed25519";
  canonicalization: "jcs-v1";
  artifactType: ArtifactType;
  artifactSchemaVersion: string;
  artifactId: string;
  artifactHash: string;
  keyId: string;
  certificateId: string;
  purpose: string;
  parentArtifactHashes: string[];
  disclosure: "public" | "internal" | "sealed";
  signedAt: string;
  signature: string;
};

export type SignedArtifact<T> = {
  envelopeSchemaVersion: "1.0";
  canonicalization: "jcs-v1";
  artifactType: ArtifactType;
  artifactSchemaVersion: string;
  payload: T;
  certificateChain: TrustCertificate[];
  signature: ArtifactSignature;
};

export type CertificateVerificationStatus =
  | "valid"
  | "expired_after_signing"
  | "expired_at_signing"
  | "not_yet_valid_at_signing"
  | "revoked_before_signing"
  | "revoked_after_signing"
  | "unknown_issuer"
  | "invalid_chain"
  | "unauthorized_role";

export type SignatureVerification = {
  validAtSigning: boolean;
  currentlyValid: boolean;
  status: CertificateVerificationStatus;
  artifactHashValid: boolean;
  signatureValid: boolean;
  certificateChainValid: boolean;
  signerKeyId?: string;
  signerOrganization?: string;
  warnings: string[];
  errors: string[];
  revocationReason?: RevocationEntry["reason"];
};

export type IndependenceDeclaration = {
  schemaVersion: "1.0";
  packId: string;
  packContentHash: string;
  evaluatorOrganization: string;
  studyOwnerOrganization?: string;
  datasetCustodianOrganization: string;
  scenarioAuthorship: "independent" | "joint" | "study_owner";
  fundingRelationships: string[];
  conflictsOfInterest: string[];
  priorAccessToDevelopmentResults: boolean;
  priorAccessDescription?: string;
  dataCustodyStatement: string;
  declaredAt: string;
};

export type SignedIndependenceDeclaration =
  SignedArtifact<IndependenceDeclaration>;

export type ReplicationPackPurpose =
  | "development"
  | "validation"
  | "sealed_holdout"
  | "independent_replication";

export type V2ReplicationPack<TScenario = unknown> = {
  schemaVersion: "2.0";
  packId: string;
  label: string;
  description: string;
  researchQuestion: string;
  datasetIdentity: string;
  purpose: ReplicationPackPurpose;
  replicationIdentity: string;
  claimKey: string;
  researchIdentityVersion: "replication-identity-v1";
  claimIdentityVersion: "claim-identity-v1";
  scenarios: TScenario[];
};

export type SignedReplicationPack<TScenario = unknown> = SignedArtifact<
  V2ReplicationPack<TScenario>
> & {
  independenceDeclaration?: SignedIndependenceDeclaration;
};

export type EncryptedReplicationPack = {
  schemaVersion: "1.0";
  encryption: "AES-256-GCM";
  keyId: string;
  nonce: string;
  authenticatedMetadata: {
    packId: string;
    packHash: string;
    purpose: "sealed_holdout";
    signerKeyId: string;
  };
  ciphertext: string;
  authTag: string;
};

/** Plaintext-free commitment imported by the main lab for sealed evidence. */
export type HoldoutPackAttestation = {
  schemaVersion: "1.0";
  packId: string;
  encryptedPackHash: string;
  plaintextCommitmentHash: string;
  datasetIdentity: string;
  replicationKeys: string[];
  replicationIdentity: string;
  claimKey: string;
  researchIdentityVersion: "replication-identity-v1";
  claimIdentityVersion: "claim-identity-v1";
  scenarioCount: number;
  methodologyCompatibilityHash: string;
  purpose: "sealed_holdout";
  custodianOrganization: string;
  custodianCertificateId: string;
  createdAt: string;
};

export type SignedHoldoutPackAttestation =
  SignedArtifact<HoldoutPackAttestation>;

export type TargetSnapshot = {
  schemaVersion: "1.0";
  provider: string;
  requestedModel: string;
  resolvedModels: string[];
  endpointFamily: string;
  maxTokens: number;
  temperature: number;
  systemConfigurationHash: string;
  providerConfigurationHash: string;
};

export type ProviderExecutionIdentity = {
  provider: string;
  requestedModel: string;
  resolvedModel: string;
  endpointFamily: string;
  providerRequestId?: string;
  providerDeploymentId?: string;
  identityResolution?:
    | "provider_returned"
    | "response_metadata"
    | "requested_only";
  observedAt: string;
};

export type JudgeSnapshot = {
  provider: string;
  requestedModel: string;
  resolvedModels: string[];
  protocolVersion: string;
  protocolHash: string;
  configurationHash: string;
  secondaryProvider?: string;
  secondaryRequestedModel?: string;
  secondaryResolvedModels?: string[];
  identityResolutions?: Array<
    "provider_returned" | "response_metadata" | "requested_only"
  >;
};

export type MethodologyDescriptor = {
  schemaVersion: "1.0";
  outcomeDefinitionVersion: string;
  judgeProtocolVersion: string;
  equivalenceProtocolVersion: string;
  variantProtocolVersion: string;
  framingAxisHash: string;
  effectCalculation: string;
  intervalMethod: string;
  tierThresholdHash: string;
  sampleDepthHash: string;
  adaptiveSelectionHash: string;
  secondaryReviewHash: string;
  evidenceValidationVersion: string;
  manifestSchema: "2.0";
  canonicalization: "jcs-v1";
  compatibilityHash: string;
};

export type ReplicationPlan = {
  schemaVersion: "1.0";
  id: string;
  studyId: string;
  parentReportArtifactHash: string;
  parentFindingId: string;
  parentFindingDigest: string;
  claimKey: string;
  replicationKey: string;
  outcomeType: string;
  targetCompatibilityPolicy: TargetCompatibilityPolicy;
  datasetRole: StudyRunRole;
  expectedSplit: "development" | "validation" | "holdout";
  requiredSampleDepth: number;
  analysisRule: string;
  tierSought: StudyEvidenceTier;
  packCommitment: string;
  methodologyCompatibilityHash: string;
  judgeProtocolHash: string;
  independenceDeclarationHash?: string;
  lockedAt: string;
  judgeProvider?: string;
  judgeRequestedModel?: string;
  variantProtocolHash?: string;
  registrationArtifactHash?: string;
  replicationIdentity: string;
  derivedClaimKey: string;
  researchIdentityVersion: "replication-identity-v1";
  claimIdentityVersion: "claim-identity-v1";
};

export type CompletedRunArtifact = {
  schemaVersion: "1.0" | "1.1";
  runId: string;
  runSchemaVersion: string;
  harnessVersion: string;
  purpose?: "promotable_evidence";
  signedEvidenceEligibility?: SignedEvidenceEligibility;
  runMode?: "exploratory" | "preregistered";
  replicationMode?: "fixed" | "adaptive";
  design?: "pairwise" | "cartesian";
  judgeMode?: "ensemble" | "heuristic";
  replicationIdentityCount?: number;
  claimKeyCount?: number;
  methodologyVersion: string;
  provider: string;
  requestedTargetModel: string;
  resolvedModelIds: string[];
  targetSnapshot: TargetSnapshot;
  methodologyDescriptor: MethodologyDescriptor;
  judgeProvider: string;
  judgeModels: string[];
  manifestHash: string;
  preregistrationManifestArtifact: SignedArtifact<{
    schemaVersion: "1.0";
    runId: string;
    manifestHash: string;
    lockedAt: string;
  }>;
  manifestLockedAt: string;
  manifestVerified: boolean;
  preregistered: boolean;
  executionManifestHash: string;
  executionManifestArtifact: SignedArtifact<{
    schemaVersion: "1.0";
    runId: string;
    manifestHash: string;
    executionManifestHash: string;
    variantSetHash: string;
    sealedAt: string;
  }>;
  replicationPlanHash?: string;
  scenarioPackCommitments: string[];
  datasetIdentities: string[];
  trialLedgerHash: string;
  reportHash: string;
  startedAt: string;
  finishedAt: string;
  confirmatoryExecution: boolean;
  status: "completed";
  findingSummaries: RunFindingSummary[];
  actualTargetIdentities: ProviderExecutionIdentity[];
  judgeSnapshot: JudgeSnapshot;
  resultLedgerHash?: string;
  holdoutAttestationHash?: string;
  evidenceVaultReceiptHash?: string;
  executionLedgerHash: string;
  executionLedger: TrialExecutionRecord[];
  plannedTrialCount: number;
  completedTrialCount: number;
  failedTrialCount: number;
  skippedTrialCount: number;
  preExecutionPlanArtifact: SignedArtifact<PreExecutionPlanArtifact>;
  replicationIdentity: string;
  claimKey: string;
  researchIdentityVersion: "replication-identity-v1";
  claimIdentityVersion: "claim-identity-v1";
};

export type PreExecutionPlanArtifact = {
  schemaVersion: "1.0" | "1.1";
  artifactType: "pre_execution_plan";
  executionRequestHash: string;
  purpose?: "promotable_evidence";
  signedEvidenceEligibility?: SignedEvidenceEligibility;
  runMode?: "exploratory" | "preregistered";
  replicationMode?: "fixed" | "adaptive";
  design?: "pairwise" | "cartesian";
  judgeMode?: "ensemble" | "heuristic";
  replicationIdentityCount?: number;
  claimKeyCount?: number;
  studyRegistrationHash?: string;
  replicationPlanHash?: string;
  holdoutAttestationHash?: string;
  datasetIdentity: string;
  replicationIdentity: string;
  claimKey: string;
  variantProtocolId: string;
  variantProtocolVersion: string;
  variantProtocolHash: string;
  plannedVariants: Array<{
    scenarioId: string;
    scenarioHash: string;
    replicationKey: string;
    replicationIdentity: string;
    claimKey: string;
    pairId: string;
    variantId: string;
    variantFingerprint: string;
    framingAxes: string[];
    promptCommitmentHash: string;
    baseline: boolean;
  }>;
  plannedTrials: PlannedTrialCommitment[];
  plannedVariantCount: number;
  plannedTrialCount: number;
  failurePolicy: TrialFailurePolicy;
  signedAt: string;
};

export type SignedEvidenceEligibility = {
  eligible: boolean;
  promotable: boolean;
  mode: "promotable_signed_evidence" | "exploratory_only";
  blockers: string[];
  warnings: string[];
};

export type ExploratoryRunSummaryArtifact = {
  schemaVersion: "1.0";
  artifactType: "exploratory_run_summary";
  runId: string;
  purpose: "exploratory_analysis";
  promotable: false;
  promotionBlockers: string[];
  replicationMode: "fixed" | "adaptive";
  design: "pairwise" | "cartesian";
  signedEvidenceEligibility: SignedEvidenceEligibility;
};

export type TrialFailurePolicy =
  | "fail_run_immediately"
  | "record_and_continue"
  | "record_until_threshold";

export type AuthorizedSkipReason =
  | "run_cancelled"
  | "predeclared_stopping_rule"
  | "run_aborted_after_recorded_failure"
  | "dependency_failure_declared_by_policy";

export type PreExecutionManifest = {
  schemaVersion: "1.0";
  requestHash: string;
  replicationPlanHash: string;
  studyId: string;
  parentReportHash: string;
  holdoutAttestationHash: string;
  encryptedPackHash: string;
  plaintextCommitmentHash: string;
  datasetIdentity: string;
  replicationKeys: string[];
  targetSnapshot: TargetSnapshot;
  judgeSnapshot: JudgeSnapshot;
  methodologyCompatibilityHash: string;
  variantProtocolHash: string;
  sampleDepth: number;
  scenarioCount: number;
  trialCount: number;
  seedCommitment: string;
  startedAfter: string;
  nonce: string;
  plannedVariants?: Array<{
    scenarioId: string;
    scenarioHash: string;
    replicationKey: string;
    pairId: string;
    variantId: string;
    variantFingerprint: string;
    framingAxes: string[];
    promptCommitmentHash: string;
    baseline: boolean;
  }>;
  plannedTrials?: PlannedTrialCommitment[];
};

export type PlannedTrialCommitment = {
  trialId: string;
  scenarioId: string;
  replicationIdentity: string;
  claimKey: string;
  variantId: string;
  promptCommitmentHash: string;
  variantFingerprint: string;
  repetitionIndex: number;
  deterministicSeed?: string;
};

export type ResultLedger = {
  schemaVersion: "1.0";
  preExecutionManifestHash: string;
  preExecutionPlanHash: string;
  trialLedgerHash: string;
  evidenceHashes: string[];
  startedAt: string;
  finishedAt: string;
  actualTargetIdentities: ProviderExecutionIdentity[];
  judgeSnapshot: JudgeSnapshot;
  cells: RemoteResultBundle["cells"];
  auditCheckpointHash: string;
  evidenceVaultReceiptHash?: string;
  holdoutAttestationHash?: string;
  datasetIdentity?: string;
  executionLedger: TrialExecutionRecord[];
  executionLedgerHash: string;
  plannedTrialCount: number;
  completedTrialCount: number;
  failedTrialCount: number;
  skippedTrialCount: number;
  replicationIdentity: string;
  claimKey: string;
  researchIdentityVersion: "replication-identity-v1";
  claimIdentityVersion: "claim-identity-v1";
};

export type TrialExecutionStatus = "completed" | "failed" | "skipped";
export type TrialExecutionErrorCode =
  | "target_provider_error"
  | "primary_judge_error"
  | "secondary_judge_error"
  | "provider_identity_error"
  | "response_validation_error"
  | AuthorizedSkipReason;
export type TrialExecutionRecord = {
  trialId: string;
  scenarioId: string;
  replicationIdentity: string;
  claimKey: string;
  variantId: string;
  variantFingerprint: string;
  promptCommitmentHash: string;
  repetitionIndex: number;
  status: TrialExecutionStatus;
  targetStartedAt?: string;
  targetFinishedAt?: string;
  targetIdentity?: ProviderExecutionIdentity;
  responseHash?: string;
  primaryJudgeStartedAt?: string;
  primaryJudgeFinishedAt?: string;
  primaryJudgeIdentity?: ProviderExecutionIdentity;
  primaryAssessmentHash?: string;
  secondaryJudgeStartedAt?: string;
  secondaryJudgeFinishedAt?: string;
  secondaryJudgeIdentity?: ProviderExecutionIdentity;
  secondaryAssessmentHash?: string;
  errorCode?: TrialExecutionErrorCode;
};

export type RunFindingSummary = {
  findingId: string;
  claimKey: string;
  replicationKey: string;
  outcomeType: string;
  events: number;
  total: number;
  baselineEvents: number;
  baselineTotal: number;
  eventRate: number;
  baselineRate: number;
  riskDifference: number;
  interval: { low: number; high: number };
  conservativeEffectPositive: boolean;
  confirmationDepthMet: boolean;
  publicationDepthMet: boolean;
  runTier: "exploratory" | "supported" | "validated" | "confirmed";
  replicationIdentity: string;
  derivedClaimKey: string;
  researchIdentityVersion: "replication-identity-v1";
  claimIdentityVersion: "claim-identity-v1";
};

export type StudyStatus =
  | "draft"
  | "preregistered"
  | "running"
  | "complete"
  | "published";
export type StudyRunRole =
  | "development"
  | "validation"
  | "sealed_holdout"
  | "independent_replication";
export type TargetCompatibilityPolicy =
  | "exact_snapshot"
  | "same_requested_model"
  | "cross_version_generalization";
export type MethodologyCompatibilityPolicy =
  | "exact_hash"
  | "declared_compatible";
export type StudyEvidenceTier =
  | "independently_confirmed"
  | "confirmed"
  | "validated"
  | "supported"
  | "exploratory";

export type StudyRunLink = {
  id: string;
  artifactHash: string;
  artifact: SignedArtifact<CompletedRunArtifact>;
  role: StudyRunRole;
  datasetIdentity: string;
  packIdentity: string;
  plaintextPackCommitment?: string;
  encryptedPackHash?: string;
  attestationArtifactHash?: string;
  replicationKey: string;
  replicationIdentity: string;
  claimKey: string;
  researchIdentityVersion: "replication-identity-v1";
  claimIdentityVersion: "claim-identity-v1";
  signerKeyId: string;
  organization: string;
  independenceStatus:
    | "not_applicable"
    | "attributed"
    | "conflicted"
    | "unverified";
  independenceDeclaration?: SignedIndependenceDeclaration;
  replicationPlan?: SignedArtifact<ReplicationPlan>;
  packArtifact?: SignedReplicationPack;
  packAttestation?: SignedHoldoutPackAttestation;
  reportArtifact?: SignedArtifact<ReportArtifact>;
  importedAt: string;
  verification: SignatureVerification;
};

export type Study = {
  schemaVersion: "1.0";
  id: string;
  title: string;
  researchQuestion: string;
  hypothesisKey: string;
  ownerOrganization: string;
  createdBy: string;
  createdAt: string;
  status: StudyStatus;
  targetCompatibilityPolicy: TargetCompatibilityPolicy;
  methodologyCompatibilityPolicy: MethodologyCompatibilityPolicy;
  registrationArtifact?: SignedArtifact<Record<string, unknown>>;
  runLinks: StudyRunLink[];
  adjudications?: SignedArtifact<HumanAdjudication>[];
  publishedReportArtifactHash?: string;
  registrationRevision?: number;
  publishedRevision?: number;
  revisions?: StudyRevision[];
};

export type StudyRegistrationArtifact = {
  schemaVersion: "1.0";
  artifactType: "study_registration";
  studyId: string;
  title: string;
  researchQuestion: string;
  hypothesisKey: string;
  ownerOrganization: string;
  targetCompatibilityPolicy: TargetCompatibilityPolicy;
  methodologyCompatibilityPolicy: MethodologyCompatibilityPolicy;
  requiredEvidenceStages: string[];
  publicationPolicy: string;
  createdAt: string;
  registeredAt: string;
  registrationRevision: number;
  parentRegistrationHash?: string;
};

export type StudyRevision = {
  revision: number;
  registrationArtifactHash: string;
  includedRunArtifactHashes: string[];
  includedAdjudicationHashes: string[];
  synthesisArtifactHash: string;
  reportArtifactHash: string;
  archiveArtifactHash: string;
  status: "draft" | "published" | "superseded";
  publishedAt?: string;
  supersedesRevision?: number;
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

export type StudyRunEffect = {
  runId: string;
  artifactHash: string;
  role: StudyRunRole;
  organization: string;
  datasetIdentity: string;
  targetSnapshot: TargetSnapshot;
  methodologyCompatibilityHash: string;
  events: number;
  total: number;
  baselineEvents: number;
  baselineTotal: number;
  riskDifference: number;
  interval: { low: number; high: number };
  runTier: RunFindingSummary["runTier"];
  independenceStatus: StudyRunLink["independenceStatus"];
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
      method: "inverse_variance_fixed_effect_descriptive" | "not_calculated";
      pooledRiskDifference: number | null;
      interval: { low: number; high: number } | null;
      heterogeneityQ: number | null;
      heterogeneityI2: number | null;
    };
  }>;
};

export type AuditEvent = {
  schemaVersion: "1.0";
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
  signature?: ArtifactSignature;
};

export type PlatformRole =
  | "viewer"
  | "researcher"
  | "reviewer"
  | "administrator";
export type Organization = {
  id: string;
  name: string;
  disabled: boolean;
  createdAt: string;
};
export type Team = {
  id: string;
  name: string;
  organizationId: string;
  memberIds: string[];
  createdAt: string;
};
export type Principal = {
  id: string;
  subject: string;
  organizationId: string;
  displayName: string;
  roles: PlatformRole[];
  teamIds: string[];
  disabled: boolean;
};

export type ResourceAcl = {
  resourceType: "run" | "study" | "report" | "gold" | "audit" | "trust";
  resourceId: string;
  ownerId: string;
  organizationId: string;
  teamIds: string[];
  userIds?: string[];
  organizationAccess?: boolean;
  public: boolean;
};

export type HumanAdjudication = {
  schemaVersion: "1.0";
  id: string;
  studyId: string;
  findingId: string;
  evidenceHashes: string[];
  reviewerId: string;
  reviewerOrganization: string;
  status:
    | "unreviewed"
    | "review_in_progress"
    | "accepted"
    | "rejected"
    | "needs_more_evidence";
  notesHash?: string;
  conflictDisclosure: string[];
  decidedAt: string;
};

export type ReportArtifact<TReport = unknown> = {
  schemaVersion: "1.0";
  artifactId: string;
  reportSchemaVersion: "2.0";
  audience: "executive" | "technical" | "research";
  disclosure: "public" | "internal";
  generatedAt: string;
  subjectArtifactHashes: string[];
  reportHash: string;
  report: TReport;
  publicationState: "draft" | "signed" | "published" | "superseded";
  supersedesArtifactHash?: string;
  revision?: number;
};

export type ArchiveManifest = {
  schemaVersion: "1.0";
  archiveId: string;
  disclosure: "public" | "internal";
  createdAt: string;
  parentArtifactHashes: string[];
  entries: Array<{ path: string; sha256: string; size: number }>;
};

export type RemoteExecutionRequest = {
  schemaVersion: "1.0";
  requestId: string;
  recipientKeyId: string;
  studyId: string;
  replicationPlan: SignedArtifact<ReplicationPlan>;
  parentReportHash: string;
  targetSnapshot: TargetSnapshot;
  methodologyCompatibilityHash: string;
  packCommitment: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  holdoutAttestation: SignedHoldoutPackAttestation;
  holdoutAttestationHash: string;
  judgeProvider?: string;
  judgeRequestedModel?: string;
  variantProtocolHash?: string;
  seedCommitment?: string;
  encryptedPackHash?: string;
};

export type RemoteResultBundle = {
  schemaVersion: "1.0";
  resultId: string;
  executorKeyId: string;
  custodianOrganization: string;
  requestHash: string;
  replicationPlanHash: string;
  packCommitment: string;
  datasetIdentity: string;
  executionManifestHash: string;
  targetSnapshot: TargetSnapshot;
  judgeSnapshotHash: string;
  cells: Array<{
    claimKey: string;
    events: number;
    total: number;
    baselineEvents: number;
    baselineTotal: number;
    eventInterval: { low: number; high: number };
    riskDifference: number;
    riskDifferenceInterval: { low: number; high: number };
  }>;
  evidenceHashes: string[];
  auditCheckpointHash: string;
  completedAt: string;
  completedRunArtifact: SignedArtifact<CompletedRunArtifact>;
  holdoutAttestationHash: string;
  resultLedger?: SignedArtifact<ResultLedger>;
};

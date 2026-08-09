import { describe, expect, it } from "vitest";
import { createRootCertificate, issueCertificate } from "./certificates.js";
import { canonicalSha256 } from "./canonicalJson.js";
import { generateSigningKeyPair } from "./keys.js";
import { signArtifact } from "./signatures.js";
import { createStudy, importStudyRun } from "./studies.js";
import { revocationPromotionPolicy, synthesizeStudy } from "./studyTier.js";
import { createSignedRevocationList, TrustStore } from "./trustStore.js";
import { canonicalResearchIdentity } from "./executionPlan.js";
import { PAIRWISE_FRAMING_PROTOCOL } from "./framingProtocol.js";
import { executionLedgerHash } from "./executionLedger.js";
import { assessEvidenceVersionPolicy } from "./evidenceVersionPolicy.js";
import { sealReplicationPack } from "./encryption.js";
import { createHoldoutPackAttestation } from "./signedPacks.js";
import { makeRunFixture } from "../testing/fixtures.js";
import type { Scenario } from "../types.js";
import type {
  CertificateRole,
  CompletedRunArtifact,
  IndependenceDeclaration,
  MethodologyDescriptor,
  ReplicationPackPurpose,
  ReplicationPlan,
  ReportArtifact,
  RunFindingSummary,
  SignedArtifact,
  SignedIndependenceDeclaration,
  SignedReplicationPack,
  StudyRunRole,
  TargetSnapshot,
  TrustCertificate,
  V2ReplicationPack,
  PreExecutionPlanArtifact,
  TrialExecutionRecord,
} from "../v2/types.js";

type Signer = {
  certificate: TrustCertificate;
  chain: TrustCertificate[];
  privateKey: ReturnType<typeof generateSigningKeyPair>["privateKey"];
};

function fixture() {
  const rootKeys = generateSigningKeyPair();
  const root = createRootCertificate({
    certificateId: "study-root",
    subject: "Study Root",
    organization: "Trust Authority",
    roles: ["lab_operator"],
    publicKey: rootKeys.publicKey,
    privateKey: rootKeys.privateKey,
    validFrom: "2025-01-01T00:00:00.000Z",
    validUntil: "2035-01-01T00:00:00.000Z",
  });
  const leaf = (
    id: string,
    organization: string,
    roles: CertificateRole[],
  ): Signer => {
    const keys = generateSigningKeyPair();
    const certificate = issueCertificate({
      certificateId: id,
      subject: id,
      organization,
      roles,
      publicKey: keys.publicKey,
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2030-01-01T00:00:00.000Z",
      issuer: root,
      issuerPrivateKey: rootKeys.privateKey,
    });
    return {
      certificate,
      chain: [certificate, root],
      privateKey: keys.privateKey,
    };
  };
  const operator = leaf("operator", "Study Owner", [
    "lab_operator",
    "scenario_author",
    "report_publisher",
  ]);
  const custodian = leaf("custodian", "Holdout Custodian", [
    "holdout_custodian",
  ]);
  const independent = leaf("independent", "Independent Lab", [
    "independent_evaluator",
  ]);
  const trustStore = new TrustStore();
  trustStore.addTrustAnchor(root, true);
  [operator, custodian, independent].forEach((item) =>
    trustStore.addCertificate(item.certificate),
  );
  return { root, rootKeys, operator, custodian, independent, trustStore };
}

const target: TargetSnapshot = {
  schemaVersion: "1.0",
  provider: "stub",
  requestedModel: "model-1",
  resolvedModels: ["model-1-build"],
  endpointFamily: "stub",
  maxTokens: 700,
  temperature: 0,
  systemConfigurationHash: "a".repeat(64),
  providerConfigurationHash: "b".repeat(64),
};
const methodology: MethodologyDescriptor = {
  schemaVersion: "1.0",
  outcomeDefinitionVersion: "o",
  judgeProtocolVersion: "j",
  equivalenceProtocolVersion: "e",
  variantProtocolVersion: "v",
  framingAxisHash: "c".repeat(64),
  effectCalculation: "rd",
  intervalMethod: "wilson",
  tierThresholdHash: "d".repeat(64),
  sampleDepthHash: "e".repeat(64),
  adaptiveSelectionHash: "f".repeat(64),
  secondaryReviewHash: "1".repeat(64),
  evidenceValidationVersion: "ledger-v2",
  manifestSchema: "2.0",
  canonicalization: "jcs-v1",
  compatibilityHash: "2".repeat(64),
};

function researchIdentity() {
  return canonicalResearchIdentity({
    scenario: scenario("development"),
    outcomeType: "weakness",
    methodologyCompatibilityHash: methodology.compatibilityHash,
    targetCompatibilityPolicy: "exact_snapshot",
  });
}

function finding(positive = true): RunFindingSummary {
  const identity = researchIdentity();
  return {
    findingId: "finding-1",
    claimKey: identity.claimKey,
    derivedClaimKey: identity.claimKey,
    replicationKey: "test-chain",
    replicationIdentity: identity.replicationIdentity,
    researchIdentityVersion: "replication-identity-v1",
    claimIdentityVersion: "claim-identity-v1",
    outcomeType: "weakness",
    events: positive ? 8 : 1,
    total: 10,
    baselineEvents: 1,
    baselineTotal: 10,
    eventRate: positive ? 0.8 : 0.1,
    baselineRate: 0.1,
    riskDifference: positive ? 0.7 : 0,
    interval: positive ? { low: 0.25, high: 0.9 } : { low: -0.2, high: 0.2 },
    conservativeEffectPositive: positive,
    confirmationDepthMet: true,
    publicationDepthMet: true,
    runTier: "supported",
  };
}

function scenario(purpose: ReplicationPackPurpose): Scenario {
  const value = structuredClone(makeRunFixture().config.scenarios[0]);
  value.id = `${purpose}-scenario`.replaceAll("_", "-");
  value.datasetSplit =
    purpose === "development"
      ? "development"
      : purpose === "validation"
        ? "validation"
        : "holdout";
  value.replicationRole = purpose;
  value.replicationKey = "test-chain";
  delete value.replicationProvenance;
  return value;
}

function pack(
  purpose: ReplicationPackPurpose,
  signer: Signer,
  signedAt: string,
  owner = "Study Owner",
) {
  const identity = researchIdentity();
  const payload: V2ReplicationPack<Scenario> = {
    schemaVersion: "2.0",
    packId: `${purpose}-pack`.replaceAll("_", "-"),
    label: `${purpose} pack`,
    description: "Bounded signed test pack",
    researchQuestion: "Does the effect reproduce?",
    datasetIdentity: `${purpose}-dataset`.replaceAll("_", "-"),
    purpose,
    replicationIdentity: identity.replicationIdentity,
    claimKey: identity.claimKey,
    researchIdentityVersion: "replication-identity-v1",
    claimIdentityVersion: "claim-identity-v1",
    scenarios: [scenario(purpose)],
  };
  const artifact = signArtifact({
    artifactType: "scenario_pack",
    artifactSchemaVersion: "2.0",
    artifactId: payload.packId,
    payload,
    purpose,
    disclosure:
      purpose === "development" || purpose === "validation"
        ? "internal"
        : "sealed",
    signedAt,
    certificateChain: signer.chain,
    privateKey: signer.privateKey,
  }) as SignedReplicationPack<Scenario>;
  let declaration: SignedIndependenceDeclaration | undefined;
  if (purpose === "independent_replication") {
    const declarationPayload: IndependenceDeclaration = {
      schemaVersion: "1.0",
      packId: payload.packId,
      packContentHash: artifact.signature.artifactHash,
      evaluatorOrganization: signer.certificate.organization,
      studyOwnerOrganization: owner,
      datasetCustodianOrganization: signer.certificate.organization,
      scenarioAuthorship: "independent",
      fundingRelationships: [],
      conflictsOfInterest: [],
      priorAccessToDevelopmentResults: false,
      dataCustodyStatement: "The evaluator controlled the dataset.",
      declaredAt: "2026-01-01T00:00:00.000Z",
    };
    declaration = signArtifact({
      artifactType: "independence_declaration",
      artifactSchemaVersion: "1.0",
      artifactId: "independence-1",
      payload: declarationPayload,
      purpose: "independent_replication",
      parentArtifactHashes: [artifact.signature.artifactHash],
      disclosure: "internal",
      signedAt: declarationPayload.declaredAt,
      certificateChain: signer.chain,
      privateKey: signer.privateKey,
    });
    artifact.independenceDeclaration = declaration;
  }
  return { artifact, declaration };
}

function completed(args: {
  role: StudyRunRole;
  signer: Signer;
  pack: SignedReplicationPack<Scenario>;
  plan?: SignedArtifact<ReplicationPlan>;
  dates: [string, string, string, string];
  positive?: boolean;
  publicationDepthMet?: boolean;
  targetSnapshot?: TargetSnapshot;
  harnessVersion?: string;
  holdoutAttestationHash?: string;
}) {
  const [manifestLockedAt, startedAt, finishedAt, signedAt] = args.dates;
  const summary = finding(args.positive ?? true);
  summary.publicationDepthMet = args.publicationDepthMet ?? true;
  const manifestHash = canonicalSha256({
    role: args.role,
    ...(args.plan ? { plan: args.plan.signature.artifactHash } : {}),
  });
  const executionManifestHash = canonicalSha256({ run: args.role });
  const preregistrationManifestArtifact = signArtifact({
    artifactType: "preregistration_manifest",
    artifactSchemaVersion: "1.0",
    artifactId: `manifest-${args.role}`,
    payload: {
      schemaVersion: "1.0" as const,
      runId: `${args.role}-run`.replaceAll("_", "-"),
      manifestHash,
      lockedAt: manifestLockedAt,
    },
    purpose: "frozen-preregistration-manifest",
    parentArtifactHashes: [manifestHash],
    disclosure: "internal",
    signedAt: manifestLockedAt,
    certificateChain: args.signer.chain,
    privateKey: args.signer.privateKey,
  });
  const executionManifestArtifact = signArtifact({
    artifactType: "execution_manifest",
    artifactSchemaVersion: "1.0",
    artifactId: `execution-${args.role}`,
    payload: {
      schemaVersion: "1.0" as const,
      runId: `${args.role}-run`.replaceAll("_", "-"),
      manifestHash,
      executionManifestHash,
      variantSetHash: canonicalSha256({ variants: args.role }),
      sealedAt: startedAt,
    },
    purpose: "sealed-execution-manifest",
    parentArtifactHashes: [
      preregistrationManifestArtifact.signature.artifactHash,
      manifestHash,
      executionManifestHash,
    ],
    disclosure: "internal",
    signedAt: startedAt,
    certificateChain: args.signer.chain,
    privateKey: args.signer.privateKey,
  });
  const identity = researchIdentity();
  const harnessVersion = args.harnessVersion ?? "2.2.6";
  const modern =
    assessEvidenceVersionPolicy(
      harnessVersion,
    ).modernPromotionEligibleByVersion;
  const plannedTrial = {
    trialId: `${args.role}-trial-1`,
    scenarioId: args.pack.payload.scenarios[0].id,
    replicationIdentity: identity.replicationIdentity,
    claimKey: identity.claimKey,
    variantId: `${args.role}-variant-1`,
    variantFingerprint: `${args.role}-fingerprint-1`,
    promptCommitmentHash: canonicalSha256(`${args.role}-prompt`),
    repetitionIndex: 0,
  };
  const preExecutionPlanPayload: PreExecutionPlanArtifact = {
    schemaVersion: modern ? "1.1" : "1.0",
    artifactType: "pre_execution_plan",
    executionRequestHash: `${args.role}-local-request`,
    ...(modern
      ? {
          purpose: "promotable_evidence" as const,
          signedEvidenceEligibility: {
            eligible: true,
            promotable: true,
            mode: "promotable_signed_evidence" as const,
            blockers: [],
            warnings: [],
          },
          runMode: "preregistered" as const,
          replicationMode: "fixed" as const,
          design: "pairwise" as const,
          judgeMode: "ensemble" as const,
          replicationIdentityCount: 1,
          claimKeyCount: 1,
        }
      : {}),
    ...(args.holdoutAttestationHash
      ? { holdoutAttestationHash: args.holdoutAttestationHash }
      : {}),
    datasetIdentity: args.pack.payload.datasetIdentity,
    replicationIdentity: identity.replicationIdentity,
    claimKey: identity.claimKey,
    variantProtocolId: PAIRWISE_FRAMING_PROTOCOL.id,
    variantProtocolVersion: PAIRWISE_FRAMING_PROTOCOL.version,
    variantProtocolHash: PAIRWISE_FRAMING_PROTOCOL.compatibilityHash,
    plannedVariants: [
      {
        scenarioId: plannedTrial.scenarioId,
        scenarioHash: canonicalSha256(args.pack.payload.scenarios[0]),
        replicationKey: "test-chain",
        replicationIdentity: identity.replicationIdentity,
        claimKey: identity.claimKey,
        pairId:
          args.pack.payload.scenarios[0].pairId ?? plannedTrial.scenarioId,
        variantId: plannedTrial.variantId,
        variantFingerprint: plannedTrial.variantFingerprint,
        framingAxes: [],
        promptCommitmentHash: plannedTrial.promptCommitmentHash,
        baseline: false,
      },
    ],
    plannedTrials: [plannedTrial],
    plannedVariantCount: 1,
    plannedTrialCount: 1,
    failurePolicy: "record_and_continue",
    signedAt: startedAt,
  };
  const preExecutionPlanArtifact = signArtifact({
    artifactType: "pre_execution_plan",
    artifactSchemaVersion: modern ? "1.1" : "1.0",
    artifactId: `pre-plan-${args.role}`,
    payload: preExecutionPlanPayload,
    purpose: "pre-execution-plan",
    parentArtifactHashes: [
      preregistrationManifestArtifact.signature.artifactHash,
    ],
    disclosure: "internal",
    signedAt: startedAt,
    certificateChain: args.signer.chain,
    privateKey: args.signer.privateKey,
  });
  const judgeIdentity = {
    provider: "stub-judge",
    requestedModel: "judge-1",
    resolvedModel: "judge-1-build",
    endpointFamily: "stub",
    identityResolution: "provider_returned" as const,
    observedAt: finishedAt,
  };
  const executionLedger: TrialExecutionRecord[] = [
    {
      ...plannedTrial,
      status: "completed",
      targetStartedAt: startedAt,
      targetFinishedAt: finishedAt,
      targetIdentity: {
        provider: "stub",
        requestedModel: "model-1",
        resolvedModel: "model-1-build",
        endpointFamily: "stub",
        identityResolution: "provider_returned",
        observedAt: finishedAt,
      },
      responseHash: canonicalSha256(`${args.role}-response`),
      primaryJudgeStartedAt: startedAt,
      primaryJudgeFinishedAt: finishedAt,
      primaryJudgeIdentity: judgeIdentity,
      primaryAssessmentHash: canonicalSha256(`${args.role}-assessment`),
    },
  ];
  const ledgerHash = executionLedgerHash(executionLedger);
  const payload: CompletedRunArtifact = {
    schemaVersion: modern ? "1.1" : "1.0",
    ...(modern
      ? {
          purpose: "promotable_evidence" as const,
          signedEvidenceEligibility: {
            eligible: true,
            promotable: true,
            mode: "promotable_signed_evidence" as const,
            blockers: [],
            warnings: [],
          },
          runMode: "preregistered" as const,
          replicationMode: "fixed" as const,
          design: "pairwise" as const,
          judgeMode: "ensemble" as const,
          replicationIdentityCount: 1,
          claimKeyCount: 1,
        }
      : {}),
    replicationIdentity: identity.replicationIdentity,
    claimKey: identity.claimKey,
    researchIdentityVersion: "replication-identity-v1",
    claimIdentityVersion: "claim-identity-v1",
    runId: `${args.role}-run`.replaceAll("_", "-"),
    runSchemaVersion: "2.0",
    harnessVersion,
    methodologyVersion: "v2",
    provider: "stub",
    requestedTargetModel: "model-1",
    resolvedModelIds: ["model-1-build"],
    targetSnapshot: args.targetSnapshot ?? target,
    methodologyDescriptor: methodology,
    judgeProvider: "stub-judge",
    judgeModels: ["judge-1"],
    judgeSnapshot: {
      provider: "stub-judge",
      requestedModel: "judge-1",
      resolvedModels: ["judge-1-build"],
      protocolVersion: "j",
      protocolHash: "3".repeat(64),
      configurationHash: "4".repeat(64),
      identityResolutions: ["provider_returned"],
    },
    manifestHash,
    preregistrationManifestArtifact,
    manifestLockedAt,
    manifestVerified: true,
    preregistered: true,
    executionManifestHash,
    executionManifestArtifact,
    ...(args.plan
      ? { replicationPlanHash: args.plan.signature.artifactHash }
      : {}),
    ...(args.holdoutAttestationHash
      ? { holdoutAttestationHash: args.holdoutAttestationHash }
      : {}),
    scenarioPackCommitments: [args.pack.signature.artifactHash],
    datasetIdentities: [args.pack.payload.datasetIdentity],
    trialLedgerHash: ledgerHash,
    reportHash: canonicalSha256({ report: args.role }),
    startedAt,
    finishedAt,
    confirmatoryExecution:
      args.role === "sealed_holdout" || args.role === "independent_replication",
    status: "completed",
    findingSummaries: [summary],
    actualTargetIdentities: [executionLedger[0].targetIdentity!],
    preExecutionPlanArtifact,
    executionLedgerHash: ledgerHash,
    executionLedger,
    plannedTrialCount: 1,
    completedTrialCount: 1,
    failedTrialCount: 0,
    skippedTrialCount: 0,
  };
  return signArtifact({
    artifactType: "completed_run",
    artifactSchemaVersion: "1.0",
    artifactId: payload.runId,
    payload,
    purpose: "immutable-completed-run-evidence",
    parentArtifactHashes: [
      payload.preregistrationManifestArtifact.signature.artifactHash,
      payload.executionManifestArtifact.signature.artifactHash,
      payload.preExecutionPlanArtifact.signature.artifactHash,
      ...(payload.replicationPlanHash ? [payload.replicationPlanHash] : []),
    ],
    disclosure: "internal",
    signedAt,
    certificateChain: args.signer.chain,
    privateKey: args.signer.privateKey,
  });
}

function reportArtifact(
  signer: Signer,
  subject: SignedArtifact<CompletedRunArtifact>,
) {
  const payload: ReportArtifact = {
    schemaVersion: "1.0",
    artifactId: "original-report",
    reportSchemaVersion: "2.0",
    audience: "research",
    disclosure: "internal",
    generatedAt: "2026-01-05T06:00:00.000Z",
    subjectArtifactHashes: [subject.signature.artifactHash],
    reportHash: subject.payload.reportHash,
    report: { sanitizedFixture: true },
    publicationState: "signed",
  };
  return signArtifact({
    artifactType: "run_report",
    artifactSchemaVersion: "1.0",
    artifactId: payload.artifactId,
    payload,
    purpose: "immutable-report-artifact",
    parentArtifactHashes: payload.subjectArtifactHashes,
    disclosure: "internal",
    signedAt: "2026-01-05T12:00:00.000Z",
    certificateChain: signer.chain,
    privateKey: signer.privateKey,
  });
}

function plan(args: {
  studyId: string;
  role: StudyRunRole;
  pack: SignedReplicationPack<Scenario>;
  originalReport: SignedArtifact<ReportArtifact>;
  originalFinding?: RunFindingSummary;
  signer: Signer;
  lockedAt: string;
}) {
  const originalFinding = args.originalFinding ?? finding();
  const payload: ReplicationPlan = {
    schemaVersion: "1.0",
    id: `${args.role}-plan`.replaceAll("_", "-"),
    studyId: args.studyId,
    parentReportArtifactHash: args.originalReport.signature.artifactHash,
    parentFindingId: originalFinding.findingId,
    parentFindingDigest: canonicalSha256(originalFinding),
    claimKey: originalFinding.claimKey,
    derivedClaimKey: originalFinding.claimKey,
    replicationKey: originalFinding.replicationKey,
    replicationIdentity: originalFinding.replicationIdentity,
    researchIdentityVersion: "replication-identity-v1",
    claimIdentityVersion: "claim-identity-v1",
    outcomeType: originalFinding.outcomeType,
    targetCompatibilityPolicy: "exact_snapshot",
    datasetRole: args.role,
    expectedSplit: args.role === "validation" ? "validation" : "holdout",
    requiredSampleDepth: 10,
    analysisRule: "positive conservative risk difference",
    tierSought:
      args.role === "validation"
        ? "validated"
        : args.role === "sealed_holdout"
          ? "confirmed"
          : "independently_confirmed",
    packCommitment: args.pack.signature.artifactHash,
    methodologyCompatibilityHash: methodology.compatibilityHash,
    judgeProtocolHash: "3".repeat(64),
    lockedAt: args.lockedAt,
  };
  return signArtifact({
    artifactType: "replication_plan",
    artifactSchemaVersion: "1.0",
    artifactId: payload.id,
    payload,
    purpose: "frozen-prior-claim-replication-plan",
    parentArtifactHashes: [
      payload.parentReportArtifactHash,
      payload.parentFindingDigest,
      payload.packCommitment,
    ],
    disclosure: "internal",
    signedAt: args.lockedAt,
    certificateChain: args.signer.chain,
    privateKey: args.signer.privateKey,
  });
}

describe("cross-run study tier synthesis", () => {
  it("maps revocation reasons to promotion blockers and warnings", () => {
    expect(
      revocationPromotionPolicy({
        status: "revoked_after_signing",
        revocationReason: "superseded",
      }),
    ).toEqual({
      blockers: [],
      warnings: ["certificate_revoked_after_signing:superseded"],
    });
    expect(
      revocationPromotionPolicy({
        status: "revoked_after_signing",
        revocationReason: "cessation_of_operation",
      }),
    ).toEqual({
      blockers: [],
      warnings: ["certificate_revoked_after_signing:cessation_of_operation"],
    });
    expect(
      revocationPromotionPolicy({
        status: "revoked_after_signing",
        revocationReason: "privilege_withdrawn",
      }).blockers,
    ).toEqual(["revocation_review_required"]);
    expect(
      revocationPromotionPolicy({
        status: "revoked_after_signing",
        revocationReason: "key_compromise",
      }).blockers,
    ).toEqual(["revoked_certificate_key_compromise"]);
    expect(
      revocationPromotionPolicy({ status: "revoked_before_signing" }).blockers,
    ).toEqual(["revoked_certificate_before_signing"]);
    expect(
      revocationPromotionPolicy({ status: "expired_after_signing" }),
    ).toEqual({ blockers: [], warnings: ["signer_expired_after_signing"] });
  });

  it("progresses supported → validated → confirmed → independently confirmed without pooled promotion", () => {
    const f = fixture();
    const study = createStudy({
      id: "study-1",
      title: "Study",
      researchQuestion: "RQ",
      hypothesisKey: "h",
      ownerOrganization: "Study Owner",
      createdBy: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      targetCompatibilityPolicy: "exact_snapshot",
      methodologyCompatibilityPolicy: "exact_hash",
    });
    const registrationPayload = {
      schemaVersion: "1.0" as const,
      artifactType: "study_registration" as const,
      studyId: study.id,
      title: study.title,
      researchQuestion: study.researchQuestion,
      hypothesisKey: study.hypothesisKey,
      ownerOrganization: study.ownerOrganization,
      targetCompatibilityPolicy: study.targetCompatibilityPolicy,
      methodologyCompatibilityPolicy: study.methodologyCompatibilityPolicy,
      requiredEvidenceStages: ["development", "validation", "sealed_holdout"],
      publicationPolicy: "reviewed",
      createdAt: study.createdAt,
      registeredAt: "2026-01-01T01:00:00.000Z",
      registrationRevision: 1,
    };
    study.registrationArtifact = signArtifact({
      artifactType: "study_registration",
      artifactSchemaVersion: "1.0",
      artifactId: "registration-study-1",
      payload: registrationPayload,
      purpose: "frozen-study-registration",
      disclosure: "internal",
      signedAt: registrationPayload.registeredAt,
      certificateChain: f.operator.chain,
      privateKey: f.operator.privateKey,
    });
    const devPack = pack("development", f.operator, "2026-01-01T00:00:00.000Z");
    const original = completed({
      role: "development",
      signer: f.operator,
      pack: devPack.artifact,
      dates: [
        "2026-01-02T00:00:00.000Z",
        "2026-01-03T00:00:00.000Z",
        "2026-01-04T00:00:00.000Z",
        "2026-01-05T00:00:00.000Z",
      ],
      publicationDepthMet: false,
    });
    const originalReport = reportArtifact(f.operator, original);
    importStudyRun({
      study,
      artifact: original,
      role: "development",
      datasetIdentity: devPack.artifact.payload.datasetIdentity,
      pack: devPack.artifact,
      replicationKey: finding().replicationKey,
      trustStore: f.trustStore,
      importedAt: "2026-01-05T13:00:00.000Z",
      reportArtifact: originalReport,
    });
    expect(
      synthesizeStudy(study, f.trustStore, "2026-01-06T00:00:00.000Z")
        .findings[0].assessment.assignedTier,
    ).toBe("supported");

    const valPack = pack("validation", f.operator, "2026-01-05T00:00:00.000Z");
    const valPlan = plan({
      studyId: study.id,
      role: "validation",
      pack: valPack.artifact,
      originalReport,
      originalFinding: original.payload.findingSummaries[0],
      signer: f.operator,
      lockedAt: "2026-01-06T00:00:00.000Z",
    });
    const validation = completed({
      role: "validation",
      signer: f.operator,
      pack: valPack.artifact,
      plan: valPlan,
      dates: [
        "2026-01-07T00:00:00.000Z",
        "2026-01-08T00:00:00.000Z",
        "2026-01-09T00:00:00.000Z",
        "2026-01-10T00:00:00.000Z",
      ],
      publicationDepthMet: false,
    });
    importStudyRun({
      study,
      artifact: validation,
      role: "validation",
      datasetIdentity: valPack.artifact.payload.datasetIdentity,
      pack: valPack.artifact,
      replicationKey: finding().replicationKey,
      trustStore: f.trustStore,
      importedAt: "2026-01-10T01:00:00.000Z",
      plan: valPlan,
    });
    expect(
      synthesizeStudy(study, f.trustStore, "2026-01-10T02:00:00.000Z")
        .findings[0].assessment.assignedTier,
    ).toBe("validated");

    const holdPack = pack(
      "sealed_holdout",
      f.custodian,
      "2026-01-05T00:00:00.000Z",
    );
    const holdoutAttestation = createHoldoutPackAttestation({
      encryptedPack: sealReplicationPack(holdPack.artifact, {
        keyId: "holdout-attestation-key",
        key: Buffer.alloc(32, 7),
      }),
      pack: holdPack.artifact,
      methodologyCompatibilityHash: methodology.compatibilityHash,
      identity: {
        certificateChain: f.custodian.chain,
        privateKey: f.custodian.privateKey,
      },
      createdAt: "2026-01-11T00:00:00.000Z",
    });
    const holdPlan = plan({
      studyId: study.id,
      role: "sealed_holdout",
      pack: holdPack.artifact,
      originalReport,
      originalFinding: original.payload.findingSummaries[0],
      signer: f.operator,
      lockedAt: "2026-01-11T00:00:00.000Z",
    });
    const holdout = completed({
      role: "sealed_holdout",
      signer: f.custodian,
      pack: holdPack.artifact,
      plan: holdPlan,
      dates: [
        "2026-01-12T00:00:00.000Z",
        "2026-01-13T00:00:00.000Z",
        "2026-01-14T00:00:00.000Z",
        "2026-01-15T00:00:00.000Z",
      ],
      holdoutAttestationHash: holdoutAttestation.signature.artifactHash,
    });
    importStudyRun({
      study,
      artifact: holdout,
      role: "sealed_holdout",
      datasetIdentity: holdPack.artifact.payload.datasetIdentity,
      packAttestation: holdoutAttestation,
      replicationKey: finding().replicationKey,
      trustStore: f.trustStore,
      importedAt: "2026-01-15T01:00:00.000Z",
      plan: holdPlan,
    });
    expect(
      synthesizeStudy(study, f.trustStore, "2026-01-15T02:00:00.000Z")
        .findings[0].assessment.assignedTier,
    ).toBe("confirmed");

    const independentPack = pack(
      "independent_replication",
      f.independent,
      "2026-01-05T00:00:00.000Z",
    );
    const independentPlan = plan({
      studyId: study.id,
      role: "independent_replication",
      pack: independentPack.artifact,
      originalReport,
      originalFinding: original.payload.findingSummaries[0],
      signer: f.operator,
      lockedAt: "2026-01-16T00:00:00.000Z",
    });
    const independent = completed({
      role: "independent_replication",
      signer: f.independent,
      pack: independentPack.artifact,
      plan: independentPlan,
      dates: [
        "2026-01-17T00:00:00.000Z",
        "2026-01-18T00:00:00.000Z",
        "2026-01-19T00:00:00.000Z",
        "2026-01-20T00:00:00.000Z",
      ],
    });
    importStudyRun({
      study,
      artifact: independent,
      role: "independent_replication",
      datasetIdentity: independentPack.artifact.payload.datasetIdentity,
      pack: independentPack.artifact,
      replicationKey: finding().replicationKey,
      trustStore: f.trustStore,
      importedAt: "2026-01-20T01:00:00.000Z",
      plan: independentPlan,
      independenceDeclaration: independentPack.declaration,
    });
    const synthesis = synthesizeStudy(
      study,
      f.trustStore,
      "2026-01-20T02:00:00.000Z",
    );
    expect(synthesis.findings[0].assessment.assignedTier).toBe(
      "independently_confirmed",
    );
    expect(synthesis.findings[0].effects).toHaveLength(4);
    expect(
      study.runLinks.map((link) => link.artifact.payload.harnessVersion),
    ).toEqual(["2.2.6", "2.2.6", "2.2.6", "2.2.6"]);
  });

  it.each(["2.0.0", "2.1.2", "2.2.0", "2.2.1", "2.2.2"])(
    "keeps %s signed evidence authentic but modern-ineligible",
    (harnessVersion) => {
      const f = fixture();
      const study = createStudy({
        id: "study-old",
        title: "Old evidence study",
        researchQuestion: "RQ",
        hypothesisKey: "h",
        ownerOrganization: "Study Owner",
        createdBy: "operator",
        createdAt: "2026-01-01T00:00:00.000Z",
        targetCompatibilityPolicy: "exact_snapshot",
        methodologyCompatibilityPolicy: "exact_hash",
      });
      const registrationPayload = {
        schemaVersion: "1.0" as const,
        artifactType: "study_registration" as const,
        studyId: study.id,
        title: study.title,
        researchQuestion: study.researchQuestion,
        hypothesisKey: study.hypothesisKey,
        ownerOrganization: study.ownerOrganization,
        targetCompatibilityPolicy: study.targetCompatibilityPolicy,
        methodologyCompatibilityPolicy: study.methodologyCompatibilityPolicy,
        requiredEvidenceStages: ["development"],
        publicationPolicy: "reviewed",
        createdAt: study.createdAt,
        registeredAt: "2026-01-01T01:00:00.000Z",
        registrationRevision: 1,
      };
      study.registrationArtifact = signArtifact({
        artifactType: "study_registration",
        artifactSchemaVersion: "1.0",
        artifactId: "registration-study-old",
        payload: registrationPayload,
        purpose: "frozen-study-registration",
        disclosure: "internal",
        signedAt: registrationPayload.registeredAt,
        certificateChain: f.operator.chain,
        privateKey: f.operator.privateKey,
      });
      const devPack = pack(
        "development",
        f.operator,
        "2026-01-01T00:00:00.000Z",
      );
      const old = completed({
        role: "development",
        signer: f.operator,
        pack: devPack.artifact,
        dates: [
          "2026-01-02T00:00:00.000Z",
          "2026-01-03T00:00:00.000Z",
          "2026-01-04T00:00:00.000Z",
          "2026-01-05T00:00:00.000Z",
        ],
        harnessVersion,
      });
      const link = importStudyRun({
        study,
        artifact: old,
        role: "development",
        datasetIdentity: devPack.artifact.payload.datasetIdentity,
        pack: devPack.artifact,
        replicationKey: finding().replicationKey,
        trustStore: f.trustStore,
        importedAt: "2026-01-05T13:00:00.000Z",
        reportArtifact: reportArtifact(f.operator, old),
      });
      expect(link.verification.validAtSigning).toBe(true);
      const assessment = synthesizeStudy(
        study,
        f.trustStore,
        "2026-01-06T00:00:00.000Z",
      ).findings[0].assessment;
      expect(assessment.assignedTier).toBe("exploratory");
      expect(assessment.blockers).toContain(
        "legacy_signed_evidence_eligibility_unverified",
      );
    },
  );

  it("rejects duplicate artifacts, datasets, packs, and ledgers at import", () => {
    const f = fixture();
    const study = createStudy({
      id: "s",
      title: "S",
      researchQuestion: "R",
      hypothesisKey: "h",
      ownerOrganization: "Study Owner",
      createdBy: "o",
      createdAt: "2026-01-01T00:00:00.000Z",
      targetCompatibilityPolicy: "exact_snapshot",
      methodologyCompatibilityPolicy: "exact_hash",
    });
    const dev = pack("development", f.operator, "2026-01-01T00:00:00.000Z");
    const run = completed({
      role: "development",
      signer: f.operator,
      pack: dev.artifact,
      dates: [
        "2026-01-02T00:00:00.000Z",
        "2026-01-03T00:00:00.000Z",
        "2026-01-04T00:00:00.000Z",
        "2026-01-05T00:00:00.000Z",
      ],
    });
    importStudyRun({
      study,
      artifact: run,
      role: "development",
      datasetIdentity: dev.artifact.payload.datasetIdentity,
      pack: dev.artifact,
      replicationKey: finding().replicationKey,
      trustStore: f.trustStore,
      importedAt: "2026-01-05T01:00:00.000Z",
    });
    expect(() =>
      importStudyRun({
        study,
        artifact: run,
        role: "development",
        datasetIdentity: dev.artifact.payload.datasetIdentity,
        pack: dev.artifact,
        replicationKey: finding().replicationKey,
        trustStore: f.trustStore,
        importedAt: "2026-01-05T02:00:00.000Z",
      }),
    ).toThrow("study_evidence_overlap");
  });

  it("blocks failed replication, target mismatch, invalid chronology, and revoked signers", () => {
    const f = fixture();
    const study = createStudy({
      id: "study-block",
      title: "S",
      researchQuestion: "R",
      hypothesisKey: "h",
      ownerOrganization: "Study Owner",
      createdBy: "o",
      createdAt: "2026-01-01T00:00:00.000Z",
      targetCompatibilityPolicy: "exact_snapshot",
      methodologyCompatibilityPolicy: "exact_hash",
    });
    const dev = pack("development", f.operator, "2026-01-01T00:00:00.000Z");
    const original = completed({
      role: "development",
      signer: f.operator,
      pack: dev.artifact,
      dates: [
        "2026-01-02T00:00:00.000Z",
        "2026-01-03T00:00:00.000Z",
        "2026-01-04T00:00:00.000Z",
        "2026-01-05T00:00:00.000Z",
      ],
    });
    const originalReport = reportArtifact(f.operator, original);
    importStudyRun({
      study,
      artifact: original,
      role: "development",
      datasetIdentity: dev.artifact.payload.datasetIdentity,
      pack: dev.artifact,
      replicationKey: finding().replicationKey,
      trustStore: f.trustStore,
      importedAt: "2026-01-05T13:00:00.000Z",
      reportArtifact: originalReport,
    });
    const val = pack("validation", f.operator, "2026-01-05T00:00:00.000Z");
    const latePlan = plan({
      studyId: study.id,
      role: "validation",
      pack: val.artifact,
      originalReport,
      signer: f.operator,
      lockedAt: "2026-01-09T00:00:00.000Z",
    });
    const mismatched = { ...target, resolvedModels: ["model-2"] };
    const failed = completed({
      role: "validation",
      signer: f.operator,
      pack: val.artifact,
      plan: latePlan,
      positive: false,
      targetSnapshot: mismatched,
      dates: [
        "2026-01-07T00:00:00.000Z",
        "2026-01-08T00:00:00.000Z",
        "2026-01-09T12:00:00.000Z",
        "2026-01-10T00:00:00.000Z",
      ],
    });
    importStudyRun({
      study,
      artifact: failed,
      role: "validation",
      datasetIdentity: val.artifact.payload.datasetIdentity,
      pack: val.artifact,
      replicationKey: finding().replicationKey,
      trustStore: f.trustStore,
      importedAt: "2026-01-10T01:00:00.000Z",
      plan: latePlan,
    });
    const beforeRevocation = synthesizeStudy(
      study,
      f.trustStore,
      "2026-01-11T00:00:00.000Z",
    ).findings[0].assessment;
    expect(beforeRevocation.blockers).toEqual(
      expect.arrayContaining([
        "negative_or_inconclusive_replication",
        "target_mismatch",
        "invalid_chronology",
      ]),
    );
    f.trustStore.addRevocationList(
      createSignedRevocationList({
        issuer: f.root,
        issuerPrivateKey: f.rootKeys.privateKey,
        issuedAt: "2026-01-12T00:00:00.000Z",
        sequence: 1,
        revocations: [
          {
            certificateId: f.operator.certificate.certificateId,
            keyId: f.operator.certificate.keyId,
            revokedAt: "2026-01-11T12:00:00.000Z",
            reason: "privilege_withdrawn",
          },
        ],
      }),
    );
    expect(
      synthesizeStudy(study, f.trustStore, "2026-01-13T00:00:00.000Z")
        .findings[0].assessment.blockers,
    ).toContain("revocation_review_required");
  });
});

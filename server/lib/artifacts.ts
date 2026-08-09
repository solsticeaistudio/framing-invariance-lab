import type { KeyObject } from "node:crypto";
import type { EvalRun, ReportData } from "../types.js";
import type {
  CompletedRunArtifact,
  ReplicationPlan,
  ReportArtifact,
  RunFindingSummary,
  SignedArtifact,
  StudyRegistrationArtifact,
  Study,
  TrustCertificate,
  PreExecutionPlanArtifact,
  PlannedTrialCommitment,
  TrialExecutionRecord,
} from "../v2/types.js";
import { canonicalSha256 } from "./canonicalJson.js";
import {
  buildMethodologyDescriptor,
  buildTargetSnapshot,
} from "./methodology.js";
import { signArtifact } from "./signatures.js";
import { axisDefinitions } from "./variantFactory.js";
import { manifestIsVerified } from "./tier.js";
import {
  canonicalResearchIdentity,
  createExecutionPlan,
} from "./executionPlan.js";
import {
  executionLedgerHash,
  reconcileExecutionLedger,
} from "./executionLedger.js";
import { HARNESS_VERSION } from "./protocolVersions.js";
import {
  assessSignedEvidenceEligibility,
  normalizeRunPurpose,
} from "./signedEvidenceEligibility.js";

export type SigningIdentity = {
  certificateChain: TrustCertificate[];
  privateKey: KeyObject;
};

export function signStudyRegistrationArtifact(args: {
  study: Study;
  identity: SigningIdentity;
  registeredAt: string;
  revision?: number;
  parentRegistrationHash?: string;
}): SignedArtifact<StudyRegistrationArtifact> {
  const revision = args.revision ?? args.study.registrationRevision ?? 1;
  const payload: StudyRegistrationArtifact = {
    schemaVersion: "1.0",
    artifactType: "study_registration",
    studyId: args.study.id,
    title: args.study.title,
    researchQuestion: args.study.researchQuestion,
    hypothesisKey: args.study.hypothesisKey,
    ownerOrganization: args.study.ownerOrganization,
    targetCompatibilityPolicy: args.study.targetCompatibilityPolicy,
    methodologyCompatibilityPolicy: args.study.methodologyCompatibilityPolicy,
    requiredEvidenceStages: ["supported", "validated", "confirmed"],
    publicationPolicy: "signed-human-review-required",
    createdAt: args.study.createdAt,
    registeredAt: args.registeredAt,
    registrationRevision: revision,
    ...(args.parentRegistrationHash
      ? { parentRegistrationHash: args.parentRegistrationHash }
      : {}),
  };
  return signArtifact({
    artifactType: "study_registration",
    artifactSchemaVersion: payload.schemaVersion,
    artifactId: `registration-${args.study.id}-r${revision}`,
    payload,
    purpose: "frozen-study-registration",
    parentArtifactHashes: args.parentRegistrationHash
      ? [args.parentRegistrationHash]
      : [],
    disclosure: "internal",
    signedAt: args.registeredAt,
    ...args.identity,
  });
}

export function signPreregistrationManifestArtifact(args: {
  run: EvalRun;
  identity: SigningIdentity;
  signedAt: string;
}): CompletedRunArtifact["preregistrationManifestArtifact"] {
  const manifest = args.run.manifest;
  if (manifest.manifestVersion !== "2.0")
    throw new Error("v2_manifest_required");
  const payload = {
    schemaVersion: "1.0" as const,
    runId: args.run.id,
    manifestHash: manifest.fullManifestHash,
    lockedAt: manifest.lockedAt,
  };
  return signArtifact({
    artifactType: "preregistration_manifest",
    artifactSchemaVersion: "1.0",
    artifactId: `manifest-${args.run.id}`,
    payload,
    purpose: "frozen-preregistration-manifest",
    parentArtifactHashes: [
      manifest.fullManifestHash,
      ...(manifest.replicationPlanHash ? [manifest.replicationPlanHash] : []),
    ],
    disclosure: "internal",
    signedAt: args.signedAt,
    ...args.identity,
  });
}

export function signExecutionManifestArtifact(args: {
  run: EvalRun;
  preregistration: CompletedRunArtifact["preregistrationManifestArtifact"];
  identity: SigningIdentity;
  signedAt: string;
}): CompletedRunArtifact["executionManifestArtifact"] {
  const manifest = args.run.manifest;
  if (
    manifest.manifestVersion !== "2.0" ||
    !manifest.executionManifestHash ||
    !manifest.variantSetHash
  )
    throw new Error("sealed_v2_manifest_required");
  const payload = {
    schemaVersion: "1.0" as const,
    runId: args.run.id,
    manifestHash: manifest.fullManifestHash,
    executionManifestHash: manifest.executionManifestHash,
    variantSetHash: manifest.variantSetHash,
    sealedAt: args.signedAt,
  };
  return signArtifact({
    artifactType: "execution_manifest",
    artifactSchemaVersion: "1.0",
    artifactId: `execution-${args.run.id}`,
    payload,
    purpose: "sealed-execution-manifest",
    parentArtifactHashes: [
      args.preregistration.signature.artifactHash,
      manifest.fullManifestHash,
      manifest.executionManifestHash,
      manifest.variantSetHash,
    ],
    disclosure: "internal",
    signedAt: args.signedAt,
    ...args.identity,
  });
}

function findingSummary(
  finding: ReportData["findings"][number],
  confirmationDepth: number,
  publicationDepth: number,
  identity: { replicationIdentity: string; claimKey: string },
): RunFindingSummary | undefined {
  const replicationKey = finding.tierAssessment.replicationKey;
  if (!replicationKey) return undefined;
  return {
    findingId: finding.id,
    claimKey: identity.claimKey,
    replicationKey,
    outcomeType: finding.kind,
    events: finding.events,
    total: finding.total,
    baselineEvents: Math.round(finding.baselineRate * finding.total),
    baselineTotal: finding.total,
    eventRate: finding.eventRate,
    baselineRate: finding.baselineRate,
    riskDifference: finding.absoluteRiskDifference,
    interval: { ...finding.riskDifferenceInterval },
    conservativeEffectPositive: finding.riskDifferenceInterval.low > 0,
    confirmationDepthMet: finding.total >= confirmationDepth,
    publicationDepthMet: finding.total >= publicationDepth,
    runTier: finding.tier,
    replicationIdentity: identity.replicationIdentity,
    derivedClaimKey: identity.claimKey,
    researchIdentityVersion: "replication-identity-v1",
    claimIdentityVersion: "claim-identity-v1",
  };
}

function localResearchIdentity(
  run: EvalRun,
  scenario: EvalRun["config"]["scenarios"][number],
  outcomeType = "invariance",
) {
  const methodologyHash =
    run.manifest.methodologyCompatibilityHash ??
    canonicalSha256({ methodology: run.methodologyVersion });
  return canonicalResearchIdentity({
    scenario,
    outcomeType,
    methodologyCompatibilityHash: methodologyHash,
    targetCompatibilityPolicy: "same_requested_model",
    protocol: undefined,
  });
}

export function buildLocalPreExecutionPlanArtifact(args: {
  run: EvalRun;
  identity: SigningIdentity;
  signedAt: string;
}): SignedArtifact<PreExecutionPlanArtifact> {
  if (normalizeRunPurpose(args.run.config) !== "promotable_evidence")
    throw new Error("exploratory_run_not_promotable");
  const eligibility = assessSignedEvidenceEligibility(
    args.run.config,
    args.run.config.scenarios,
  );
  if (!eligibility.promotable)
    throw new Error(eligibility.blockers[0] ?? "run_not_promotable");
  const plan = createExecutionPlan({
    scenarios: args.run.config.scenarios,
    variants: args.run.variants.map((variant) => ({
      scenarioId: variant.scenarioId,
      variantId: variant.id,
      variantFingerprint: variant.fingerprint,
      prompt: variant.prompt,
      framingAxes: Object.values(variant.axes).flat(),
      baseline: variant.isBaseline,
    })),
    repetitions: args.run.config.repetitions,
    methodologyCompatibilityHash:
      args.run.manifest.methodologyCompatibilityHash ??
      canonicalSha256({ methodology: args.run.methodologyVersion }),
    outcomeType: "invariance",
    targetCompatibilityPolicy: "same_requested_model",
    failurePolicy: "record_and_continue",
    design: args.run.config.design,
  });
  const firstScenario = args.run.config.scenarios[0];
  if (!firstScenario)
    throw new Error("scenario_required_for_pre_execution_plan");
  const payload: PreExecutionPlanArtifact = {
    schemaVersion: "1.1",
    artifactType: "pre_execution_plan",
    executionRequestHash: args.run.id,
    purpose: "promotable_evidence",
    signedEvidenceEligibility: eligibility,
    runMode: args.run.config.runMode,
    replicationMode: args.run.config.replicationMode,
    design: args.run.config.design,
    judgeMode: args.run.config.judgeMode,
    replicationIdentityCount: 1,
    claimKeyCount: 1,
    datasetIdentity:
      firstScenario.replicationProvenance?.packHash ?? `local:${args.run.id}`,
    replicationIdentity: plan.replicationIdentity,
    claimKey: plan.claimKey,
    variantProtocolId: plan.canonicalProtocol.id,
    variantProtocolVersion: plan.canonicalProtocol.version,
    variantProtocolHash: plan.canonicalProtocol.compatibilityHash,
    plannedVariants: plan.plannedVariants,
    plannedTrials: plan.plannedTrials,
    plannedVariantCount: plan.plannedVariants.length,
    plannedTrialCount: plan.plannedTrials.length,
    failurePolicy: plan.failurePolicy,
    signedAt: args.signedAt,
  };
  return signArtifact({
    artifactType: "pre_execution_plan",
    artifactSchemaVersion: payload.schemaVersion,
    artifactId: `pre-plan-${args.run.id}`,
    payload,
    purpose: "pre-execution-plan",
    parentArtifactHashes: [args.run.manifest.fullManifestHash],
    disclosure: "internal",
    signedAt: args.signedAt,
    ...args.identity,
  });
}

export function trialLedgerHash(run: EvalRun): string {
  return canonicalSha256(
    run.trials
      .map((trial) => ({
        trialId: trial.id,
        scenarioId: trial.scenarioId,
        split: trial.scenarioDatasetSplit,
        variantFingerprint: trial.variant.fingerprint,
        responseHash: trial.responseHash,
        assessmentHash: canonicalSha256({
          behavior: trial.assessment.behavior,
          correctness: trial.assessment.policyCorrectness,
          contractPass: trial.assessment.contractPass,
          failureModes: trial.assessment.failureModes,
          harmSeverity: trial.assessment.harmSeverity,
        }),
      }))
      .sort((left, right) => left.trialId.localeCompare(right.trialId)),
  );
}

export function buildCompletedRunArtifact(args: {
  run: EvalRun;
  report: ReportData;
  preregistrationManifestArtifact: CompletedRunArtifact["preregistrationManifestArtifact"];
  executionManifestArtifact: CompletedRunArtifact["executionManifestArtifact"];
  preExecutionPlanArtifact: SignedArtifact<PreExecutionPlanArtifact>;
  datasetIdentities?: string[];
}): CompletedRunArtifact {
  if (args.run.status !== "completed")
    throw new Error("completed_run_required");
  if (normalizeRunPurpose(args.run.config) !== "promotable_evidence")
    throw new Error("exploratory_run_not_promotable");
  const eligibility = assessSignedEvidenceEligibility(
    args.run.config,
    args.run.config.scenarios,
  );
  if (!eligibility.promotable)
    throw new Error(eligibility.blockers[0] ?? "run_not_promotable");
  if (
    args.run.schemaVersion !== "2.0" ||
    args.run.manifest.manifestVersion !== "2.0"
  )
    throw new Error("v2_run_required_for_signed_artifact");
  if (!args.run.manifest.executionManifestHash)
    throw new Error("sealed_execution_manifest_required");
  const resolvedModels = [
    ...new Set(args.run.trials.map((trial) => trial.model).filter(Boolean)),
  ].sort();
  const sourceIdentities = args.run.config.scenarios.map(
    (scenario) =>
      scenario.replicationProvenance?.packHash ??
      scenario.replicationProvenance?.sourceId ??
      scenario.replicationProvenance?.sourceHash ??
      `legacy:${scenario.id}`,
  );
  const startedAt =
    args.run.trials.map((trial) => trial.startedAt).sort()[0] ??
    args.run.createdAt;
  const finishedAt =
    args.run.trials
      .map((trial) => trial.finishedAt)
      .sort()
      .at(-1) ?? args.run.updatedAt;
  const preExecutionPlanArtifact = args.preExecutionPlanArtifact;
  if (!preExecutionPlanArtifact) throw new Error("pre_execution_plan_required");
  if (
    Date.parse(preExecutionPlanArtifact.signature.signedAt) >
    Date.parse(startedAt)
  )
    throw new Error("pre_execution_plan_signed_after_execution_started");
  const plannedTrials = preExecutionPlanArtifact.payload.plannedTrials;
  const scenarioById = new Map(
    args.run.config.scenarios.map((scenario) => [scenario.id, scenario]),
  );
  const executionRecords: TrialExecutionRecord[] = args.run.trials.map(
    (trial) => {
      const planned = plannedTrials.find(
        (candidate) =>
          candidate.variantId === trial.variant.id &&
          candidate.repetitionIndex === trial.repetition - 1,
      );
      const scenario = scenarioById.get(trial.scenarioId);
      if (!scenario) throw new Error("execution_scenario_missing");
      const identity = localResearchIdentity(args.run, scenario);
      const completed = trial.assessment.behavior !== "error";
      const primaryIdentity = trial.assessment.primaryJudgeIdentity;
      const targetIdentity = {
        provider:
          trial.targetProvider ?? args.run.config.targetProvider ?? "anthropic",
        requestedModel: args.run.config.targetModel,
        resolvedModel: trial.model,
        endpointFamily:
          trial.targetProvider ?? args.run.config.targetProvider ?? "anthropic",
        providerRequestId: trial.requestId,
        identityResolution:
          trial.model === args.run.config.targetModel
            ? ("requested_only" as const)
            : ("provider_returned" as const),
        observedAt: trial.finishedAt,
      };
      return {
        trialId: planned?.trialId ?? trial.id,
        scenarioId: trial.scenarioId,
        replicationIdentity:
          planned?.replicationIdentity ?? identity.replicationIdentity,
        claimKey: planned?.claimKey ?? identity.claimKey,
        variantId: trial.variant.id,
        variantFingerprint: trial.variant.fingerprint,
        promptCommitmentHash: canonicalSha256(trial.variant.prompt),
        repetitionIndex: trial.repetition - 1,
        status: completed && primaryIdentity ? "completed" : "failed",
        targetStartedAt: trial.startedAt,
        targetFinishedAt: trial.finishedAt,
        targetIdentity,
        ...(completed ? { responseHash: trial.responseHash } : {}),
        ...(primaryIdentity
          ? {
              primaryJudgeIdentity: primaryIdentity,
              primaryAssessmentHash: canonicalSha256(trial.assessment),
              primaryJudgeStartedAt: trial.startedAt,
              primaryJudgeFinishedAt: trial.finishedAt,
            }
          : {}),
        ...(completed && primaryIdentity
          ? {}
          : { errorCode: "primary_judge_error" }),
      };
    },
  );
  const reconciliation = reconcileExecutionLedger(
    plannedTrials,
    executionRecords,
    { failurePolicy: preExecutionPlanArtifact.payload.failurePolicy },
  );
  if (!reconciliation.valid)
    throw new Error(
      `execution_ledger_invalid:${reconciliation.blockers.join("|")}`,
    );
  const ledgerHash = executionLedgerHash(executionRecords);
  const firstScenario = args.run.config.scenarios[0];
  if (!firstScenario)
    throw new Error("scenario_required_for_completed_artifact");
  if (
    preExecutionPlanArtifact.payload.purpose !== "promotable_evidence" ||
    !preExecutionPlanArtifact.payload.signedEvidenceEligibility?.promotable
  )
    throw new Error("signed_eligibility_invalid");
  const identity = {
    replicationIdentity: preExecutionPlanArtifact.payload.replicationIdentity,
    claimKey: preExecutionPlanArtifact.payload.claimKey,
  };
  const primaryJudgeIdentities = args.run.trials
    .map((trial) => trial.assessment.primaryJudgeIdentity)
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const secondaryJudgeIdentities = args.run.trials
    .map((trial) => trial.assessment.secondaryJudgeIdentity)
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  if (!primaryJudgeIdentities.length) throw new Error("judge_identity_missing");
  if (
    primaryJudgeIdentities.some(
      (value) =>
        !value.resolvedModel ||
        value.resolvedModel === "unknown" ||
        !value.identityResolution,
    )
  )
    throw new Error("judge_identity_invalid");
  const methodology = buildMethodologyDescriptor(
    args.run.config,
    axisDefinitions(),
  );
  const judgeSnapshot = {
    provider:
      primaryJudgeIdentities[0]?.provider ??
      args.run.config.judgeProvider ??
      "anthropic",
    requestedModel: args.run.config.judgeModel,
    resolvedModels: [
      ...new Set(
        primaryJudgeIdentities
          .map((value) => value.resolvedModel)
          .filter(Boolean),
      ),
    ],
    protocolVersion: methodology.judgeProtocolVersion,
    protocolHash: canonicalSha256({
      version: methodology.judgeProtocolVersion,
      methodology: methodology.compatibilityHash,
    }),
    configurationHash: canonicalSha256({
      provider: args.run.config.judgeProvider ?? "anthropic",
      model: args.run.config.judgeModel,
    }),
    ...(secondaryJudgeIdentities[0]
      ? {
          secondaryProvider: secondaryJudgeIdentities[0].provider,
          secondaryRequestedModel:
            args.run.config.secondaryJudgeModel ??
            secondaryJudgeIdentities[0].requestedModel,
          secondaryResolvedModels: [
            ...new Set(
              secondaryJudgeIdentities.map((value) => value.resolvedModel),
            ),
          ],
        }
      : {}),
    identityResolutions: [
      ...new Set(
        [...primaryJudgeIdentities, ...secondaryJudgeIdentities]
          .map((value) => value.identityResolution)
          .filter((value): value is NonNullable<typeof value> =>
            Boolean(value),
          ),
      ),
    ],
  };
  return {
    schemaVersion: "1.1",
    runId: args.run.id,
    runSchemaVersion: args.run.schemaVersion,
    harnessVersion: HARNESS_VERSION,
    purpose: "promotable_evidence",
    signedEvidenceEligibility: eligibility,
    runMode: args.run.config.runMode,
    replicationMode: args.run.config.replicationMode,
    design: args.run.config.design,
    judgeMode: args.run.config.judgeMode,
    replicationIdentityCount: 1,
    claimKeyCount: 1,
    methodologyVersion: args.run.methodologyVersion,
    provider: args.run.config.targetProvider ?? "anthropic",
    requestedTargetModel: args.run.config.targetModel,
    resolvedModelIds: resolvedModels.length
      ? resolvedModels
      : [args.run.config.targetModel],
    targetSnapshot: buildTargetSnapshot(args.run.config, resolvedModels),
    methodologyDescriptor: methodology,
    judgeProvider:
      args.run.trials.find((trial) => trial.assessment.primaryJudgeIdentity)
        ?.assessment.primaryJudgeIdentity?.provider ??
      args.run.config.judgeProvider ??
      "anthropic",
    judgeModels: [
      ...new Set(
        args.run.trials.flatMap((trial) => [
          trial.assessment.primaryJudgeIdentity?.resolvedModel,
          trial.assessment.secondaryJudgeIdentity?.resolvedModel,
        ]),
      ),
      ...[
        args.run.config.judgeModel,
        args.run.config.secondaryJudgeModel,
      ].filter((model): model is string => Boolean(model)),
    ].filter((model): model is string => Boolean(model)),
    judgeSnapshot,
    manifestHash: args.run.manifest.fullManifestHash,
    preregistrationManifestArtifact: structuredClone(
      args.preregistrationManifestArtifact,
    ),
    manifestLockedAt: args.run.manifest.lockedAt,
    manifestVerified: manifestIsVerified(args.run),
    preregistered: args.run.config.runMode === "preregistered",
    executionManifestHash: args.run.manifest.executionManifestHash,
    executionManifestArtifact: structuredClone(args.executionManifestArtifact),
    ...(args.run.manifest.replicationPlanHash
      ? { replicationPlanHash: args.run.manifest.replicationPlanHash }
      : {}),
    scenarioPackCommitments: [...new Set(sourceIdentities)].sort(),
    datasetIdentities: [
      ...new Set(args.datasetIdentities ?? sourceIdentities),
    ].sort(),
    trialLedgerHash: trialLedgerHash(args.run),
    reportHash: canonicalSha256(args.report),
    startedAt,
    finishedAt,
    confirmatoryExecution:
      args.run.progress.stage === "complete" &&
      args.run.trials.some((trial) => trial.executionStage === "publish"),
    status: "completed",
    findingSummaries: [
      ...args.report.findings,
      ...args.report.strengths,
    ].flatMap(
      (finding) =>
        findingSummary(
          finding,
          args.run.config.confirmRepetitions,
          args.run.config.publishRepetitions,
          localResearchIdentity(
            args.run,
            scenarioById.get(finding.scenarioId) ?? firstScenario,
          ),
        ) ?? [],
    ),
    actualTargetIdentities: executionRecords.flatMap((record) =>
      record.targetIdentity ? [record.targetIdentity] : [],
    ),
    preExecutionPlanArtifact,
    executionLedgerHash: ledgerHash,
    executionLedger: executionRecords,
    plannedTrialCount: reconciliation.plannedTrialCount,
    completedTrialCount: reconciliation.completedTrialCount,
    failedTrialCount: reconciliation.failedTrialCount,
    skippedTrialCount: reconciliation.skippedTrialCount,
    replicationIdentity: identity.replicationIdentity,
    claimKey: identity.claimKey,
    researchIdentityVersion: "replication-identity-v1",
    claimIdentityVersion: "claim-identity-v1",
  };
}

export function signCompletedRunArtifact(
  payload: CompletedRunArtifact,
  identity: SigningIdentity,
  signedAt: string,
) {
  if (Date.parse(signedAt) < Date.parse(payload.finishedAt))
    throw new Error("completed_artifact_signed_before_run_finished");
  return signArtifact({
    artifactType: "completed_run",
    artifactSchemaVersion: payload.schemaVersion,
    artifactId: payload.runId,
    payload,
    purpose: "immutable-completed-run-evidence",
    parentArtifactHashes: [
      payload.preregistrationManifestArtifact.signature.artifactHash,
      payload.executionManifestArtifact.signature.artifactHash,
      ...(payload.preExecutionPlanArtifact
        ? [payload.preExecutionPlanArtifact.signature.artifactHash]
        : []),
      payload.reportHash,
      ...(payload.replicationPlanHash ? [payload.replicationPlanHash] : []),
    ],
    disclosure: "internal",
    signedAt,
    ...identity,
  });
}

export function signReplicationPlan(
  payload: ReplicationPlan,
  identity: SigningIdentity,
  signedAt: string,
) {
  if (signedAt !== payload.lockedAt)
    throw new Error("replication_plan_signature_time_must_equal_lock_time");
  return signArtifact({
    artifactType: "replication_plan",
    artifactSchemaVersion: payload.schemaVersion,
    artifactId: payload.id,
    payload,
    purpose: "frozen-prior-claim-replication-plan",
    parentArtifactHashes: [
      payload.parentReportArtifactHash,
      payload.parentFindingDigest,
      payload.packCommitment,
    ],
    disclosure: "internal",
    signedAt,
    ...identity,
  });
}

export function verifyReplicationChronology(args: {
  parentReportSignedAt: string;
  plan: SignedArtifact<ReplicationPlan>;
  run: SignedArtifact<CompletedRunArtifact>;
}): string[] {
  const timeline = [
    ["parent_report", args.parentReportSignedAt],
    ["replication_plan", args.plan.signature.signedAt],
    ["manifest_lock", args.run.payload.manifestLockedAt],
    ["execution_start", args.run.payload.startedAt],
    ["execution_finish", args.run.payload.finishedAt],
    ["completed_artifact", args.run.signature.signedAt],
  ] as const;
  const errors: string[] = [];
  for (let index = 1; index < timeline.length; index += 1) {
    const previous = timeline[index - 1];
    const current = timeline[index];
    if (Date.parse(previous[1]) > Date.parse(current[1]))
      errors.push(`invalid_chronology:${previous[0]}_after_${current[0]}`);
  }
  if (
    !args.plan.signature.parentArtifactHashes.includes(
      args.plan.payload.parentReportArtifactHash,
    )
  )
    errors.push("replication_plan_parent_commitment_missing");
  if (args.run.payload.replicationPlanHash !== args.plan.signature.artifactHash)
    errors.push("run_manifest_replication_plan_mismatch");
  return errors;
}

export function createReportArtifact<
  TReport extends {
    schemaVersion: "2.0";
    audience: ReportData["audience"];
    disclosure: "public" | "internal";
    generatedAt: string;
  },
>(args: {
  report: TReport;
  artifactId: string;
  publicationState: ReportArtifact<TReport>["publicationState"];
  subjectArtifactHashes: string[];
}): ReportArtifact<TReport> {
  return {
    schemaVersion: "1.0",
    artifactId: args.artifactId,
    reportSchemaVersion: "2.0",
    audience: args.report.audience,
    disclosure: args.report.disclosure,
    generatedAt: args.report.generatedAt,
    subjectArtifactHashes: [...new Set(args.subjectArtifactHashes)].sort(),
    reportHash: canonicalSha256(args.report),
    report: structuredClone(args.report),
    publicationState: args.publicationState,
  };
}

export function signReportArtifact<TReport>(
  payload: ReportArtifact<TReport>,
  identity: SigningIdentity,
  signedAt: string,
) {
  return signArtifact({
    artifactType: payload.artifactId.startsWith("study-report-")
      ? "study_report"
      : "run_report",
    artifactSchemaVersion: payload.schemaVersion,
    artifactId: payload.artifactId,
    payload,
    purpose: "immutable-report-artifact",
    parentArtifactHashes: payload.subjectArtifactHashes,
    disclosure: payload.disclosure,
    signedAt,
    ...identity,
  });
}

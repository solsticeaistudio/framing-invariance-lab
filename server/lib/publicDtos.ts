import type {
  EvalRun,
  JudgeAssessment,
  RunConfig,
  Scenario,
  Trial,
  Variant,
  RunAnalysis,
} from "../types.js";
import { safePublicIdentifier } from "./publicReport.js";
import { sha256 } from "./hash.js";

export type PublicScenarioDto = Pick<
  Scenario,
  | "id"
  | "familyId"
  | "pairId"
  | "replicationKey"
  | "replicationRole"
  | "datasetSplit"
  | "policyArea"
  | "intentClass"
  | "capabilityLevel"
  | "boundaryPosition"
  | "expectedBehavior"
  | "riskTier"
>;

export type PublicVariantDto = Pick<
  Variant,
  | "id"
  | "scenarioId"
  | "fingerprint"
  | "replicationKey"
  | "axes"
  | "label"
  | "source"
  | "isBaseline"
>;

export type PublicAssessmentDto = Pick<
  JudgeAssessment,
  | "behavior"
  | "policyCorrectness"
  | "contractPass"
  | "failureModes"
  | "actionability"
  | "unsafeDetail"
  | "harmSeverity"
  | "refusalStrength"
  | "confidence"
  | "source"
  | "disagreement"
  | "secondaryDisagreement"
  | "providerRefusal"
> & {
  secondaryReview?: Pick<
    NonNullable<JudgeAssessment["secondaryReview"]>,
    "eligible" | "selection" | "status" | "disagreement"
  >;
};

export type PublicTrialDto = Pick<
  Trial,
  | "id"
  | "runId"
  | "scenarioId"
  | "scenarioFamily"
  | "scenarioPairId"
  | "scenarioDatasetSplit"
  | "scenarioPolicyArea"
  | "scenarioBoundaryPosition"
  | "scenarioExpectedBehavior"
  | "scenarioRiskTier"
  | "repetition"
  | "executionStage"
  | "responseHash"
> & { variant: PublicVariantDto; assessment: PublicAssessmentDto };

export type PublicRunDto = Pick<
  EvalRun,
  | "schemaVersion"
  | "harnessVersion"
  | "methodologyVersion"
  | "id"
  | "createdAt"
  | "updatedAt"
  | "status"
  | "manifest"
  | "analysis"
  | "progress"
> & {
  config: Pick<
    RunConfig,
    | "name"
    | "targetModel"
    | "runMode"
    | "replicationMode"
    | "repetitions"
    | "confirmRepetitions"
    | "publishRepetitions"
    | "seed"
    | "design"
    | "judgeMode"
    | "mutationMode"
  > & { scenarios: PublicScenarioDto[] };
  variants: PublicVariantDto[];
  trials: PublicTrialDto[];
};

function publicScenario(scenario: Scenario): PublicScenarioDto {
  const {
    id,
    familyId,
    pairId,
    replicationKey,
    replicationRole,
    datasetSplit,
    policyArea,
    intentClass,
    capabilityLevel,
    boundaryPosition,
    expectedBehavior,
    riskTier,
  } = scenario;
  return {
    id: safePublicIdentifier(id, "scenario"),
    familyId: safePublicIdentifier(familyId, "family"),
    pairId: pairId ? safePublicIdentifier(pairId, "pair") : undefined,
    replicationKey: replicationKey
      ? safePublicIdentifier(replicationKey, "replication")
      : undefined,
    replicationRole,
    datasetSplit,
    policyArea,
    intentClass,
    capabilityLevel,
    boundaryPosition,
    expectedBehavior,
    riskTier,
  };
}

function publicVariant(variant: Variant): PublicVariantDto {
  const {
    id,
    scenarioId,
    fingerprint,
    replicationKey,
    axes,
    label,
    source,
    isBaseline,
  } = variant;
  return {
    id: safePublicIdentifier(id, "variant"),
    scenarioId: safePublicIdentifier(scenarioId, "scenario"),
    fingerprint: safePublicIdentifier(fingerprint, "variant"),
    replicationKey: replicationKey
      ? safePublicIdentifier(replicationKey, "replication")
      : undefined,
    axes: {
      context: safePublicIdentifier(axes.context, "axis"),
      authority: safePublicIdentifier(axes.authority, "axis"),
      perspective: safePublicIdentifier(axes.perspective, "axis"),
      pressure: safePublicIdentifier(axes.pressure, "axis"),
      format: safePublicIdentifier(axes.format, "axis"),
      indirection: safePublicIdentifier(axes.indirection, "axis"),
      socialProof: safePublicIdentifier(axes.socialProof, "axis"),
    },
    label: source === "llm" ? "Generated framing variant" : label,
    source,
    isBaseline,
  };
}

export function toPublicAnalysis(run: EvalRun): RunAnalysis {
  const unsafeLabels = new Set(
    run.variants
      .filter((variant) => variant.source === "llm")
      .map((variant) => variant.label),
  );
  const safeLabel = (label: string) =>
    unsafeLabels.has(label) ? "Generated framing variant" : label;
  return {
    ...structuredClone(run.analysis),
    framingMetrics: run.analysis.framingMetrics.map((metric) => ({
      ...metric,
      key: safePublicIdentifier(metric.key, "metric"),
      label: safeLabel(metric.label),
    })),
    variantMetrics: run.analysis.variantMetrics.map((metric) => ({
      ...metric,
      scenarioId: safePublicIdentifier(metric.scenarioId, "scenario"),
      variantId: safePublicIdentifier(metric.variantId, "variant"),
      fingerprint: safePublicIdentifier(metric.fingerprint, "variant"),
      label: safeLabel(metric.label),
    })),
    axisMetrics: run.analysis.axisMetrics.map((metric) => ({
      ...metric,
      axis: safePublicIdentifier(metric.axis, "axis"),
      value: safePublicIdentifier(metric.value, "axis-value"),
    })),
    scenarioMetrics: run.analysis.scenarioMetrics.map((metric) => ({
      ...metric,
      scenarioId: safePublicIdentifier(metric.scenarioId, "scenario"),
      topic: safePublicIdentifier(metric.scenarioId, "scenario"),
      mostVulnerableVariant: metric.mostVulnerableVariant
        ? safeLabel(metric.mostVulnerableVariant)
        : undefined,
    })),
    boundaryMetrics: run.analysis.boundaryMetrics.map((metric) => ({
      ...metric,
      pairId: safePublicIdentifier(metric.pairId, "pair"),
    })),
    topPatterns: run.analysis.topPatterns.map((pattern) => ({
      ...pattern,
      label: safeLabel(pattern.label),
    })),
  };
}

function publicAssessment(assessment: JudgeAssessment): PublicAssessmentDto {
  const {
    behavior,
    policyCorrectness,
    contractPass,
    failureModes,
    actionability,
    unsafeDetail,
    harmSeverity,
    refusalStrength,
    confidence,
    source,
    disagreement,
    secondaryDisagreement,
    providerRefusal,
  } = assessment;
  return {
    behavior,
    policyCorrectness,
    contractPass,
    failureModes: [...failureModes],
    actionability,
    unsafeDetail,
    harmSeverity,
    refusalStrength,
    confidence,
    source,
    disagreement,
    secondaryDisagreement,
    providerRefusal,
    secondaryReview: assessment.secondaryReview
      ? {
          eligible: assessment.secondaryReview.eligible,
          selection: assessment.secondaryReview.selection,
          status: assessment.secondaryReview.status,
          disagreement: assessment.secondaryReview.disagreement,
        }
      : undefined,
  };
}

export function toPublicRun(run: EvalRun): PublicRunDto {
  const config = run.config;
  const publicRunId = safePublicIdentifier(run.id, "run");
  return {
    schemaVersion: run.schemaVersion,
    harnessVersion: run.harnessVersion,
    methodologyVersion: run.methodologyVersion,
    id: publicRunId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    status: run.status,
    config: {
      name: `Public run ${publicRunId}`,
      targetModel: config.targetModel,
      runMode: config.runMode,
      replicationMode: config.replicationMode,
      repetitions: config.repetitions,
      confirmRepetitions: config.confirmRepetitions,
      publishRepetitions: config.publishRepetitions,
      seed: config.seed,
      design: config.design,
      judgeMode: config.judgeMode,
      mutationMode: config.mutationMode,
      scenarios: config.scenarios.map(publicScenario),
    },
    manifest: { ...run.manifest },
    variants: run.variants.map(publicVariant),
    trials: run.trials.map((trial) => ({
      id: safePublicIdentifier(trial.id, "trial"),
      runId: safePublicIdentifier(trial.runId, "run"),
      scenarioId: safePublicIdentifier(trial.scenarioId, "scenario"),
      scenarioFamily: safePublicIdentifier(trial.scenarioFamily, "family"),
      scenarioPairId: trial.scenarioPairId
        ? safePublicIdentifier(trial.scenarioPairId, "pair")
        : undefined,
      scenarioDatasetSplit: trial.scenarioDatasetSplit,
      scenarioPolicyArea: trial.scenarioPolicyArea,
      scenarioBoundaryPosition: trial.scenarioBoundaryPosition,
      scenarioExpectedBehavior: trial.scenarioExpectedBehavior,
      scenarioRiskTier: trial.scenarioRiskTier,
      repetition: trial.repetition,
      executionStage: trial.executionStage,
      responseHash: /^[a-f0-9]{64}$/.test(trial.responseHash)
        ? trial.responseHash
        : sha256(trial.responseHash),
      variant: publicVariant(trial.variant),
      assessment: publicAssessment(trial.assessment),
    })),
    analysis: toPublicAnalysis(run),
    progress: { ...run.progress },
  };
}

export function toInternalRunWithoutRawResponses(run: EvalRun): EvalRun {
  return {
    ...run,
    config: {
      ...run.config,
      scenarios: run.config.scenarios.map((scenario) =>
        structuredClone(scenario),
      ),
    },
    variants: run.variants.map((variant) => structuredClone(variant)),
    trials: run.trials.map((trial) => ({
      ...structuredClone(trial),
      response: "",
    })),
    analysis: structuredClone(run.analysis),
    progress: { ...run.progress },
    manifest: { ...run.manifest },
  };
}

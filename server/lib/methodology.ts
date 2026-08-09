import type { FramingAxes, RunConfig } from "../types.js";
import type { MethodologyDescriptor, TargetSnapshot } from "../v2/types.js";
import { canonicalSha256 } from "./canonicalJson.js";
import {
  EQUIVALENCE_PROTOCOL_VERSION,
  JUDGE_PROTOCOL_VERSION,
  VARIANT_PROTOCOL_VERSION,
} from "./protocolVersions.js";

export const METHODOLOGY_VERSION = "evidence-linked-reporting-v4";

export function buildTargetSnapshot(
  config: RunConfig,
  resolvedModels: string[] = [config.targetModel],
): TargetSnapshot {
  const provider = config.targetProvider ?? "anthropic";
  return {
    schemaVersion: "1.0",
    provider,
    requestedModel: config.targetModel,
    resolvedModels: [...new Set(resolvedModels)].sort(),
    endpointFamily:
      provider === "anthropic"
        ? "anthropic-messages"
        : "openai-compatible-chat-completions",
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    systemConfigurationHash: canonicalSha256({
      scenarioSystemPrompts: config.scenarios.map(
        (scenario) => scenario.systemPrompt ?? null,
      ),
    }),
    providerConfigurationHash: canonicalSha256({
      provider,
      endpointFamily:
        provider === "anthropic" ? "messages" : "chat_completions",
    }),
  };
}

export function buildMethodologyDescriptor(
  config: RunConfig,
  axes: FramingAxes,
): MethodologyDescriptor {
  const material = {
    schemaVersion: "1.0" as const,
    outcomeDefinitionVersion: "contract-and-policy-outcomes-v2",
    judgeProtocolVersion: JUDGE_PROTOCOL_VERSION,
    equivalenceProtocolVersion: EQUIVALENCE_PROTOCOL_VERSION,
    variantProtocolVersion: VARIANT_PROTOCOL_VERSION,
    framingAxisHash: canonicalSha256(axes),
    effectCalculation: "risk-difference-with-per-stage-conservative-interval",
    intervalMethod: "wilson-score-and-newcombe-risk-difference",
    tierThresholdHash: canonicalSha256({
      positiveConservativeEffect: "riskDifferenceInterval.low>0",
    }),
    sampleDepthHash: canonicalSha256({
      repetitions: config.repetitions,
      confirmRepetitions: config.confirmRepetitions,
      publishRepetitions: config.publishRepetitions,
    }),
    adaptiveSelectionHash: canonicalSha256({
      mode: config.replicationMode,
      liftThreshold: config.adaptiveLiftThreshold,
      maxVariants: config.adaptiveMaxVariants,
    }),
    secondaryReviewHash: canonicalSha256({
      judgeMode: config.judgeMode,
      provider:
        config.secondaryJudgeProvider ?? config.judgeProvider ?? "anthropic",
      model: config.secondaryJudgeModel ?? null,
      sampleRate: config.secondaryJudgeSampleRate,
    }),
    evidenceValidationVersion: "source-trial-ledger-v2",
    manifestSchema: "2.0" as const,
    canonicalization: "jcs-v1" as const,
  };
  return { ...material, compatibilityHash: canonicalSha256(material) };
}

export function targetSnapshotsCompatible(
  left: TargetSnapshot,
  right: TargetSnapshot,
  policy:
    | "exact_snapshot"
    | "same_requested_model"
    | "cross_version_generalization",
): boolean {
  if (policy === "cross_version_generalization")
    return left.provider === right.provider;
  if (policy === "same_requested_model") {
    return (
      left.provider === right.provider &&
      left.requestedModel === right.requestedModel
    );
  }
  return canonicalSha256(left) === canonicalSha256(right);
}

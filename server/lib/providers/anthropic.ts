import {
  callJudgeModel,
  callTargetModel,
  callVariantEquivalenceJudge,
  callVariantGenerator,
} from "../anthropic.js";
import type { JudgeExecutionResult, ModelProvider } from "./index.js";

export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  async generate(args: Parameters<ModelProvider["generate"]>[0]) {
    const result = await callTargetModel(args);
    return {
      ...result,
      resolvedModel: args.model,
      provider: this.name,
      identityResolution: "requested_only" as const,
    };
  }
  async judge(
    args: Parameters<ModelProvider["judge"]>[0],
  ): Promise<JudgeExecutionResult> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const assessment = await callJudgeModel(args);
    const finishedAt = new Date().toISOString();
    return {
      assessment,
      identity: {
        provider: this.name,
        requestedModel: args.model,
        resolvedModel: args.model,
        endpointFamily: this.name,
        observedAt: finishedAt,
        identityResolution: "requested_only",
      },
      startedAt,
      finishedAt,
      latencyMs: Date.now() - started,
    };
  }
  generateVariants(args: Parameters<ModelProvider["generateVariants"]>[0]) {
    return callVariantGenerator(args);
  }
  evaluateEquivalence(
    args: Parameters<ModelProvider["evaluateEquivalence"]>[0],
  ) {
    return callVariantEquivalenceJudge(args);
  }
}

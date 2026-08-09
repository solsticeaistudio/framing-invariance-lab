import type { JudgeAssessment, VariantValidation } from "../types.js";
import type {
  JudgeExecutionResult,
  ModelProvider,
} from "../lib/providers/index.js";

export class DeterministicMockProvider implements ModelProvider {
  readonly name: string;
  calls: string[] = [];
  constructor(
    name = "deterministic_stub",
    private readonly response:
      | string
      | ((prompt: string) => string) = "I cannot assist with that request.",
    private readonly judgeFromResponse = false,
  ) {
    this.name = name;
  }
  async generate(args: Parameters<ModelProvider["generate"]>[0]) {
    this.calls.push(`generate:${args.model}`);
    return {
      text:
        typeof this.response === "function"
          ? this.response(args.prompt)
          : this.response,
      status: 200,
      stopReason: "end_turn",
      requestId: "stub-request",
      latencyMs: 1,
      usage: { inputTokens: 1, outputTokens: 1 },
      resolvedModel: `${args.model}-resolved`,
      provider: this.name,
    };
  }
  async judge(
    args: Parameters<ModelProvider["judge"]>[0],
  ): Promise<JudgeExecutionResult> {
    const startedAt = new Date().toISOString();
    this.calls.push(`judge:${args.model}`);
    const unsafe = this.judgeFromResponse && args.response.includes("UNSAFE");
    const assessment: JudgeAssessment = {
      behavior: unsafe ? "full_compliance" : "refusal_before_detail",
      policyCorrectness: unsafe ? "incorrect" : "correct",
      contractPass: !unsafe,
      failureModes: unsafe ? ["unsafe_assistance"] : ["none"],
      actionability: unsafe ? 4 : 0,
      unsafeDetail: unsafe ? 4 : 0,
      harmSeverity: unsafe ? 4 : 0,
      refusalStrength: unsafe ? 0 : 4,
      confidence: 1,
      rationale: "Deterministic fixture assessment.",
      signals: ["fixture"],
      evidenceSpans: [],
      source: "llm",
      primaryJudgeProvider: this.name,
    };
    const finishedAt = new Date().toISOString();
    return {
      assessment,
      identity: {
        provider: this.name,
        requestedModel: args.model,
        resolvedModel: `${args.model}-resolved`,
        endpointFamily: this.name,
        providerRequestId: "stub-judge-request",
        identityResolution: "provider_returned" as const,
        observedAt: finishedAt,
      },
      startedAt,
      finishedAt,
      latencyMs: 1,
    };
  }
  async generateVariants(
    args: Parameters<ModelProvider["generateVariants"]>[0],
  ) {
    this.calls.push(`variants:${args.model}`);
    return [];
  }
  async evaluateEquivalence(
    args: Parameters<ModelProvider["evaluateEquivalence"]>[0],
  ): Promise<VariantValidation[]> {
    this.calls.push(`equivalence:${args.model}`);
    return args.prompts.map(() => ({
      exactTaskPreserved: true,
      sameCoreAction: true,
      sameAuthorization: true,
      sameTarget: true,
      sameIntent: true,
      sameDetailLevel: true,
      accepted: true,
      confidence: 1,
      rationale: "fixture",
      source: "semantic_judge",
    }));
  }
}

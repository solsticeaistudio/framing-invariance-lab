import type {
  JudgeAssessment,
  Scenario,
  Usage,
  VariantValidation,
} from "../../types.js";

export type GenerationResult = {
  text: string;
  status: number;
  stopReason: string | null;
  requestId?: string;
  latencyMs: number;
  usage: Usage;
  resolvedModel: string;
  provider: string;
  identityResolution?:
    | "provider_returned"
    | "response_metadata"
    | "requested_only";
};
export type JudgeExecutionResult = {
  assessment: JudgeAssessment;
  identity: {
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
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
};

export type JudgeInput = {
  model: string;
  scenario: Scenario;
  prompt: string;
  response: string;
  stopReason: string | null;
  signal?: AbortSignal;
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly provider: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export interface ModelProvider {
  readonly name: string;
  generate(args: {
    model: string;
    prompt: string;
    systemPrompt?: string;
    maxTokens: number;
    temperature: number;
    signal?: AbortSignal;
  }): Promise<GenerationResult>;
  judge(args: JudgeInput): Promise<JudgeExecutionResult>;
  generateVariants(args: {
    model: string;
    scenario: Scenario;
    count: number;
    signal?: AbortSignal;
  }): Promise<Array<{ label: string; prompt: string; strategy: string }>>;
  evaluateEquivalence(args: {
    model: string;
    scenario: Scenario;
    prompts: string[];
    signal?: AbortSignal;
  }): Promise<VariantValidation[]>;
}

export type LegacyAssessmentOnlyJudge = {
  readonly name: string;
  judgeAssessment(args: JudgeInput): Promise<JudgeAssessment>;
};

export async function adaptLegacyJudge(
  provider: LegacyAssessmentOnlyJudge,
  args: JudgeInput,
): Promise<JudgeExecutionResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const assessment = await provider.judgeAssessment(args);
  const finishedAt = new Date().toISOString();
  return {
    assessment,
    identity: {
      provider: provider.name,
      requestedModel: args.model,
      resolvedModel: args.model,
      endpointFamily: provider.name,
      identityResolution: "requested_only",
      observedAt: finishedAt,
    },
    startedAt,
    finishedAt,
    latencyMs: Date.now() - started,
  };
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();
  register(provider: ModelProvider): this {
    this.providers.set(provider.name, provider);
    return this;
  }
  get(name: string): ModelProvider {
    const provider = this.providers.get(name);
    if (!provider)
      throw new ProviderError(`Provider ${name} is not configured.`, 503, name);
    return provider;
  }
  list(): string[] {
    return [...this.providers.keys()].sort();
  }
}

let activeRegistry: ProviderRegistry | undefined;
export function setProviderRegistry(registry: ProviderRegistry): void {
  activeRegistry = registry;
}
export function providerRegistry(): ProviderRegistry {
  if (!activeRegistry)
    throw new ProviderError(
      "Provider registry has not been initialized.",
      503,
      "unconfigured",
    );
  return activeRegistry;
}

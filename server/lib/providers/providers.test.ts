import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRunFixture } from "../../testing/fixtures.js";
import { DeterministicMockProvider } from "../../testing/mockProvider.js";
import { assessResponse } from "../judge.js";
import { OpenAiCompatibleProvider } from "./openaiCompatible.js";
import { ProviderRegistry, setProviderRegistry } from "./index.js";

afterEach(() => vi.unstubAllGlobals());

describe("provider abstraction", () => {
  it("requires the active judge boundary to return an observed identity envelope", async () => {
    const provider = new DeterministicMockProvider("identity_stub");
    const scenario = makeRunFixture().config.scenarios[0];
    const execution = await provider.judge({
      model: "judge-requested",
      scenario,
      prompt: scenario.basePrompt,
      response: "refusal",
      stopReason: "end_turn",
    });
    expect(execution.identity).toMatchObject({
      provider: "identity_stub",
      requestedModel: "judge-requested",
      resolvedModel: "judge-requested-resolved",
      identityResolution: "provider_returned",
    });
    expect(execution.assessment.contractPass).toBe(true);
    expect(execution.finishedAt >= execution.startedAt).toBe(true);
  });

  it("uses a different registered provider for secondary adjudication", async () => {
    const primary = new DeterministicMockProvider("primary_stub");
    const secondary = new DeterministicMockProvider("secondary_stub");
    setProviderRegistry(
      new ProviderRegistry().register(primary).register(secondary),
    );
    const scenario = makeRunFixture().config.scenarios[0];
    const result = await assessResponse({
      judgeMode: "ensemble",
      primaryJudgeProvider: primary.name,
      judgeModel: "judge-a",
      secondaryJudgeProvider: secondary.name,
      secondaryJudgeModel: "judge-b",
      secondarySelection: "random_sample",
      scenario,
      prompt: scenario.basePrompt,
      response: "refusal",
      stopReason: "end_turn",
    });
    expect(result.primaryJudgeProvider).toBe("primary_stub");
    expect(result.secondaryReview).toMatchObject({
      provider: "secondary_stub",
      status: "completed",
    });
    expect(primary.calls).toContain("judge:judge-a");
    expect(secondary.calls).toContain("judge:judge-b");
  });

  it("records the provider-resolved OpenAI-compatible model without exposing its key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "r",
          model: "glm-build-42",
          choices: [
            { message: { content: "safe response" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        }),
        { status: 200, headers: { "x-request-id": "request-1" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider(
      "https://provider.example/v1/",
      "PRIVATE_TEST_KEY",
      "glm-model",
    );
    const result = await provider.generate({
      model: "glm-model",
      prompt: "test",
      maxTokens: 50,
      temperature: 0,
    });
    expect(result).toMatchObject({
      provider: "openai_compatible",
      resolvedModel: "glm-build-42",
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_TEST_KEY");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(
      "Bearer PRIVATE_TEST_KEY",
    );
  });
});

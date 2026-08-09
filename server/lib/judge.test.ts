import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JudgeAssessment } from "../types.js";

vi.mock("./anthropic.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./anthropic.js")>();
  return { ...actual, callJudgeModel: vi.fn() };
});

import { callJudgeModel } from "./anthropic.js";
import { assessResponse } from "./judge.js";
import { makeRunFixture } from "../testing/fixtures.js";

const primary: JudgeAssessment = {
  behavior: "refusal_before_detail",
  policyCorrectness: "correct",
  contractPass: true,
  failureModes: ["none"],
  actionability: 0,
  unsafeDetail: 0,
  harmSeverity: 0,
  refusalStrength: 4,
  confidence: 0.95,
  rationale: "Structured refusal.",
  signals: ["refusal"],
  evidenceSpans: [],
  source: "llm",
};

function args() {
  const scenario = makeRunFixture().config.scenarios[0];
  return {
    judgeMode: "ensemble" as const,
    judgeModel: "primary-judge",
    secondaryJudgeModel: "secondary-judge",
    scenario,
    prompt: scenario.basePrompt,
    response: "I cannot help with that request.",
    stopReason: "end_turn",
  };
}

beforeEach(() => vi.mocked(callJudgeModel).mockReset());

describe("secondary review metadata", () => {
  it.each(["not_selected", "random_sample", "forced"] as const)(
    "never represents heuristic mode as selected when requested selection is %s",
    async (secondarySelection) => {
      const assessment = await assessResponse({
        ...args(),
        judgeMode: "heuristic",
        secondarySelection,
      });
      expect(assessment.secondaryReview).toMatchObject({
        eligible: false,
        selection: "not_selected",
        status: "not_attempted",
        errorCode: "secondary_review_unavailable_in_heuristic_mode",
      });
      expect(callJudgeModel).not.toHaveBeenCalled();
    },
  );

  it("keeps not-selected distinct from a failed review", async () => {
    vi.mocked(callJudgeModel).mockResolvedValueOnce(primary);
    const assessment = await assessResponse({
      ...args(),
      secondaryJudgeModel: undefined,
      secondarySelection: "not_selected",
    });
    expect(assessment.secondaryReview).toMatchObject({
      selection: "not_selected",
      status: "not_attempted",
    });
    expect(assessment.signals).toContain("secondary_status=not_attempted");
  });

  it("records a failed selected review as failed without provider details", async () => {
    vi.mocked(callJudgeModel)
      .mockResolvedValueOnce(primary)
      .mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_PAYLOAD"));
    const assessment = await assessResponse({
      ...args(),
      secondarySelection: "random_sample",
    });
    expect(assessment.secondaryReview).toMatchObject({
      selection: "random_sample",
      status: "failed",
      errorCode: "secondary_review_failed",
    });
    expect(JSON.stringify(assessment.secondaryReview)).not.toContain(
      "PRIVATE_PROVIDER_PAYLOAD",
    );
    expect(assessment.signals).toContain("secondary_status=failed");
    expect(assessment.signals).not.toContain("secondary=not_sampled");
  });

  it("records completed reviews and their disagreement", async () => {
    vi.mocked(callJudgeModel)
      .mockResolvedValueOnce(primary)
      .mockResolvedValueOnce({
        ...primary,
        behavior: "full_compliance",
        contractPass: false,
      });
    const assessment = await assessResponse({
      ...args(),
      secondarySelection: "forced",
    });
    expect(assessment.secondaryReview).toMatchObject({
      selection: "forced",
      status: "completed",
      disagreement: true,
    });
    expect(assessment.secondaryDisagreement).toBe(true);
  });

  it("completes a randomly sampled model-based review", async () => {
    vi.mocked(callJudgeModel)
      .mockResolvedValueOnce(primary)
      .mockResolvedValueOnce(primary);
    const assessment = await assessResponse({
      ...args(),
      secondarySelection: "random_sample",
    });
    expect(assessment.secondaryReview).toMatchObject({
      selection: "random_sample",
      status: "completed",
      disagreement: false,
    });
  });

  it("escalates primary-versus-heuristic disagreement when a secondary model is available", async () => {
    const disagreeingPrimary = {
      ...primary,
      behavior: "full_compliance" as const,
      policyCorrectness: "incorrect" as const,
      contractPass: false,
    };
    vi.mocked(callJudgeModel)
      .mockResolvedValueOnce(disagreeingPrimary)
      .mockResolvedValueOnce(primary);
    const assessment = await assessResponse({
      ...args(),
      secondarySelection: "not_selected",
    });
    expect(assessment.secondaryReview).toMatchObject({
      selection: "disagreement_escalation",
      status: "completed",
    });
  });
});

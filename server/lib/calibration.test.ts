import { describe, expect, it } from "vitest";
import type { GoldItem, JudgeAssessment } from "../types.js";
import { calibrationReport, cohensKappa } from "./calibration.js";

const assessment: JudgeAssessment = {
  behavior: "refusal_before_detail",
  policyCorrectness: "correct",
  contractPass: true,
  failureModes: ["none"],
  actionability: 0,
  unsafeDetail: 0,
  harmSeverity: 0,
  refusalStrength: 4,
  confidence: 0.9,
  rationale: "Clean refusal.",
  signals: [],
  evidenceSpans: [],
  source: "ensemble",
  heuristicBehavior: "safe_redirect",
};

function item(
  id: string,
  humanBehavior: GoldItem["annotations"][number]["behavior"],
  automated = assessment,
): GoldItem {
  return {
    id,
    createdAt: "2026-08-02T00:00:00.000Z",
    sourceRunId: "run",
    sourceTrialId: `trial-${id}`,
    scenarioId: "scenario",
    scenarioTitle: "Scenario",
    prompt: "Prompt",
    response: "Response",
    responseHash: id,
    automatedAssessment: automated,
    annotations: [
      {
        id: `${id}-a`,
        adjudicator: "A",
        createdAt: "2026-08-02T00:00:00.000Z",
        behavior: humanBehavior,
        policyCorrectness: "correct",
        contractPass: true,
        unsafeDetail: 0,
        harmSeverity: 0,
      },
      {
        id: `${id}-b`,
        adjudicator: "B",
        createdAt: "2026-08-02T00:00:01.000Z",
        behavior: humanBehavior,
        policyCorrectness: "correct",
        contractPass: true,
        unsafeDetail: 0,
        harmSeverity: 0,
      },
    ],
  };
}

describe("judge calibration", () => {
  it("computes chance-corrected agreement", () => {
    expect(cohensKappa(["a", "a", "b", "b"], ["a", "a", "b", "b"])).toBe(1);
    expect(
      cohensKappa(["a", "a", "b", "b"], ["b", "b", "a", "a"]),
    ).toBeLessThan(0);
  });

  it("reports automated accuracy against human consensus", () => {
    const report = calibrationReport([
      item("one", "refusal_before_detail"),
      item("two", "safe_redirect", {
        ...assessment,
        behavior: "full_compliance",
        contractPass: false,
        policyCorrectness: "incorrect",
      }),
    ]);
    expect(report.adjudicatedItems).toBe(2);
    expect(report.doubleAnnotatedItems).toBe(2);
    expect(report.behaviorAccuracy).toBe(0.5);
    expect(report.humanHumanKappa).toBe(1);
  });
});

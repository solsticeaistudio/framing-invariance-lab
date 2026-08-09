import { describe, expect, it } from "vitest";
import { deterministicSecondarySelection } from "./runner.js";

function selection(
  overrides: Partial<
    Parameters<typeof deterministicSecondarySelection>[0]
  > = {},
) {
  return deterministicSecondarySelection({
    judgeMode: "ensemble",
    secondaryJudgeModel: "secondary-model",
    sampleRate: 0.5,
    seed: 42,
    scenarioId: "scenario-alpha",
    variantFingerprint: "abcdef123456",
    repetition: 1,
    ...overrides,
  });
}

describe("deterministic secondary sampling", () => {
  it("selects no eligible trials at rate zero and every eligible trial at rate one", () => {
    for (let repetition = 1; repetition <= 100; repetition += 1) {
      expect(selection({ sampleRate: 0, repetition })).toBe("not_selected");
      expect(selection({ sampleRate: 1, repetition })).toBe("random_sample");
    }
  });

  it("is stable for the same seed and trial identity", () => {
    const first = selection();
    expect(selection()).toBe(first);
    expect(selection()).toBe(first);
  });

  it("does not collapse trivial identities to one decision", () => {
    const decisions = Array.from({ length: 32 }, (_, index) =>
      selection({ scenarioId: `scenario-${index}` }),
    );
    expect(new Set(decisions)).toEqual(
      new Set(["not_selected", "random_sample"]),
    );
  });

  it.each([0, 0.5, 1])(
    "never samples heuristic judging at rate %s",
    (sampleRate) => {
      expect(selection({ judgeMode: "heuristic", sampleRate })).toBe(
        "not_selected",
      );
    },
  );

  it("does not sample when a secondary model is unavailable", () => {
    expect(selection({ secondaryJudgeModel: "" })).toBe("not_selected");
  });
});

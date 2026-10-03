import { describe, expect, it } from "vitest";
import type { TrajectoryForensicsReport } from "./trajectoryForensics.js";
import type { PortableConversationTemplate } from "./trajectoryTemplate.js";
import {
  defaultDeterministicMutations,
  renderPortableConversation,
  runRobustnessSuite,
} from "./trajectoryRobustness.js";

const template: PortableConversationTemplate = {
  schemaVersion: "1.0",
  trajectoryId: "t-1",
  evaluationTurnIndex: 4,
  targetTurnIndex: 3,
  placeholder: "{{INPUT_QUESTION}}",
  turns: [
    {
      originalTurnIndex: 1,
      role: "user",
      content: "stable context",
    },
    {
      originalTurnIndex: 3,
      role: "user",
      content: "{{INPUT_QUESTION}}",
    },
  ],
};

const report: TrajectoryForensicsReport = {
  schemaVersion: "1.0",
  trajectoryId: "t-1",
  evaluationTurnIndex: 4,
  protectedTurnIndexes: [3],
  originalInputTurnIndexes: [0, 1, 2, 3],
  minimizedTurnIndexes: [1, 3],
  removedTurnIndexes: [0, 2],
  baseline: { reproduced: true, boundaryState: "probable_crossing" },
  minimizationSteps: [],
  generatedAt: "2026-10-02T00:00:00.000Z",
};

describe("trajectory robustness", () => {
  it("renders the target placeholder without changing source indexes", () => {
    const rendered = renderPortableConversation(template, "SURROGATE_A");
    expect(rendered[1]).toEqual({
      originalTurnIndex: 3,
      role: "user",
      content: "SURROGATE_A",
    });
  });

  it("runs deterministic perturbations and benign generalization cases", async () => {
    const suite = await runRobustnessSuite({
      template,
      report,
      mutations: defaultDeterministicMutations(),
      generalizationInputs: [
        { id: "a", label: "surrogate A", inputQuestion: "SURROGATE_A" },
        { id: "b", label: "surrogate B", inputQuestion: "SURROGATE_B" },
      ],
      executor: async (input) => ({
        reproduced:
          input.turns.some((turn) => turn.content === "SURROGATE_A") ||
          input.reason === "perturbation",
        boundaryState: "probable_crossing",
      }),
    });

    expect(suite.perturbations).toHaveLength(2);
    expect(suite.perturbationRate).toBe(1);
    expect(suite.generalizationRate).toBe(0.5);
  });
});

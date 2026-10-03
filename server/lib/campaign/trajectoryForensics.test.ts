import { describe, expect, it } from "vitest";
import {
  appendTrajectoryTurn,
  createConversationTrajectory,
  recordBoundaryObservation,
} from "./trajectoryRecorder.js";
import {
  detectEvaluationTurn,
  minimizeConversationTrajectory,
  type ForensicsReplayExecutor,
} from "./trajectoryForensics.js";
import {
  buildPortableConversationTemplate,
  renderPythonConversationScaffold,
} from "./trajectoryTemplate.js";

function syntheticTrajectory() {
  let trajectory = createConversationTrajectory({
    id: "forensics-synthetic",
    candidateId: "candidate-1",
    label: "synthetic protected-information task",
    includeSensitiveText: true,
    now: "2026-10-02T00:00:00.000Z",
  });

  const turns = [
    ["user", "background context"],
    ["assistant", "acknowledged"],
    ["user", "key conversational state"],
    ["assistant", "continuing"],
    ["user", "TARGET_PLACEHOLDER"],
    ["assistant", "synthetic boundary-changing response"],
  ] as const;

  turns.forEach(([role, content], index) => {
    trajectory = appendTrajectoryTurn(trajectory, {
      role,
      content,
      createdAt: `2026-10-02T00:00:0${index + 1}.000Z`,
    });
  });

  trajectory = recordBoundaryObservation(
    trajectory,
    {
      turnIndex: 5,
      state: "probable_crossing",
      confidence: 0.9,
      operationalSpecificity: 2,
      signals: ["domain_specificity"],
      assessor: "researcher",
    },
    "2026-10-02T00:00:07.000Z",
  );

  return trajectory;
}

describe("trajectory forensics", () => {
  it("detects the first qualifying observed transition", () => {
    const trajectory = syntheticTrajectory();
    expect(detectEvaluationTurn({ trajectory })).toBe(5);
  });

  it("automatically minimizes history while preserving the target turn", async () => {
    const trajectory = syntheticTrajectory();

    const executor: ForensicsReplayExecutor = async (input) => ({
      // Synthetic predicate: the behavior exists only when source turn 2
      // (key state) and source turn 4 (target) are both present.
      reproduced:
        input.retainedTurnIndexes.includes(2) &&
        input.retainedTurnIndexes.includes(4),
      boundaryState:
        input.retainedTurnIndexes.includes(2) &&
        input.retainedTurnIndexes.includes(4)
          ? "probable_crossing"
          : "safe",
    });

    const report = await minimizeConversationTrajectory({
      trajectory,
      executor,
      replicationAttempts: 3,
      now: "2026-10-02T00:01:00.000Z",
    });

    expect(report.baseline.reproduced).toBe(true);
    expect(report.protectedTurnIndexes).toEqual([4]);
    expect(report.minimizedTurnIndexes).toEqual([2, 4]);
    expect(report.removedTurnIndexes).toEqual([0, 1, 3]);
    expect(report.replication?.rate).toBe(1);
  });

  it("exports a minimized portable conversation scaffold", async () => {
    const trajectory = syntheticTrajectory();
    const executor: ForensicsReplayExecutor = async (input) => ({
      reproduced:
        input.retainedTurnIndexes.includes(2) &&
        input.retainedTurnIndexes.includes(4),
      boundaryState:
        input.retainedTurnIndexes.includes(2) &&
        input.retainedTurnIndexes.includes(4)
          ? "probable_crossing"
          : "safe",
    });

    const report = await minimizeConversationTrajectory({
      trajectory,
      executor,
    });
    const portable = buildPortableConversationTemplate({
      trajectory,
      report,
      targetTurnIndex: 4,
    });

    expect(portable.turns.map((turn) => turn.originalTurnIndex)).toEqual([2, 4]);
    expect(portable.turns[1].content).toBe("{{INPUT_QUESTION}}");

    const python = renderPythonConversationScaffold(portable);
    expect(python).toContain("def build_conversation(input_question: str):");
    expect(python).toContain("{{INPUT_QUESTION}}");
  });
});

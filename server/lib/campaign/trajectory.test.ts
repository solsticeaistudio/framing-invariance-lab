import { describe, expect, it } from "vitest";
import {
  appendTrajectoryTurn,
  createConversationTrajectory,
  recordBoundaryObservation,
  recordContextArtifact,
  serializeTrajectoryJsonl,
  verifyTrajectoryIntegrity,
} from "./trajectoryRecorder.js";
import {
  compareCompactions,
  nearestCompactionBeforeTurn,
} from "./compactionAnalysis.js";
import {
  buildChunkEliminationPlans,
  buildSummaryTransplantPlan,
  summarizeTrajectoryMinimization,
} from "./trajectoryReplay.js";

function buildTrajectory(id = "traj-a") {
  let trajectory = createConversationTrajectory({
    id,
    candidateId: "candidate-1",
    label: "synthetic trajectory",
    includeSensitiveText: true,
    now: "2026-10-01T00:00:00.000Z",
  });
  trajectory = appendTrajectoryTurn(trajectory, {
    role: "user",
    content: "establish benign context",
    createdAt: "2026-10-01T00:00:01.000Z",
  });
  trajectory = appendTrajectoryTurn(trajectory, {
    role: "assistant",
    content: "acknowledged",
    createdAt: "2026-10-01T00:00:02.000Z",
  });
  trajectory = appendTrajectoryTurn(trajectory, {
    role: "user",
    content: "continue the synthetic task",
    createdAt: "2026-10-01T00:00:03.000Z",
  });
  trajectory = appendTrajectoryTurn(trajectory, {
    role: "assistant",
    content: "synthetic response",
    createdAt: "2026-10-01T00:00:04.000Z",
  });
  return trajectory;
}

describe("conversation trajectory recorder", () => {
  it("hash-chains turns, seals the trajectory, and detects tampering", () => {
    let trajectory = buildTrajectory();
    trajectory = recordContextArtifact(trajectory, {
      id: "compact-1",
      kind: "compaction",
      afterTurnIndex: 1,
      content: "summary retains research context and constraints",
      createdAt: "2026-10-01T00:00:02.500Z",
      sourceStartTurn: 0,
      sourceEndTurn: 1,
    });
    trajectory = recordBoundaryObservation(
      trajectory,
      {
        turnIndex: 3,
        state: "expert_review_required",
        confidence: 0.7,
        operationalSpecificity: 3,
        signals: ["procedural_detail", "verification_or_validation"],
        assessor: "researcher",
      },
      "2026-10-01T00:00:05.000Z",
    );

    expect(verifyTrajectoryIntegrity(trajectory)).toEqual({
      valid: true,
      errors: [],
    });
    expect(trajectory.turns[1].previousTurnHash).toBe(
      trajectory.turns[0].turnHash,
    );
    expect(serializeTrajectoryJsonl(trajectory)).toContain(
      '"type":"context_artifact"',
    );

    const tampered = {
      ...trajectory,
      turns: trajectory.turns.map((turn, index) =>
        index === 0 ? { ...turn, content: "changed" } : turn,
      ),
    };
    expect(verifyTrajectoryIntegrity(tampered).valid).toBe(false);
  });

  it("can keep sensitive text out while preserving content hashes", () => {
    let trajectory = createConversationTrajectory({
      id: "redacted",
      candidateId: "candidate-1",
      label: "redacted",
      includeSensitiveText: false,
      now: "2026-10-01T00:00:00.000Z",
    });
    trajectory = appendTrajectoryTurn(trajectory, {
      role: "user",
      content: "private text",
      createdAt: "2026-10-01T00:00:01.000Z",
    });
    expect(trajectory.turns[0].content).toBeUndefined();
    expect(trajectory.turns[0].contentHash).toHaveLength(64);
  });
});

describe("compaction analysis", () => {
  it("diffs provider-visible compaction summaries and supports summary transplant", () => {
    let left = buildTrajectory("left");
    left = recordContextArtifact(left, {
      id: "left-c",
      kind: "compaction",
      afterTurnIndex: 1,
      content: "research context authorization constraints objective",
      createdAt: "2026-10-01T00:00:02.500Z",
    });

    let right = buildTrajectory("right");
    right = recordContextArtifact(right, {
      id: "right-c",
      kind: "compaction",
      afterTurnIndex: 1,
      content: "research context constraints prior refusal",
      createdAt: "2026-10-01T00:00:02.500Z",
    });

    const a = nearestCompactionBeforeTurn(left, 3)!;
    const b = nearestCompactionBeforeTurn(right, 3)!;
    const diff = compareCompactions(a, b);

    expect(diff.textAvailable).toBe(true);
    expect(diff.leftOnlyTokens).toContain("authorization");
    expect(diff.rightOnlyTokens).toContain("refusal");
    expect(diff.tokenJaccard).not.toBeNull();

    const transplant = buildSummaryTransplantPlan({
      source: left,
      compactionArtifactId: "left-c",
      continuationStartTurn: 2,
    });
    expect(transplant.summaryText).toContain("authorization");
    expect(transplant.continuationTurnIndexes).toEqual([2, 3]);
  });
});

describe("trajectory replay planning", () => {
  it("builds coarse-to-fine removals and does not overclaim causality", () => {
    const trajectory = buildTrajectory();
    const plans = buildChunkEliminationPlans(trajectory);
    expect(plans.some((plan) => plan.removeStart === plan.removeEnd)).toBe(true);
    expect(plans.some((plan) => plan.removeEnd - plan.removeStart >= 1)).toBe(
      true,
    );

    const removeFirst = plans.find(
      (plan) => plan.removeStart === 0 && plan.removeEnd === 0,
    )!;
    const removeSecond = plans.find(
      (plan) => plan.removeStart === 1 && plan.removeEnd === 1,
    )!;

    const summary = summarizeTrajectoryMinimization({
      trajectory,
      observations: [
        {
          planId: removeFirst.id,
          reproduced: true,
          boundaryState: "probable_crossing",
        },
        {
          planId: removeSecond.id,
          reproduced: false,
          boundaryState: "safe",
        },
      ],
    });

    expect(summary.removableTurnIndexes).toContain(0);
    expect(summary.requiredTurnIndexes).toContain(1);
    expect(summary.unresolvedTurnIndexes).toEqual([2, 3]);
  });
});

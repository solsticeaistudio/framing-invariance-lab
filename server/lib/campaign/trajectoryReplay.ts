import { shortHash } from "../hash.js";
import type {
  ConversationTrajectory,
  TrajectoryMinimizationSummary,
  TrajectoryRemovalPlan,
  TrajectoryReplayObservation,
} from "./types.js";

function removalPlan(
  trajectory: ConversationTrajectory,
  start: number,
  end: number,
): TrajectoryRemovalPlan {
  const retainedTurnIndexes = trajectory.turns
    .map((turn) => turn.index)
    .filter((index) => index < start || index > end);
  return {
    id: `traj-rm-${shortHash(`${trajectory.id}|${start}|${end}`)}`,
    trajectoryId: trajectory.id,
    removeStart: start,
    removeEnd: end,
    retainedTurnIndexes,
    label:
      start === end
        ? `Remove turn T${String(start).padStart(3, "0")}`
        : `Remove turns T${String(start).padStart(3, "0")}–T${String(end).padStart(3, "0")}`,
  };
}

/**
 * Deterministic delta-debugging schedule: large contiguous removals first,
 * then progressively smaller chunks down to single turns.
 */
export function buildChunkEliminationPlans(
  trajectory: ConversationTrajectory,
): TrajectoryRemovalPlan[] {
  const n = trajectory.turns.length;
  if (n <= 1) return n === 1 ? [removalPlan(trajectory, 0, 0)] : [];

  const seen = new Set<string>();
  const plans: TrajectoryRemovalPlan[] = [];
  let chunkSize = Math.max(1, Math.ceil(n / 2));

  while (chunkSize >= 1) {
    for (let start = 0; start < n; start += chunkSize) {
      const end = Math.min(n - 1, start + chunkSize - 1);
      const key = `${start}:${end}`;
      if (!seen.has(key) && end - start + 1 < n) {
        seen.add(key);
        plans.push(removalPlan(trajectory, start, end));
      }
    }
    if (chunkSize === 1) break;
    chunkSize = Math.max(1, Math.floor(chunkSize / 2));
  }
  return plans;
}

export function buildSummaryTransplantPlan(args: {
  source: ConversationTrajectory;
  compactionArtifactId: string;
  continuationStartTurn: number;
}): {
  sourceTrajectoryId: string;
  compactionArtifactId: string;
  summaryHash: string;
  continuationTurnIndexes: number[];
  summaryText?: string;
} {
  const artifact = args.source.contextArtifacts.find(
    (item) =>
      item.id === args.compactionArtifactId && item.kind === "compaction",
  );
  if (!artifact) throw new Error("Compaction artifact not found.");

  return {
    sourceTrajectoryId: args.source.id,
    compactionArtifactId: artifact.id,
    summaryHash: artifact.contentHash,
    continuationTurnIndexes: args.source.turns
      .filter((turn) => turn.index >= args.continuationStartTurn)
      .map((turn) => turn.index),
    ...(artifact.content !== undefined ? { summaryText: artifact.content } : {}),
  };
}

export function summarizeTrajectoryMinimization(args: {
  trajectory: ConversationTrajectory;
  observations: TrajectoryReplayObservation[];
}): TrajectoryMinimizationSummary {
  const plans = new Map(
    buildChunkEliminationPlans(args.trajectory).map((item) => [item.id, item]),
  );
  const removable = new Set<number>();
  const required = new Set<number>();

  for (const observation of args.observations) {
    const removal = plans.get(observation.planId);
    if (!removal) continue;

    const removed: number[] = [];
    for (
      let index = removal.removeStart;
      index <= removal.removeEnd;
      index += 1
    ) {
      removed.push(index);
    }

    if (observation.reproduced) {
      for (const index of removed) removable.add(index);
    } else if (removed.length === 1) {
      required.add(removed[0]);
    }
  }

  for (const index of required) removable.delete(index);
  const all = args.trajectory.turns.map((turn) => turn.index);
  const unresolved = all.filter(
    (index) => !required.has(index) && !removable.has(index),
  );

  return {
    trajectoryId: args.trajectory.id,
    originalTurnCount: args.trajectory.turns.length,
    requiredTurnIndexes: [...required].sort((a, b) => a - b),
    removableTurnIndexes: [...removable].sort((a, b) => a - b),
    unresolvedTurnIndexes: unresolved,
  };
}

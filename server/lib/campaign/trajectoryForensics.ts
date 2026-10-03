import type {
  BoundaryReviewState,
  ConversationTrajectory,
  TrajectoryTurnRef,
} from "./types.js";

export type ForensicsReplayInput = {
  trajectoryId: string;
  evaluationTurnIndex: number;
  retainedTurnIndexes: number[];
  protectedTurnIndexes: number[];
  turns: Array<Pick<TrajectoryTurnRef, "index" | "role" | "content">>;
  reason:
    | "baseline"
    | "minimization"
    | "replication"
    | "perturbation"
    | "generalization";
  label: string;
};

export type ForensicsReplayResult = {
  reproduced: boolean;
  boundaryState: BoundaryReviewState;
  confidence?: number;
  notes?: string;
  responseHash?: string;
};

export type ForensicsReplayExecutor = (
  input: ForensicsReplayInput,
) => Promise<ForensicsReplayResult>;

export type ForensicsMinimizationStep = {
  removedTurnIndexes: number[];
  retainedTurnIndexes: number[];
  reproduced: boolean;
  boundaryState: BoundaryReviewState;
  confidence?: number;
  notes?: string;
};

export type ForensicsReplicationSummary = {
  attempts: number;
  reproduced: number;
  rate: number;
  results: ForensicsReplayResult[];
};

export type TrajectoryForensicsReport = {
  schemaVersion: "1.0";
  trajectoryId: string;
  evaluationTurnIndex: number;
  protectedTurnIndexes: number[];
  originalInputTurnIndexes: number[];
  minimizedTurnIndexes: number[];
  removedTurnIndexes: number[];
  baseline: ForensicsReplayResult;
  minimizationSteps: ForensicsMinimizationStep[];
  replication?: ForensicsReplicationSummary;
  /** Atomic history groups used during minimization, when supplied. */
  removalGroups?: number[][];
  generatedAt: string;
};

const STATE_RANK: Record<BoundaryReviewState, number> = {
  safe: 0,
  boundary_approaching: 1,
  probable_crossing: 2,
  expert_review_required: 3,
  confirmed_crossing: 4,
};

function ensureReplayable(
  trajectory: ConversationTrajectory,
  indexes: number[],
): Array<Pick<TrajectoryTurnRef, "index" | "role" | "content">> {
  return indexes.map((index) => {
    const turn = trajectory.turns[index];
    if (!turn) throw new Error(`Trajectory turn ${index} does not exist.`);
    if (turn.content === undefined) {
      throw new Error(
        "Trajectory text is unavailable. Re-capture with includeSensitiveText=true in a controlled research workspace before replay.",
      );
    }
    return { index: turn.index, role: turn.role, content: turn.content };
  });
}

export function detectEvaluationTurn(args: {
  trajectory: ConversationTrajectory;
  minimumState?: BoundaryReviewState;
}): number | undefined {
  const minimumState = args.minimumState ?? "probable_crossing";
  return [...args.trajectory.observations]
    .sort((a, b) => a.turnIndex - b.turnIndex)
    .find((item) => STATE_RANK[item.state] >= STATE_RANK[minimumState])
    ?.turnIndex;
}

export function defaultProtectedTurnIndexes(
  trajectory: ConversationTrajectory,
  evaluationTurnIndex: number,
): number[] {
  const protectedIndexes = new Set<number>();

  const lastUser = [...trajectory.turns]
    .slice(0, evaluationTurnIndex)
    .reverse()
    .find((turn) => turn.role === "user");
  if (lastUser) protectedIndexes.add(lastUser.index);

  for (const turn of trajectory.turns.slice(0, evaluationTurnIndex)) {
    if (turn.role === "system") protectedIndexes.add(turn.index);
  }

  return [...protectedIndexes].sort((a, b) => a - b);
}

/**
 * Build atomic user-exchange groups for conversational replay. Each user turn
 * is grouped with the assistant/tool turns that follow it until the next user
 * or system turn. Removing an exchange as a unit avoids producing malformed
 * histories with orphaned assistant replies during live-provider dogfooding.
 */
export function buildConversationExchangeRemovalGroups(
  trajectory: ConversationTrajectory,
  evaluationTurnIndex: number,
): number[][] {
  const groups: number[][] = [];
  const inputTurns = trajectory.turns.filter(
    (turn) => turn.index < evaluationTurnIndex,
  );

  for (let cursor = 0; cursor < inputTurns.length; cursor += 1) {
    const turn = inputTurns[cursor];
    if (turn.role === "system") continue;

    if (turn.role !== "user") {
      groups.push([turn.index]);
      continue;
    }

    const group = [turn.index];
    let follower = cursor + 1;
    while (follower < inputTurns.length) {
      const next = inputTurns[follower];
      if (next.role === "user" || next.role === "system") break;
      group.push(next.index);
      follower += 1;
    }
    groups.push(group);
    cursor = follower - 1;
  }

  return groups;
}

function buildRemovalUnits(args: {
  originalInputTurnIndexes: number[];
  protectedTurnIndexes: number[];
  removalGroups?: number[][];
}): number[][] {
  const original = new Set(args.originalInputTurnIndexes);
  const protectedSet = new Set(args.protectedTurnIndexes);

  if (!args.removalGroups) {
    return args.originalInputTurnIndexes
      .filter((index) => !protectedSet.has(index))
      .map((index) => [index]);
  }

  const assigned = new Set<number>();
  const units: number[][] = [];

  for (const suppliedGroup of args.removalGroups) {
    const group = [...new Set(suppliedGroup)].sort((a, b) => a - b);
    if (group.length === 0) continue;

    for (const index of group) {
      if (!original.has(index)) {
        throw new Error(
          `Removal group contains turn ${index}, which is not replayable input history.`,
        );
      }
      if (assigned.has(index)) {
        throw new Error(
          `Removal groups overlap at turn ${index}; groups must be disjoint.`,
        );
      }
      assigned.add(index);
    }

    if (!group.some((index) => protectedSet.has(index))) {
      units.push(group);
    }
  }

  for (const index of args.originalInputTurnIndexes) {
    if (!assigned.has(index) && !protectedSet.has(index)) units.push([index]);
  }

  return units;
}

function partition<T>(items: T[], count: number): T[][] {
  if (items.length === 0) return [];
  const chunkSize = Math.ceil(items.length / count);
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function runReplay(args: {
  trajectory: ConversationTrajectory;
  executor: ForensicsReplayExecutor;
  evaluationTurnIndex: number;
  retainedTurnIndexes: number[];
  protectedTurnIndexes: number[];
  reason: ForensicsReplayInput["reason"];
  label: string;
}): Promise<ForensicsReplayResult> {
  return args.executor({
    trajectoryId: args.trajectory.id,
    evaluationTurnIndex: args.evaluationTurnIndex,
    retainedTurnIndexes: [...args.retainedTurnIndexes],
    protectedTurnIndexes: [...args.protectedTurnIndexes],
    turns: ensureReplayable(args.trajectory, args.retainedTurnIndexes),
    reason: args.reason,
    label: args.label,
  });
}

/**
 * Delta-debug a recorded conversation while preserving the target-defining
 * turns. The executor decides whether the behavior of interest reproduced.
 *
 * This engine is intentionally provider-neutral: FIL controls the experiment,
 * while a provider adapter controls execution and scoring.
 */
export async function minimizeConversationTrajectory(args: {
  trajectory: ConversationTrajectory;
  executor: ForensicsReplayExecutor;
  evaluationTurnIndex?: number;
  protectedTurnIndexes?: number[];
  removalGroups?: number[][];
  replicationAttempts?: number;
  now?: string;
}): Promise<TrajectoryForensicsReport> {
  const evaluationTurnIndex =
    args.evaluationTurnIndex ??
    detectEvaluationTurn({ trajectory: args.trajectory });

  if (evaluationTurnIndex === undefined) {
    throw new Error(
      "No evaluation turn was supplied and no qualifying boundary observation was found.",
    );
  }
  if (
    evaluationTurnIndex < 0 ||
    evaluationTurnIndex >= args.trajectory.turns.length
  ) {
    throw new Error("Evaluation turn must exist in the trajectory.");
  }

  const originalInputTurnIndexes = args.trajectory.turns
    .filter((turn) => turn.index < evaluationTurnIndex)
    .map((turn) => turn.index);

  const protectedTurnIndexes = [
    ...new Set(
      args.protectedTurnIndexes ??
        defaultProtectedTurnIndexes(args.trajectory, evaluationTurnIndex),
    ),
  ].sort((a, b) => a - b);

  for (const index of protectedTurnIndexes) {
    if (!originalInputTurnIndexes.includes(index)) {
      throw new Error(
        `Protected turn ${index} is not part of the replayable input history.`,
      );
    }
  }

  const removalUnits = buildRemovalUnits({
    originalInputTurnIndexes,
    protectedTurnIndexes,
    removalGroups: args.removalGroups,
  });

  let retained = [...originalInputTurnIndexes];
  const baseline = await runReplay({
    trajectory: args.trajectory,
    executor: args.executor,
    evaluationTurnIndex,
    retainedTurnIndexes: retained,
    protectedTurnIndexes,
    reason: "baseline",
    label: "Full recorded history",
  });

  if (!baseline.reproduced) {
    return {
      schemaVersion: "1.0",
      trajectoryId: args.trajectory.id,
      evaluationTurnIndex,
      protectedTurnIndexes,
      originalInputTurnIndexes,
      minimizedTurnIndexes: retained,
      removedTurnIndexes: [],
      baseline,
      minimizationSteps: [],
      ...(args.removalGroups
        ? { removalGroups: args.removalGroups.map((group) => [...group]) }
        : {}),
      generatedAt: args.now ?? new Date().toISOString(),
    };
  }

  const steps: ForensicsMinimizationStep[] = [];
  let granularity = 2;

  while (true) {
    const removableUnits = removalUnits.filter((unit) =>
      unit.every((index) => retained.includes(index)),
    );
    if (removableUnits.length === 0) break;

    const chunks = partition(
      removableUnits,
      Math.min(granularity, removableUnits.length),
    );
    let changed = false;

    for (const chunkUnits of chunks) {
      const chunk = chunkUnits.flat();
      const proposed = retained.filter((index) => !chunk.includes(index));
      const result = await runReplay({
        trajectory: args.trajectory,
        executor: args.executor,
        evaluationTurnIndex,
        retainedTurnIndexes: proposed,
        protectedTurnIndexes,
        reason: "minimization",
        label: `Remove source turns ${chunk.join(", ")}`,
      });

      steps.push({
        removedTurnIndexes: [...chunk],
        retainedTurnIndexes: [...proposed],
        reproduced: result.reproduced,
        boundaryState: result.boundaryState,
        confidence: result.confidence,
        notes: result.notes,
      });

      if (result.reproduced) {
        retained = proposed;
        changed = true;
        granularity = Math.max(2, granularity - 1);
        break;
      }
    }

    if (changed) continue;
    if (granularity >= removableUnits.length) break;
    granularity = Math.min(removableUnits.length, granularity * 2);
  }

  // Final atomic-unit pass ensures the fixed point is 1-minimal with respect
  // to the configured removal units and the executor's reproduction predicate.
  for (const unit of removalUnits) {
    if (!unit.every((index) => retained.includes(index))) continue;
    const proposed = retained.filter((item) => !unit.includes(item));
    const result = await runReplay({
      trajectory: args.trajectory,
      executor: args.executor,
      evaluationTurnIndex,
      retainedTurnIndexes: proposed,
      protectedTurnIndexes,
      reason: "minimization",
      label: `Remove source turns ${unit.join(", ")}`,
    });
    steps.push({
      removedTurnIndexes: [...unit],
      retainedTurnIndexes: [...proposed],
      reproduced: result.reproduced,
      boundaryState: result.boundaryState,
      confidence: result.confidence,
      notes: result.notes,
    });
    if (result.reproduced) retained = proposed;
  }

  let replication: ForensicsReplicationSummary | undefined;
  const replicationAttempts = Math.max(0, args.replicationAttempts ?? 0);
  if (replicationAttempts > 0) {
    const results: ForensicsReplayResult[] = [];
    for (let attempt = 0; attempt < replicationAttempts; attempt += 1) {
      results.push(
        await runReplay({
          trajectory: args.trajectory,
          executor: args.executor,
          evaluationTurnIndex,
          retainedTurnIndexes: retained,
          protectedTurnIndexes,
          reason: "replication",
          label: `Fresh replication ${attempt + 1}`,
        }),
      );
    }
    const reproduced = results.filter((item) => item.reproduced).length;
    replication = {
      attempts: replicationAttempts,
      reproduced,
      rate: reproduced / replicationAttempts,
      results,
    };
  }

  return {
    schemaVersion: "1.0",
    trajectoryId: args.trajectory.id,
    evaluationTurnIndex,
    protectedTurnIndexes,
    originalInputTurnIndexes,
    minimizedTurnIndexes: [...retained],
    removedTurnIndexes: originalInputTurnIndexes.filter(
      (index) => !retained.includes(index),
    ),
    baseline,
    minimizationSteps: steps,
    replication,
    ...(args.removalGroups
      ? { removalGroups: args.removalGroups.map((group) => [...group]) }
      : {}),
    generatedAt: args.now ?? new Date().toISOString(),
  };
}

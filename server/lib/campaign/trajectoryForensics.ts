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
      generatedAt: args.now ?? new Date().toISOString(),
    };
  }

  const steps: ForensicsMinimizationStep[] = [];
  let granularity = 2;

  while (true) {
    const removable = retained.filter(
      (index) => !protectedTurnIndexes.includes(index),
    );
    if (removable.length === 0) break;

    const chunks = partition(removable, Math.min(granularity, removable.length));
    let changed = false;

    for (const chunk of chunks) {
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
    if (granularity >= removable.length) break;
    granularity = Math.min(removable.length, granularity * 2);
  }

  // Final singleton pass ensures the fixed point is 1-minimal with respect
  // to the executor's reproduction predicate.
  for (const index of [...retained]) {
    if (protectedTurnIndexes.includes(index)) continue;
    const proposed = retained.filter((item) => item !== index);
    const result = await runReplay({
      trajectory: args.trajectory,
      executor: args.executor,
      evaluationTurnIndex,
      retainedTurnIndexes: proposed,
      protectedTurnIndexes,
      reason: "minimization",
      label: `Remove source turn ${index}`,
    });
    steps.push({
      removedTurnIndexes: [index],
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
    generatedAt: args.now ?? new Date().toISOString(),
  };
}

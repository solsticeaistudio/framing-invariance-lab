import type {
  CompactionDiff,
  ContextArtifact,
  ConversationTrajectory,
} from "./types.js";

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKC")
      .match(/[a-z0-9_'-]+/g) ?? [],
  );
}

export function listCompactions(
  trajectory: ConversationTrajectory,
): ContextArtifact[] {
  return trajectory.contextArtifacts
    .filter((artifact) => artifact.kind === "compaction")
    .sort(
      (a, b) =>
        a.afterTurnIndex - b.afterTurnIndex ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

export function compareCompactions(
  left: ContextArtifact,
  right: ContextArtifact,
): CompactionDiff {
  if (left.kind !== "compaction" || right.kind !== "compaction") {
    throw new Error("compareCompactions requires two compaction artifacts.");
  }

  const textAvailable =
    typeof left.content === "string" && typeof right.content === "string";
  if (!textAvailable) {
    return {
      leftArtifactId: left.id,
      rightArtifactId: right.id,
      leftHash: left.contentHash,
      rightHash: right.contentHash,
      tokenJaccard: null,
      sharedTokens: [],
      leftOnlyTokens: [],
      rightOnlyTokens: [],
      textAvailable: false,
    };
  }

  const leftTokens = tokenize(left.content!);
  const rightTokens = tokenize(right.content!);
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).sort();
  const leftOnly = [...leftTokens]
    .filter((token) => !rightTokens.has(token))
    .sort();
  const rightOnly = [...rightTokens]
    .filter((token) => !leftTokens.has(token))
    .sort();
  const unionSize = new Set([...leftTokens, ...rightTokens]).size;

  return {
    leftArtifactId: left.id,
    rightArtifactId: right.id,
    leftHash: left.contentHash,
    rightHash: right.contentHash,
    tokenJaccard: unionSize === 0 ? 1 : shared.length / unionSize,
    sharedTokens: shared,
    leftOnlyTokens: leftOnly,
    rightOnlyTokens: rightOnly,
    textAvailable: true,
  };
}

export function nearestCompactionBeforeTurn(
  trajectory: ConversationTrajectory,
  turnIndex: number,
): ContextArtifact | undefined {
  return listCompactions(trajectory)
    .filter((artifact) => artifact.afterTurnIndex < turnIndex)
    .at(-1);
}

export function buildCompactionComparisonMatrix(
  trajectories: ConversationTrajectory[],
): Array<{
  leftTrajectoryId: string;
  rightTrajectoryId: string;
  leftArtifactId: string;
  rightArtifactId: string;
  diff: CompactionDiff;
}> {
  const latest = trajectories
    .map((trajectory) => ({
      trajectoryId: trajectory.id,
      artifact: listCompactions(trajectory).at(-1),
    }))
    .filter(
      (
        item,
      ): item is { trajectoryId: string; artifact: ContextArtifact } =>
        Boolean(item.artifact),
    );

  const rows: Array<{
    leftTrajectoryId: string;
    rightTrajectoryId: string;
    leftArtifactId: string;
    rightArtifactId: string;
    diff: CompactionDiff;
  }> = [];

  for (let i = 0; i < latest.length; i += 1) {
    for (let j = i + 1; j < latest.length; j += 1) {
      const left = latest[i];
      const right = latest[j];
      rows.push({
        leftTrajectoryId: left.trajectoryId,
        rightTrajectoryId: right.trajectoryId,
        leftArtifactId: left.artifact.id,
        rightArtifactId: right.artifact.id,
        diff: compareCompactions(left.artifact, right.artifact),
      });
    }
  }
  return rows;
}

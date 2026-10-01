import { canonicalSha256 } from "../canonicalJson.js";
import type {
  BoundaryObservation,
  ContextArtifact,
  ContextArtifactKind,
  ConversationTrajectory,
  TrajectoryTurnRole,
} from "./types.js";

function recomputeTrajectoryHash(
  trajectory: Omit<ConversationTrajectory, "trajectoryHash">,
): string {
  return canonicalSha256({
    schemaVersion: trajectory.schemaVersion,
    id: trajectory.id,
    candidateId: trajectory.candidateId,
    label: trajectory.label,
    createdAt: trajectory.createdAt,
    updatedAt: trajectory.updatedAt,
    turns: trajectory.turns.map((turn) => ({
      index: turn.index,
      role: turn.role,
      contentHash: turn.contentHash,
      turnHash: turn.turnHash,
      previousTurnHash: turn.previousTurnHash,
      createdAt: turn.createdAt,
      model: turn.model,
      providerRequestId: turn.providerRequestId,
      stopReason: turn.stopReason,
    })),
    contextArtifacts: trajectory.contextArtifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      afterTurnIndex: artifact.afterTurnIndex,
      contentHash: artifact.contentHash,
      createdAt: artifact.createdAt,
      provider: artifact.provider,
      model: artifact.model,
      sourceStartTurn: artifact.sourceStartTurn,
      sourceEndTurn: artifact.sourceEndTurn,
      metadata: artifact.metadata,
    })),
    observations: trajectory.observations,
    sensitiveTextIncluded: trajectory.sensitiveTextIncluded,
  });
}

function finalize(
  trajectory: Omit<ConversationTrajectory, "trajectoryHash">,
): ConversationTrajectory {
  return { ...trajectory, trajectoryHash: recomputeTrajectoryHash(trajectory) };
}

export function createConversationTrajectory(args: {
  id: string;
  candidateId: string;
  label: string;
  includeSensitiveText?: boolean;
  now?: string;
}): ConversationTrajectory {
  const now = args.now ?? new Date().toISOString();
  return finalize({
    schemaVersion: "1.0",
    id: args.id,
    candidateId: args.candidateId,
    label: args.label,
    createdAt: now,
    updatedAt: now,
    turns: [],
    contextArtifacts: [],
    observations: [],
    sensitiveTextIncluded: Boolean(args.includeSensitiveText),
  });
}

export function appendTrajectoryTurn(
  trajectory: ConversationTrajectory,
  args: {
    role: TrajectoryTurnRole;
    content: string;
    createdAt?: string;
    model?: string;
    providerRequestId?: string;
    stopReason?: string | null;
  },
): ConversationTrajectory {
  const index = trajectory.turns.length;
  const previousTurnHash = trajectory.turns.at(-1)?.turnHash;
  const contentHash = canonicalSha256({ content: args.content });
  const createdAt = args.createdAt ?? new Date().toISOString();
  const turnHash = canonicalSha256({
    trajectoryId: trajectory.id,
    index,
    role: args.role,
    contentHash,
    previousTurnHash,
    createdAt,
    model: args.model,
    providerRequestId: args.providerRequestId,
    stopReason: args.stopReason,
  });

  return finalize({
    ...trajectory,
    updatedAt: createdAt,
    turns: [
      ...trajectory.turns,
      {
        index,
        role: args.role,
        contentHash,
        turnHash,
        previousTurnHash,
        createdAt,
        model: args.model,
        providerRequestId: args.providerRequestId,
        stopReason: args.stopReason,
        ...(trajectory.sensitiveTextIncluded ? { content: args.content } : {}),
      },
    ],
  });
}

export function recordContextArtifact(
  trajectory: ConversationTrajectory,
  args: {
    id: string;
    kind: ContextArtifactKind;
    afterTurnIndex: number;
    content: string;
    createdAt?: string;
    provider?: string;
    model?: string;
    sourceStartTurn?: number;
    sourceEndTurn?: number;
    metadata?: ContextArtifact["metadata"];
  },
): ConversationTrajectory {
  if (args.afterTurnIndex < -1 || args.afterTurnIndex >= trajectory.turns.length) {
    throw new Error("Context artifact must point to an existing turn or -1.");
  }
  const createdAt = args.createdAt ?? new Date().toISOString();
  const artifact: ContextArtifact = {
    id: args.id,
    kind: args.kind,
    afterTurnIndex: args.afterTurnIndex,
    contentHash: canonicalSha256({ content: args.content }),
    createdAt,
    provider: args.provider,
    model: args.model,
    sourceStartTurn: args.sourceStartTurn,
    sourceEndTurn: args.sourceEndTurn,
    metadata: args.metadata,
    ...(trajectory.sensitiveTextIncluded ? { content: args.content } : {}),
  };
  return finalize({
    ...trajectory,
    updatedAt: createdAt,
    contextArtifacts: [...trajectory.contextArtifacts, artifact],
  });
}

export function recordBoundaryObservation(
  trajectory: ConversationTrajectory,
  observation: BoundaryObservation,
  now?: string,
): ConversationTrajectory {
  if (observation.turnIndex < 0 || observation.turnIndex >= trajectory.turns.length) {
    throw new Error("Boundary observation must point to an existing turn.");
  }
  if (observation.confidence < 0 || observation.confidence > 1) {
    throw new Error("Boundary observation confidence must be between 0 and 1.");
  }
  return finalize({
    ...trajectory,
    updatedAt: now ?? new Date().toISOString(),
    observations: [...trajectory.observations, observation],
  });
}

export function verifyTrajectoryIntegrity(
  trajectory: ConversationTrajectory,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  let previousTurnHash: string | undefined;

  for (let index = 0; index < trajectory.turns.length; index += 1) {
    const turn = trajectory.turns[index];
    if (turn.index !== index) errors.push(`turn ${index}: non-contiguous index`);
    if (turn.previousTurnHash !== previousTurnHash) {
      errors.push(`turn ${index}: previous hash mismatch`);
    }
    if (turn.content !== undefined) {
      const expectedContentHash = canonicalSha256({ content: turn.content });
      if (expectedContentHash !== turn.contentHash) {
        errors.push(`turn ${index}: content hash mismatch`);
      }
    }
    const expectedTurnHash = canonicalSha256({
      trajectoryId: trajectory.id,
      index: turn.index,
      role: turn.role,
      contentHash: turn.contentHash,
      previousTurnHash: turn.previousTurnHash,
      createdAt: turn.createdAt,
      model: turn.model,
      providerRequestId: turn.providerRequestId,
      stopReason: turn.stopReason,
    });
    if (expectedTurnHash !== turn.turnHash) {
      errors.push(`turn ${index}: turn hash mismatch`);
    }
    previousTurnHash = turn.turnHash;
  }

  for (const artifact of trajectory.contextArtifacts) {
    if (artifact.content !== undefined) {
      const expected = canonicalSha256({ content: artifact.content });
      if (expected !== artifact.contentHash) {
        errors.push(`artifact ${artifact.id}: content hash mismatch`);
      }
    }
  }

  const { trajectoryHash: _ignored, ...withoutHash } = trajectory;
  const expectedTrajectoryHash = recomputeTrajectoryHash(withoutHash);
  if (expectedTrajectoryHash !== trajectory.trajectoryHash) {
    errors.push("trajectory hash mismatch");
  }

  return { valid: errors.length === 0, errors };
}

export function serializeTrajectoryJsonl(
  trajectory: ConversationTrajectory,
): string {
  const records = [
    {
      type: "trajectory",
      schemaVersion: trajectory.schemaVersion,
      id: trajectory.id,
      candidateId: trajectory.candidateId,
      label: trajectory.label,
      createdAt: trajectory.createdAt,
      sensitiveTextIncluded: trajectory.sensitiveTextIncluded,
    },
    ...trajectory.turns.map((turn) => ({ type: "turn", ...turn })),
    ...trajectory.contextArtifacts.map((artifact) => ({
      type: "context_artifact",
      ...artifact,
    })),
    ...trajectory.observations.map((observation) => ({
      type: "boundary_observation",
      ...observation,
    })),
    {
      type: "seal",
      updatedAt: trajectory.updatedAt,
      trajectoryHash: trajectory.trajectoryHash,
    },
  ];
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

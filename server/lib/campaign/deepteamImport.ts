import { createHash } from "node:crypto";
import { z } from "zod";
import {
  appendTrajectoryTurn,
  createConversationTrajectory,
  verifyTrajectoryIntegrity,
} from "./trajectoryRecorder.js";
import type { ConversationTrajectory, TrajectoryTurnRole } from "./types.js";

const turnSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().max(200_000),
}).passthrough();

const testCaseSchema = z.object({
  input: z.string().max(200_000).nullable().optional(),
  actual_output: z.string().max(200_000).nullable().optional(),
  turns: z.array(turnSchema).max(100).nullable().optional(),
  score: z.number().finite().min(0).max(1).nullable().optional(),
  error: z.string().max(20_000).nullable().optional(),
  attack_method: z.string().max(200).nullable().optional(),
  vulnerability: z.string().max(200).optional(),
  vulnerability_type: z.string().max(200).nullable().optional(),
}).passthrough();

/** Accepts native RiskAssessment.save() output, not unvalidated FIL runs. */
export const deepTeamAssessmentSchema = z.object({
  overview: z.object({}).passthrough(),
  test_cases: z.array(testCaseSchema).min(1).max(1000),
}).passthrough();

export type DeepTeamImportOutcome = "passed" | "failed" | "errored" | "unscored";

export type DeepTeamImportedCase = {
  index: number;
  id: string;
  trajectory: ConversationTrajectory;
  verdict: DeepTeamImportOutcome;
  /** As reported by DeepTeam; not an independent FIL judgment. */
  reportedScore?: number;
  methodHash?: string;
  turnCount: number;
};

export type DeepTeamImportSummary = {
  schemaVersion: "fil-deepteam-import-v1";
  trustLevel: "external_unverified";
  scientificTier: "none";
  source: {
    format: "deepteam-risk-assessment-json";
    sourceSha256: string;
    importedAt: string;
    caseCount: number;
  };
  counts: Record<DeepTeamImportOutcome, number>;
  cases: Array<{
    index: number;
    id: string;
    trajectoryHash: string;
    turnCount: number;
    verdict: DeepTeamImportOutcome;
    reportedScore?: number;
    methodHash?: string;
  }>;
  limitations: string[];
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function importDeepTeamAssessment(args: {
  /** Parsed RiskAssessment.save() object (contents never persisted). */
  payload: unknown;
  /** SHA-256 of the exact source file bytes, computed by the offline CLI. */
  sourceSha256: string;
  importedAt?: string;
}): { summary: DeepTeamImportSummary; cases: DeepTeamImportedCase[] } {
  const parsed = deepTeamAssessmentSchema.parse(args.payload);
  if (!/^[a-f0-9]{64}$/.test(args.sourceSha256)) {
    throw new Error("Invalid source SHA-256.");
  }
  const importedAt = args.importedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(importedAt))) {
    throw new Error("Invalid import timestamp.");
  }

  const cases: DeepTeamImportedCase[] = parsed.test_cases.map((item, index) => {
    const turns: Array<{ role: TrajectoryTurnRole; content: string }> =
      item.turns && item.turns.length > 0
        ? item.turns.map(({ role, content }) => ({ role, content }))
        : [
            ...(item.input !== null && item.input !== undefined
              ? [{ role: "user" as const, content: item.input }]
              : []),
            ...(item.actual_output !== null && item.actual_output !== undefined
              ? [{ role: "assistant" as const, content: item.actual_output }]
              : []),
          ];

    if (turns.length === 0) {
      throw new Error(
        "DeepTeam test case " + index + " has no usable transcript or input/output.",
      );
    }

    const id = "deepteam-" + sha256(
      args.sourceSha256 + "|case|" + index,
    ).slice(0, 24);
    let trajectory = createConversationTrajectory({
      id,
      candidateId: id,
      label: "Imported DeepTeam case " + (index + 1),
      includeSensitiveText: false,
      now: importedAt,
    });
    for (const turn of turns) {
      trajectory = appendTrajectoryTurn(trajectory, {
        role: turn.role,
        content: turn.content,
        createdAt: importedAt,
      });
    }
    const integrity = verifyTrajectoryIntegrity(trajectory);
    if (!integrity.valid) {
      throw new Error(
        "Invalid imported trajectory for case " + index + ": " +
        integrity.errors.join("; "),
      );
    }

    const verdict: DeepTeamImportOutcome =
      item.error && item.error.trim()
        ? "errored"
        : item.score === undefined || item.score === null
          ? "unscored"
          : item.score > 0
            ? "passed"
            : "failed";

    return {
      index,
      id,
      trajectory,
      verdict,
      ...(item.score === undefined || item.score === null
        ? {}
        : { reportedScore: item.score }),
      ...(item.attack_method
        ? { methodHash: sha256(item.attack_method) }
        : {}),
      turnCount: turns.length,
    };
  });

  const counts: Record<DeepTeamImportOutcome, number> = {
    passed: 0,
    failed: 0,
    errored: 0,
    unscored: 0,
  };
  for (const item of cases) counts[item.verdict] += 1;

  return {
    summary: {
      schemaVersion: "fil-deepteam-import-v1",
      trustLevel: "external_unverified",
      scientificTier: "none",
      source: {
        format: "deepteam-risk-assessment-json",
        sourceSha256: args.sourceSha256,
        importedAt,
        caseCount: cases.length,
      },
      counts,
      cases: cases.map((item) => ({
        index: item.index,
        id: item.id,
        trajectoryHash: item.trajectory.trajectoryHash,
        turnCount: item.turnCount,
        verdict: item.verdict,
        ...(item.reportedScore === undefined
          ? {}
          : { reportedScore: item.reportedScore }),
        ...(item.methodHash === undefined
          ? {}
          : { methodHash: item.methodHash }),
      })),
      limitations: [
        "DeepTeam scores are source-reported, not independently assessed by FIL.",
        "No external run is enrolled in signed FIL study tiers.",
        "Hash-only trajectories intentionally omit raw prompts, responses, and tool content.",
        "The imported timestamp represents receipt, not the original conversation chronology.",
        "A hash chain demonstrates internal consistency, not the truth of source claims.",
      ],
    },
    cases,
  };
}

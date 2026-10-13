import { describe, expect, it } from "vitest";
import {
  deepTeamAssessmentSchema,
  importDeepTeamAssessment,
} from "./deepteamImport.js";
import { verifyTrajectoryIntegrity } from "./trajectoryRecorder.js";

const sourceSha256 = "a".repeat(64);
const importedAt = "2026-10-12T00:00:00.000Z";
const fixture = {
  overview: {
    errored: 1,
    run_duration: 5.2,
    attack_method_results: [],
    vulnerability_type_results: [],
  },
  test_cases: [
    {
      vulnerability: "Harmless fictional policy game",
      vulnerability_type: "mocked",
      attack_method: "Synthetic format change",
      input: "HIDDEN_SOURCE_INPUT_ALPHA",
      turns: [
        { role: "user", content: "HIDDEN_SOURCE_USER_ALPHA" },
        { role: "assistant", content: "HIDDEN_SOURCE_OUTPUT_ALPHA" },
      ],
      score: 0,
      reason: "HIDDEN_JUDGE_REASON",
      metadata: { private_marker: "HIDDEN_METADATA_MARKER" },
    },
    {
      vulnerability: "Harmless fictional policy game",
      input: "HIDDEN_SOURCE_INPUT_BETA",
      actual_output: "HIDDEN_SOURCE_OUTPUT_BETA",
      score: 1,
    },
    {
      vulnerability: "Harmless fictional policy game",
      input: "HIDDEN_SOURCE_INPUT_GAMMA",
      error: "HIDDEN_PROVIDER_ERROR",
      score: 1,
    },
  ],
};

describe("DeepTeam assessment bridge", () => {
  it("converts saved assessment test cases to valid hash-only FIL trajectories", () => {
    const { cases, summary } = importDeepTeamAssessment({
      payload: fixture,
      sourceSha256,
      importedAt,
    });
    expect(cases).toHaveLength(3);
    expect(summary.trustLevel).toBe("external_unverified");
    expect(summary.scientificTier).toBe("none");
    expect(summary.counts).toEqual({
      passed: 1,
      failed: 1,
      errored: 1,
      unscored: 0,
    });
    expect(cases[0].turnCount).toBe(2);
    expect(cases[1].turnCount).toBe(2);
    for (const entry of cases) {
      expect(entry.trajectory.sensitiveTextIncluded).toBe(false);
      expect(verifyTrajectoryIntegrity(entry.trajectory).valid).toBe(true);
      expect(entry.trajectory.turns.every((turn) => turn.content === undefined)).toBe(true);
    }
    const serialized = JSON.stringify({ cases, summary });
    for (const marker of [
      "HIDDEN_SOURCE_INPUT",
      "HIDDEN_SOURCE_USER",
      "HIDDEN_SOURCE_OUTPUT",
      "HIDDEN_JUDGE_REASON",
      "HIDDEN_METADATA_MARKER",
      "HIDDEN_PROVIDER_ERROR",
    ]) expect(serialized).not.toContain(marker);
    expect(summary.cases[0].trajectoryHash).toBe(cases[0].trajectory.trajectoryHash);
  });

  it("produces the same hashes for identical files and explicit timestamps", () => {
    const first = importDeepTeamAssessment({ payload: fixture, sourceSha256, importedAt });
    const second = importDeepTeamAssessment({ payload: fixture, sourceSha256, importedAt });
    expect(first.summary).toEqual(second.summary);
    expect(first.cases[0].trajectory).toEqual(second.cases[0].trajectory);
  });

  it("rejects fake source digests, malformed scores and role injection", () => {
    expect(() => importDeepTeamAssessment({
      payload: fixture, sourceSha256: "not-a-digest", importedAt,
    })).toThrow("SHA-256");
    expect(deepTeamAssessmentSchema.safeParse({
      ...fixture,
      test_cases: [{ input: "hi", score: 12 }],
    }).success).toBe(false);
    expect(deepTeamAssessmentSchema.safeParse({
      ...fixture,
      test_cases: [{ turns: [{ role: "root", content: "unexpected" }] }],
    }).success).toBe(false);
  });

  it("fails closed for test cases without an input, output, or transcript", () => {
    expect(() => importDeepTeamAssessment({
      payload: { overview: {}, test_cases: [{ score: 0 }] },
      sourceSha256,
      importedAt,
    })).toThrow("no usable transcript");
  });

  it("does not imply DeepTeam scoring establishes a FIL safety violation", () => {
    const result = importDeepTeamAssessment({
      payload: fixture,
      sourceSha256,
      importedAt,
    });
    expect(result.summary.limitations).toEqual(
      expect.arrayContaining([
        "DeepTeam scores are source-reported, not independently assessed by FIL.",
        "No external run is enrolled in signed FIL study tiers.",
      ]),
    );
  });
});

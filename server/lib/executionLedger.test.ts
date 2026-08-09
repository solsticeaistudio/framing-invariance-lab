import { describe, expect, it } from "vitest";
import type {
  PlannedTrialCommitment,
  TrialExecutionRecord,
} from "../v2/types.js";
import { reconcileExecutionLedger } from "./executionLedger.js";

const planned: PlannedTrialCommitment[] = [
  {
    trialId: "t1",
    scenarioId: "s",
    replicationIdentity: "r",
    claimKey: "c",
    variantId: "v",
    variantFingerprint: "v",
    promptCommitmentHash: "p",
    repetitionIndex: 0,
  },
  {
    trialId: "t2",
    scenarioId: "s",
    replicationIdentity: "r",
    claimKey: "c",
    variantId: "v",
    variantFingerprint: "v",
    promptCommitmentHash: "p",
    repetitionIndex: 1,
  },
];
const record = (
  trialId: string,
  status: TrialExecutionRecord["status"] = "completed",
  errorCode?: TrialExecutionRecord["errorCode"],
): TrialExecutionRecord => ({
  trialId,
  scenarioId: "s",
  replicationIdentity: "r",
  claimKey: "c",
  variantId: "v",
  variantFingerprint: "v",
  promptCommitmentHash: "p",
  repetitionIndex: trialId === "t1" ? 0 : 1,
  status,
  ...(status === "completed"
    ? { responseHash: "h", primaryAssessmentHash: "a" }
    : {
        errorCode:
          errorCode ??
          (status === "failed"
            ? "target_provider_error"
            : "run_aborted_after_recorded_failure"),
      }),
});

describe("execution ledger reconciliation", () => {
  it("accepts an exact completed schedule", () => {
    const result = reconcileExecutionLedger(planned, [
      record("t1"),
      record("t2"),
    ]);
    expect(result.valid).toBe(true);
    expect(result.attemptedTrialCount).toBe(2);
  });
  it("fails closed for missing, extra, duplicate, or mismatched records", () => {
    const result = reconcileExecutionLedger(planned, [
      record("t1"),
      record("t1"),
      record("extra"),
    ]);
    expect(result.valid).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "planned_trial_missing",
        "unplanned_trial_present",
        "duplicate_trial_execution",
      ]),
    );
  });
  it("counts authorized failure and skip states", () => {
    const result = reconcileExecutionLedger(
      planned,
      [record("t1", "failed"), record("t2", "skipped")],
      { failurePolicy: "fail_run_immediately" },
    );
    expect(result.valid).toBe(true);
    expect(result.failedTrialCount).toBe(1);
    expect(result.skippedTrialCount).toBe(1);
    expect(result.attemptedTrialCount).toBe(1);
  });

  it("never converts a missing trial or post-hoc skip into valid evidence", () => {
    const missing = reconcileExecutionLedger(planned, [record("t1")], {
      failurePolicy: "record_and_continue",
    });
    expect(missing.blockers).toContain("planned_trial_missing");
    const posthoc = reconcileExecutionLedger(
      planned,
      [
        record("t1"),
        record("t2", "skipped", "run_aborted_after_recorded_failure"),
      ],
      { failurePolicy: "fail_run_immediately" },
    );
    expect(posthoc.blockers).toContain("posthoc_skip_reason");
    const unauthorized = reconcileExecutionLedger(
      planned,
      [record("t1"), record("t2", "skipped", "run_missing_trial" as never)],
      { failurePolicy: "record_and_continue" },
    );
    expect(unauthorized.blockers).toContain("unauthorized_trial_skip");
  });
});

import { canonicalSha256 } from "./canonicalJson.js";
import type {
  AuthorizedSkipReason,
  PlannedTrialCommitment,
  TrialFailurePolicy,
  TrialExecutionRecord,
} from "../v2/types.js";

export type ExecutionReconciliation = {
  valid: boolean;
  plannedTrialCount: number;
  completedTrialCount: number;
  failedTrialCount: number;
  skippedTrialCount: number;
  attemptedTrialCount: number;
  missingTrialIds: string[];
  unexpectedTrialIds: string[];
  duplicateTrialIds: string[];
  fingerprintMismatches: string[];
  promptCommitmentMismatches: string[];
  identityMismatches: string[];
  blockers: string[];
};

export function executionLedgerHash(records: TrialExecutionRecord[]): string {
  return canonicalSha256(
    JSON.parse(JSON.stringify(records)) as TrialExecutionRecord[],
  );
}

export function reconcileExecutionLedger(
  plannedTrials: PlannedTrialCommitment[],
  records: TrialExecutionRecord[],
  options?: { failurePolicy: TrialFailurePolicy },
): ExecutionReconciliation {
  const planned = new Map(plannedTrials.map((trial) => [trial.trialId, trial]));
  const seen = new Map<string, number>();
  const missingTrialIds: string[] = [];
  const unexpectedTrialIds: string[] = [];
  const duplicateTrialIds: string[] = [];
  const fingerprintMismatches: string[] = [];
  const promptCommitmentMismatches: string[] = [];
  const identityMismatches: string[] = [];
  const blockers: string[] = [];
  for (const record of records) {
    seen.set(record.trialId, (seen.get(record.trialId) ?? 0) + 1);
    const expected = planned.get(record.trialId);
    if (!expected) {
      unexpectedTrialIds.push(record.trialId);
      continue;
    }
    if (seen.get(record.trialId)! > 1) duplicateTrialIds.push(record.trialId);
    if (record.variantFingerprint !== expected.variantFingerprint)
      fingerprintMismatches.push(record.trialId);
    if (
      expected.promptCommitmentHash &&
      record.promptCommitmentHash !== expected.promptCommitmentHash
    )
      promptCommitmentMismatches.push(record.trialId);
    if (
      (expected.scenarioId && record.scenarioId !== expected.scenarioId) ||
      (expected.replicationIdentity &&
        record.replicationIdentity !== expected.replicationIdentity) ||
      (expected.claimKey && record.claimKey !== expected.claimKey) ||
      (expected.variantId && record.variantId !== expected.variantId) ||
      record.repetitionIndex !== expected.repetitionIndex
    )
      identityMismatches.push(record.trialId);
    if (record.status === "completed") {
      if (!record.responseHash)
        blockers.push("completed_trial_missing_response_hash");
      if (!record.primaryAssessmentHash)
        blockers.push("completed_trial_missing_judge_result");
    }
    if (record.status === "failed" && !record.errorCode)
      blockers.push("failed_trial_missing_error_code");
    if (record.status === "skipped") {
      const authorized = new Set<AuthorizedSkipReason>([
        "run_cancelled",
        "predeclared_stopping_rule",
        "run_aborted_after_recorded_failure",
        "dependency_failure_declared_by_policy",
      ]);
      if (
        !record.errorCode ||
        !authorized.has(record.errorCode as AuthorizedSkipReason)
      )
        blockers.push("unauthorized_trial_skip");
      if (record.errorCode === "run_aborted_after_recorded_failure") {
        const failedBefore = records.some(
          (candidate) =>
            candidate.status === "failed" &&
            plannedTrials.findIndex(
              (item) => item.trialId === candidate.trialId,
            ) <
              plannedTrials.findIndex(
                (item) => item.trialId === record.trialId,
              ),
        );
        if (!failedBefore) blockers.push("posthoc_skip_reason");
      }
      if (
        record.errorCode === "predeclared_stopping_rule" &&
        options?.failurePolicy !== "record_until_threshold"
      )
        blockers.push("posthoc_skip_reason");
    }
  }
  for (const trial of plannedTrials)
    if (!seen.has(trial.trialId)) missingTrialIds.push(trial.trialId);
  if (missingTrialIds.length) blockers.push("planned_trial_missing");
  if (unexpectedTrialIds.length) blockers.push("unplanned_trial_present");
  if (duplicateTrialIds.length) blockers.push("duplicate_trial_execution");
  if (fingerprintMismatches.length)
    blockers.push("variant_fingerprint_mismatch");
  if (promptCommitmentMismatches.length)
    blockers.push("prompt_commitment_mismatch");
  if (identityMismatches.length) blockers.push("trial_identity_mismatch");
  const completedTrialCount = records.filter(
    (r) => r.status === "completed",
  ).length;
  const failedTrialCount = records.filter((r) => r.status === "failed").length;
  const skippedTrialCount = records.filter(
    (r) => r.status === "skipped",
  ).length;
  const attemptedTrialCount = completedTrialCount + failedTrialCount;
  if (attemptedTrialCount + skippedTrialCount !== plannedTrials.length)
    blockers.push("execution_counts_inconsistent");
  return {
    valid: blockers.length === 0,
    plannedTrialCount: plannedTrials.length,
    completedTrialCount,
    failedTrialCount,
    skippedTrialCount,
    attemptedTrialCount,
    missingTrialIds,
    unexpectedTrialIds,
    duplicateTrialIds,
    fingerprintMismatches,
    promptCommitmentMismatches,
    identityMismatches,
    blockers: [...new Set(blockers)],
  };
}

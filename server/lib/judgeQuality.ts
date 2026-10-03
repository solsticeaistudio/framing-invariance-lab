import type { JudgeAssessment, JudgeQualitySummary, Trial } from "../types.js";

export type JudgeQualityBucket =
  | "structured_success"
  | "heuristic_only"
  | "heuristic_fallback"
  | "transport_failure"
  | "legacy_unknown";

export function judgeQualityBucket(
  assessment: JudgeAssessment,
): JudgeQualityBucket {
  if (assessment.judgeStatus === "success") {
    if (
      assessment.assessmentSource === "structured_primary" ||
      assessment.assessmentSource === "structured_ensemble"
    )
      return "structured_success";
  }

  if (assessment.assessmentSource === "heuristic_fallback")
    return "heuristic_fallback";
  if (
    assessment.assessmentSource === "transport" ||
    assessment.source === "transport"
  )
    return "transport_failure";
  if (
    assessment.assessmentSource === "heuristic" ||
    assessment.judgeStatus === "heuristic_only"
  )
    return "heuristic_only";

  // Backward compatibility: legacy structured judgments predate explicit
  // judgeStatus/assessmentSource metadata.
  if (assessment.source === "ensemble" || assessment.source === "llm")
    return "structured_success";
  if (assessment.source === "heuristic") return "heuristic_only";
  return "legacy_unknown";
}

export function isEvidenceGradeAssessment(
  assessment: JudgeAssessment,
): boolean {
  return judgeQualityBucket(assessment) === "structured_success";
}

export function summarizeJudgeQuality(
  trials: Trial[],
): JudgeQualitySummary {
  const buckets = trials.map((trial) => judgeQualityBucket(trial.assessment));
  const count = (bucket: JudgeQualityBucket) =>
    buckets.filter((value) => value === bucket).length;
  const structuredSuccesses = count("structured_success");
  const heuristicOnly = count("heuristic_only");
  const heuristicFallbacks = count("heuristic_fallback");
  const transportFailures = count("transport_failure");
  const legacyUnknown = count("legacy_unknown");
  return {
    structuredSuccesses,
    heuristicOnly,
    heuristicFallbacks,
    transportFailures,
    legacyUnknown,
    evidenceGrade: structuredSuccesses,
    degraded:
      heuristicOnly + heuristicFallbacks + transportFailures + legacyUnknown,
  };
}

import type {
  EvalRun,
  GoldItem,
  JudgeAssessment,
  SecondaryReviewMetadata,
  SecondaryReviewSelection,
  SecondaryReviewStatus,
} from "../types.js";
import { analyzeTrials } from "./statistics.js";
import {
  defaultReplicationRole,
  sourceHashForScenario,
} from "./replication.js";

const SELECTIONS = new Set<SecondaryReviewSelection>([
  "not_selected",
  "random_sample",
  "disagreement_escalation",
  "forced",
  "other",
  "legacy_unknown",
]);
const STATUSES = new Set<SecondaryReviewStatus>([
  "not_attempted",
  "completed",
  "failed",
  "skipped",
  "legacy_unknown",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeSecondaryReview(
  assessment: JudgeAssessment,
): SecondaryReviewMetadata {
  const current = assessment.secondaryReview;
  if (
    current &&
    SELECTIONS.has(current.selection) &&
    STATUSES.has(current.status) &&
    (typeof current.eligible === "boolean" || current.eligible === null)
  ) {
    return { ...current };
  }

  if (
    assessment.secondaryAssessment ||
    assessment.secondaryDisagreement !== undefined
  ) {
    return {
      eligible: null,
      selection: "legacy_unknown",
      status: "completed",
      disagreement: assessment.secondaryDisagreement,
      errorCode: "legacy_selection_unknown",
      errorMessage:
        "Legacy run recorded a completed secondary review without its selection reason.",
    };
  }

  return {
    eligible: null,
    selection: "legacy_unknown",
    status: "legacy_unknown",
    errorCode: "legacy_metadata_missing",
    errorMessage:
      "Legacy run does not contain reconstructable secondary-review metadata.",
  };
}

export function normalizeAssessment(
  assessment: JudgeAssessment,
): JudgeAssessment {
  const secondaryReview = normalizeSecondaryReview(assessment);
  return {
    ...assessment,
    secondaryReview,
    secondaryDisagreement:
      secondaryReview.status === "completed"
        ? (secondaryReview.disagreement ?? assessment.secondaryDisagreement)
        : undefined,
  };
}

export function normalizeRun(raw: unknown): EvalRun | null {
  if (
    !isRecord(raw) ||
    typeof raw.id !== "string" ||
    !isRecord(raw.config) ||
    !Array.isArray(raw.trials)
  ) {
    return null;
  }

  // Persisted run JSON is an internal format. The checks above establish the outer
  // envelope; existing schema-versioned fields are retained and normalized below.
  const legacy = raw as unknown as EvalRun;
  const provenanceAware =
    raw.schemaVersion === "1.6" || raw.schemaVersion === "2.0";
  const sourceSchemaVersion = raw.schemaVersion;
  const isLegacy = sourceSchemaVersion !== "2.0";
  const trials = legacy.trials.map((trial) => ({
    ...trial,
    assessment: normalizeAssessment(trial.assessment),
  }));
  const progress = legacy.progress;
  return {
    ...legacy,
    schemaVersion: "2.0",
    config: {
      ...legacy.config,
      scenarios: legacy.config.scenarios.map((scenario) => {
        const normalized = {
          ...scenario,
          replicationRole:
            scenario.replicationRole ??
            defaultReplicationRole(scenario.datasetSplit),
          replicationProvenance: undefined,
        };
        return {
          ...normalized,
          replicationProvenance:
            provenanceAware && scenario.replicationProvenance
              ? { ...scenario.replicationProvenance }
              : {
                  kind: "legacy_unknown" as const,
                  trusted: false,
                  sourceHash: sourceHashForScenario(normalized),
                },
        };
      }),
    },
    trials,
    analysis: analyzeTrials(trials, progress.total),
    legacyEvidence: isLegacy
      ? {
          sourceSchemaVersion:
            sourceSchemaVersion === "1.4" || sourceSchemaVersion === "1.5"
              ? sourceSchemaVersion
              : "1.6",
          unsigned: true,
          provenanceUnknown: !provenanceAware,
          secondaryReviewUnknown: trials.some(
            (trial) => trial.assessment.secondaryReview?.eligible === null,
          ),
          maximumStudyTier: "exploratory",
          requiresRerun: true,
        }
      : legacy.legacyEvidence,
  };
}

export function normalizeGoldItems(raw: unknown): GoldItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      !isRecord(value.automatedAssessment)
    )
      return [];
    const item = value as unknown as GoldItem;
    return [
      {
        ...item,
        automatedAssessment: normalizeAssessment(item.automatedAssessment),
      },
    ];
  });
}

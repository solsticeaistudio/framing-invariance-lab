import { z } from "zod";

/**
 * Metadata-only go/no-go gate for controlled model-safety experiments.
 * No prompts, answers, private model names, credentials, or user information
 * may be supplied. The report never includes source configuration values.
 */
export const researchPreflightSchema = z.object({
  mode: z.enum(["sandbox", "authorized_live"]),
  scope: z.object({
    authorizedTargetConfirmed: z.boolean(),
    accountEligibilityConfirmed: z.boolean(),
    requestedModelInScope: z.boolean(),
  }).strict(),
  execution: z.object({
    modelCallsPlanned: z.number().int().min(0).max(1_000_000),
    automationEnabled: z.boolean(),
    automatedTestingPermissionConfirmed: z.boolean().nullable(),
    maximumPermittedCallsKnown: z.boolean(),
    plannedCallsWithinPermittedLimit: z.boolean(),
    stopOnTransportOrJudgeError: z.boolean(),
  }).strict(),
  confidentiality: z.object({
    protectedProgramMaterialsInUse: z.boolean(),
    externalSimulatorReceivesProtectedMaterials: z.boolean(),
    externalEvaluatorReceivesProtectedMaterials: z.boolean(),
    automaticThirdPartyUpload: z.boolean(),
    telemetryDisabled: z.boolean(),
    publicCiOrLogsContainProtectedMaterials: z.boolean(),
    privateArtifactsStoredOutsideApprovedEnvironment: z.boolean(),
  }).strict(),
  evidence: z.object({
    rawResultsLinkedToSourceRequestIds: z.boolean(),
    judgeIndependenceChecked: z.boolean(),
    humanReviewRequiredBeforeSubmission: z.boolean(),
    externalScoresClearlyLabeledUnverified: z.boolean(),
  }).strict(),
}).strict();

export type ResearchPreflightInput = z.infer<typeof researchPreflightSchema>;

export type PreflightIssue = {
  code: string;
  severity: "blocker" | "warning";
  message: string;
};

export type ResearchPreflightResult = {
  schemaVersion: "research-preflight-v1";
  decision: "blocked" | "provisional";
  blockers: number;
  warnings: number;
  issues: PreflightIssue[];
  guarantees: [
    "declarative_only",
    "no_live_connection_tested",
    "no_submission_eligibility_claim",
  ];
};

export function evaluateResearchPreflight(input: ResearchPreflightInput): ResearchPreflightResult {
  const issues: PreflightIssue[] = [];
  const add = (code: string, severity: PreflightIssue["severity"], message: string) => {
    issues.push({ code, severity, message });
  };

  const isLive = input.mode === "authorized_live";
  const makesCalls = input.execution.modelCallsPlanned > 0;

  if (isLive) {
    if (!input.scope.authorizedTargetConfirmed) {
      add("TARGET_AUTHORIZATION_UNCONFIRMED", "blocker", "Explicit target access and testing authorization must be verified.");
    }
    if (!input.scope.accountEligibilityConfirmed) {
      add("ACCOUNT_ELIGIBILITY_UNCONFIRMED", "blocker", "Testing identity is not confirmed as an authorized account.");
    }
    if (!input.scope.requestedModelInScope) {
      add("TARGET_OUT_OF_SCOPE", "blocker", "The requested model is not confirmed in the current approved scope.");
    }
    if (makesCalls && input.execution.automationEnabled && input.execution.automatedTestingPermissionConfirmed !== true) {
      add("AUTOMATION_PERMISSION_UNCONFIRMED", "blocker", "Automated requests require explicit program authorization, not merely an available API.");
    }
    if (makesCalls && !input.execution.maximumPermittedCallsKnown) {
      add("CALL_BUDGET_UNKNOWN", "warning", "Determine current request and rate constraints before any substantial testing.");
    }
    if (makesCalls && !input.execution.plannedCallsWithinPermittedLimit) {
      add("REQUEST_BUDGET_EXCEEDED", "blocker", "The planned run exceeds the confirmed request budget.");
    }
    if (makesCalls && !input.execution.stopOnTransportOrJudgeError) {
      add("ERRORS_NOT_FAIL_CLOSED", "blocker", "Transport and judging errors must stop the run rather than count as success.");
    }
  }

  if (input.confidentiality.protectedProgramMaterialsInUse) {
    if (input.confidentiality.externalSimulatorReceivesProtectedMaterials) {
      add("EXTERNAL_SIMULATOR_EXPOSURE", "blocker", "Protected data must not be forwarded to an unapproved simulator provider.");
    }
    if (input.confidentiality.externalEvaluatorReceivesProtectedMaterials) {
      add("EXTERNAL_EVALUATOR_EXPOSURE", "blocker", "Protected data must not be forwarded to an unapproved evaluation provider.");
    }
    if (input.confidentiality.automaticThirdPartyUpload) {
      add("THIRD_PARTY_REPORT_UPLOAD", "blocker", "Automatic third-party report uploads are incompatible with protected materials unless separately authorized.");
    }
    if (!input.confidentiality.telemetryDisabled) {
      add("TELEMETRY_EXPOSURE_RISK", "blocker", "Disable third-party telemetry for protected experiments unless the program explicitly permits it.");
    }
    if (input.confidentiality.publicCiOrLogsContainProtectedMaterials) {
      add("PUBLIC_LOG_EXPOSURE", "blocker", "Do not place private program materials or model responses in public CI or logs.");
    }
    if (input.confidentiality.privateArtifactsStoredOutsideApprovedEnvironment) {
      add("ARTIFACT_LOCATION_UNAPPROVED", "blocker", "Store protected research artifacts only in an approved confidential environment.");
    }
  }

  if (!input.evidence.rawResultsLinkedToSourceRequestIds) {
    add("PROVENANCE_INCOMPLETE", "warning", "Capture request identities and independently verifiable response provenance.");
  }
  if (!input.evidence.judgeIndependenceChecked) {
    add("JUDGE_NOT_INDEPENDENT", "warning", "Record evaluator identity and test for correlated judging errors.");
  }
  if (!input.evidence.humanReviewRequiredBeforeSubmission) {
    add("HUMAN_REVIEW_MISSING", "blocker", "Require human review before submitting a consequential finding.");
  }
  if (!input.evidence.externalScoresClearlyLabeledUnverified) {
    add("EXTERNAL_SCORE_PROMOTION_RISK", "blocker", "Never treat third-party model scores as independently verified findings.");
  }

  const blockers = issues.filter((issue) => issue.severity === "blocker").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return {
    schemaVersion: "research-preflight-v1",
    decision: blockers ? "blocked" : "provisional",
    blockers,
    warnings,
    issues,
    guarantees: [
      "declarative_only",
      "no_live_connection_tested",
      "no_submission_eligibility_claim",
    ],
  };
}

import { describe, expect, it } from "vitest";
import {
  evaluateResearchPreflight,
  researchPreflightSchema,
  type ResearchPreflightInput,
} from "./researchPreflight.js";

const baseline: ResearchPreflightInput = {
  mode: "sandbox",
  scope: {
    authorizedTargetConfirmed: false,
    accountEligibilityConfirmed: false,
    requestedModelInScope: false,
  },
  execution: {
    modelCallsPlanned: 0,
    automationEnabled: false,
    automatedTestingPermissionConfirmed: null,
    maximumPermittedCallsKnown: false,
    plannedCallsWithinPermittedLimit: false,
    stopOnTransportOrJudgeError: true,
  },
  confidentiality: {
    protectedProgramMaterialsInUse: false,
    externalSimulatorReceivesProtectedMaterials: false,
    externalEvaluatorReceivesProtectedMaterials: false,
    automaticThirdPartyUpload: false,
    telemetryDisabled: true,
    publicCiOrLogsContainProtectedMaterials: false,
    privateArtifactsStoredOutsideApprovedEnvironment: false,
  },
  evidence: {
    rawResultsLinkedToSourceRequestIds: true,
    judgeIndependenceChecked: true,
    humanReviewRequiredBeforeSubmission: true,
    externalScoresClearlyLabeledUnverified: true,
  },
};

const withChanges = (
  scope: Partial<ResearchPreflightInput["scope"]> = {},
  execution: Partial<ResearchPreflightInput["execution"]> = {},
  confidentiality: Partial<ResearchPreflightInput["confidentiality"]> = {},
): ResearchPreflightInput => ({
  ...baseline,
  mode: "authorized_live",
  scope: {
    authorizedTargetConfirmed: true,
    accountEligibilityConfirmed: true,
    requestedModelInScope: true,
    ...scope,
  },
  execution: {
    ...baseline.execution,
    modelCallsPlanned: 10,
    automationEnabled: true,
    automatedTestingPermissionConfirmed: true,
    maximumPermittedCallsKnown: true,
    plannedCallsWithinPermittedLimit: true,
    ...execution,
  },
  confidentiality: {
    ...baseline.confidentiality,
    protectedProgramMaterialsInUse: true,
    ...confidentiality,
  },
});

describe("confidential experiment preflight", () => {
  it("allows a zero-call benign sandbox without claiming verified authorization", () => {
    const result = evaluateResearchPreflight(baseline);
    expect(result.decision).toBe("provisional");
    expect(result.blockers).toBe(0);
    expect(result.guarantees).toContain("no_live_connection_tested");
  });

  it("fails closed on a wrong target and unconfirmed automation permission", () => {
    const result = evaluateResearchPreflight(
      withChanges({ requestedModelInScope: false }, {
        automatedTestingPermissionConfirmed: null,
        plannedCallsWithinPermittedLimit: false,
      }),
    );
    expect(result.decision).toBe("blocked");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "TARGET_OUT_OF_SCOPE",
        "AUTOMATION_PERMISSION_UNCONFIRMED",
        "REQUEST_BUDGET_EXCEEDED",
      ]),
    );
  });

  it("blocks external judge, simulator, upload, logging and telemetry exposure", () => {
    const result = evaluateResearchPreflight(
      withChanges({}, {}, {
        externalSimulatorReceivesProtectedMaterials: true,
        externalEvaluatorReceivesProtectedMaterials: true,
        automaticThirdPartyUpload: true,
        telemetryDisabled: false,
        publicCiOrLogsContainProtectedMaterials: true,
        privateArtifactsStoredOutsideApprovedEnvironment: true,
      }),
    );
    expect(result.blockers).toBe(6);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "EXTERNAL_SIMULATOR_EXPOSURE",
        "EXTERNAL_EVALUATOR_EXPOSURE",
        "THIRD_PARTY_REPORT_UPLOAD",
        "TELEMETRY_EXPOSURE_RISK",
        "PUBLIC_LOG_EXPOSURE",
        "ARTIFACT_LOCATION_UNAPPROVED",
      ]),
    );
  });

  it("does not conflate provenance warnings with verified findings", () => {
    const invalid = {
      ...withChanges({}, { maximumPermittedCallsKnown: false }),
      evidence: {
        rawResultsLinkedToSourceRequestIds: false,
        judgeIndependenceChecked: false,
        humanReviewRequiredBeforeSubmission: false,
        externalScoresClearlyLabeledUnverified: false,
      },
    };
    const result = evaluateResearchPreflight(invalid);
    expect(result.decision).toBe("blocked");
    expect(result.warnings).toBe(3);
    expect(result.issues.map((issue) => issue.code)).toContain("EXTERNAL_SCORE_PROMOTION_RISK");
  });

  it("does not accept extra fields where prompt or response text could be injected", () => {
    expect(researchPreflightSchema.safeParse({ ...baseline, prompt: "SECRET" }).success).toBe(false);
    expect(researchPreflightSchema.safeParse({
      ...baseline,
      confidentiality: {
        ...baseline.confidentiality,
        privateQuestionSet: "SECRET",
      },
    }).success).toBe(false);
  });

  it("does not echo configuration, private model names or secret values into results", () => {
    const result = evaluateResearchPreflight(withChanges());
    expect(result.decision).toBe("provisional");
    const data = JSON.stringify(result);
    expect(data).not.toContain("approvedModelAlias");
    expect(data).not.toContain("prompt");
    expect(data).not.toContain("key");
  });
});

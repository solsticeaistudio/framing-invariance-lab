import { describe, expect, it } from "vitest";
import { hasSignedEvidenceExportControls } from "./ReportPanel";

describe("report signed-evidence export controls", () => {
  it("hides signed exports for exploratory runs", () => {
    expect(
      hasSignedEvidenceExportControls({
        purpose: "exploratory_analysis",
        signedEvidenceEligibility: {
          eligible: false,
          promotable: false,
          mode: "exploratory_only",
          blockers: ["adaptive_mode_not_promotable"],
          warnings: [],
        },
      }),
    ).toBe(false);
  });

  it("shows signed exports for eligible evidence runs", () => {
    expect(
      hasSignedEvidenceExportControls({
        purpose: "promotable_evidence",
        signedEvidenceEligibility: {
          eligible: true,
          promotable: true,
          mode: "promotable_signed_evidence",
          blockers: [],
          warnings: [],
        },
      }),
    ).toBe(true);
  });
});

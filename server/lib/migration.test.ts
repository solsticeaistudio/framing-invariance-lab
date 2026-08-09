import { describe, expect, it } from "vitest";
import { normalizeRun } from "./migration.js";
import { makeRunFixture } from "../testing/fixtures.js";
import { buildReport } from "./report.js";
import { TEST_CALIBRATION } from "../testing/fixtures.js";

describe("run schema normalization", () => {
  it("preserves known completion but leaves legacy secondary selection unknown", () => {
    const legacy = structuredClone(makeRunFixture());
    legacy.schemaVersion = "1.4";
    for (const trial of legacy.trials) delete trial.assessment.secondaryReview;
    legacy.trials[0].assessment.secondaryAssessment = {
      behavior: "refusal_before_detail",
      policyCorrectness: "correct",
      contractPass: true,
      unsafeDetail: 0,
      harmSeverity: 0,
      confidence: 0.9,
    };
    legacy.trials[0].assessment.secondaryDisagreement = false;

    const normalized = normalizeRun(legacy);
    expect(normalized?.schemaVersion).toBe("2.0");
    expect(normalized?.trials[0].assessment.secondaryReview).toMatchObject({
      selection: "legacy_unknown",
      status: "completed",
      eligible: null,
    });
    expect(normalized?.trials[1].assessment.secondaryReview).toMatchObject({
      selection: "legacy_unknown",
      status: "legacy_unknown",
      eligible: null,
    });
    expect(normalized?.analysis.secondaryReviews.legacyUnknown).toBe(
      normalized?.trials.length,
    );
  });

  it("does not fabricate sealed-holdout provenance for legacy scenarios", () => {
    const legacy = structuredClone(
      makeRunFixture({ cells: [{ split: "holdout", depth: 5 }] }),
    );
    legacy.schemaVersion = "1.5";
    delete legacy.config.scenarios[0].replicationRole;
    delete legacy.config.scenarios[0].replicationProvenance;
    const normalized = normalizeRun(legacy);
    expect(normalized?.config.scenarios[0].replicationRole).toBe(
      "demo_holdout",
    );
    expect(normalized?.config.scenarios[0].replicationProvenance).toMatchObject(
      {
        kind: "legacy_unknown",
        trusted: false,
      },
    );
  });

  it("does not retain confirmation when legacy provenance cannot be reconstructed", () => {
    const legacy = structuredClone(
      makeRunFixture({
        cells: [
          {
            split: "development",
            role: "development",
            depth: 10,
            stage: "publish",
          },
          {
            split: "validation",
            role: "validation",
            depth: 10,
            stage: "publish",
          },
          {
            split: "holdout",
            role: "sealed_holdout",
            depth: 10,
            stage: "publish",
          },
        ],
      }),
    );
    legacy.schemaVersion = "1.5";
    legacy.config.scenarios.forEach((scenario) => {
      delete scenario.replicationProvenance;
    });
    const normalized = normalizeRun(legacy);
    if (!normalized) throw new Error("Fixture failed normalization.");
    const report = buildReport({
      run: normalized,
      calibration: TEST_CALIBRATION,
      audience: "research",
      disclosure: "internal",
    });
    expect(
      report.findings.every((finding) => finding.tier !== "confirmed"),
    ).toBe(true);
  });
});

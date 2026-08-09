import { describe, expect, it } from "vitest";
import type {
  PublicReportData,
  PublicReportEvidenceRef,
  ReportData,
  ReportDocument,
  ReportEvidenceRef,
} from "../types.js";
import {
  buildReport,
  reportEvidenceToCsv,
  reportToHtml,
  reportToMarkdown,
  validateReport,
  validateReportDetailed,
} from "./report.js";
import { makeRunFixture, TEST_CALIBRATION } from "../testing/fixtures.js";
import { toPublicReport, validatePublicReportShape } from "./publicReport.js";

function publicReportFor(run = makeRunFixture()): PublicReportData {
  return buildReport({
    run,
    calibration: TEST_CALIBRATION,
    audience: "research",
    disclosure: "public",
  });
}

function internalReportFor(run = makeRunFixture()): ReportData {
  return buildReport({
    run,
    calibration: TEST_CALIBRATION,
    audience: "research",
    disclosure: "internal",
  });
}

function clone<T extends ReportDocument>(report: T): T {
  return structuredClone(report);
}

function firstFinding(report: ReportDocument) {
  const finding = report.findings[0];
  if (!finding) throw new Error("Fixture did not produce a finding.");
  return finding;
}

describe("report construction and evidence tiers", () => {
  it("builds valid exploratory, public, and internal reports", () => {
    const exploratory = publicReportFor(
      makeRunFixture({ runMode: "exploratory" }),
    );
    const publicReport = publicReportFor();
    const internalReport = internalReportFor();

    expect(firstFinding(exploratory).tier).toBe("exploratory");
    expect(validateReport(exploratory)).toEqual([]);
    expect(validateReport(publicReport)).toEqual([]);
    expect(validateReport(internalReport)).toEqual([]);
    expect(publicReport.disclosure).toBe("public");
    expect(internalReport.disclosure).toBe("internal");
  });

  it("assigns supported only from adequate positive evidence in one cell", () => {
    const report = publicReportFor(
      makeRunFixture({
        cells: [
          {
            split: "validation",
            role: "validation",
            depth: 5,
            stage: "confirm",
          },
        ],
        confirmRepetitions: 5,
        publishRepetitions: 10,
      }),
    );
    expect(firstFinding(report).tier).toBe("supported");
    expect(
      firstFinding(report).tierAssessment.requirements
        .distinctSplitReplicationPresent,
    ).toBe(false);
  });

  it("assigns validated for preregistered cross-split validation replication", () => {
    const report = publicReportFor(
      makeRunFixture({
        cells: [
          {
            split: "development",
            role: "development",
            depth: 5,
            stage: "confirm",
          },
          {
            split: "validation",
            role: "validation",
            depth: 5,
            stage: "confirm",
          },
        ],
        confirmRepetitions: 5,
        publishRepetitions: 10,
      }),
    );
    expect(
      report.findings.some((finding) => finding.tier === "validated"),
    ).toBe(true);
    expect(
      report.findings.every((finding) => finding.tier !== "confirmed"),
    ).toBe(true);
  });

  it("assigns confirmed only with publication-depth sealed-holdout replication", () => {
    const report = publicReportFor(
      makeRunFixture({
        cells: [
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
        confirmRepetitions: 5,
        publishRepetitions: 10,
      }),
    );
    const confirmed = report.findings.filter(
      (finding) => finding.tier === "confirmed",
    );
    expect(confirmed.length).toBeGreaterThan(0);
    expect(
      confirmed.every(
        (finding) =>
          finding.tierAssessment.requirements.independentReplicationPresent,
      ),
    ).toBe(true);
    expect(validateReport(report)).toEqual([]);
  });

  it("does not confirm many repetitions from one validation split", () => {
    const report = publicReportFor(
      makeRunFixture({
        cells: [
          {
            split: "validation",
            role: "validation",
            depth: 20,
            stage: "publish",
          },
        ],
        confirmRepetitions: 5,
        publishRepetitions: 10,
      }),
    );
    expect(
      report.findings.every(
        (finding) =>
          finding.tier !== "confirmed" && finding.tier !== "validated",
      ),
    ).toBe(true);
    expect(firstFinding(report).tierAssessment.blockers).toContain(
      "No matching sealed-holdout or declared independent replication is present.",
    );
  });

  it("generates validated Markdown, HTML, and CSV with disclosure and secondary-review context", () => {
    const report = publicReportFor();
    const markdown = reportToMarkdown(report);
    const html = reportToHtml(report);
    const csv = reportEvidenceToCsv(report);
    expect(markdown).toContain("Secondary disagreement:");
    expect(html).toContain("print-disclosure");
    expect(html).toContain("Public disclosure");
    expect(csv).toContain("response_hash");
  });

  it("redacts every raw-evidence channel from public reports", () => {
    const run = makeRunFixture();
    const generated = run.variants.find((variant) => !variant.isBaseline);
    if (!generated) throw new Error("Fixture is missing a framed variant.");
    generated.source = "llm";
    generated.label = "PRIVATE_GENERATED_LABEL_WITH_PROMPT_TEXT";
    for (const trial of run.trials.filter(
      (item) => item.variant.id === generated.id,
    )) {
      trial.variant.source = "llm";
      trial.variant.label = generated.label;
    }
    const publicJson = JSON.stringify(publicReportFor(run));
    const internalJson = JSON.stringify(internalReportFor(run));
    for (const secret of [
      "SENSITIVE_BASE_PROMPT",
      "SENSITIVE_SYSTEM_PROMPT",
      "SENSITIVE_GENERATED_PROMPT",
      "SENSITIVE_RAW_RESPONSE",
      "PRIVATE_PREVIEW",
      "PRIVATE_RATIONALE",
      "PRIVATE_SIGNAL",
      "PRIVATE_SPAN_REASON",
      "PRIVATE_REQUEST",
      "PRIVATE_CANARY",
      "PRIVATE_NOTE",
      "PRIVATE_RUN_NAME",
      "PRIVATE_GENERATED_LABEL_WITH_PROMPT_TEXT",
    ])
      expect(publicJson).not.toContain(secret);
    expect(internalJson).toContain("SENSITIVE_GENERATED_PROMPT");
    expect(internalJson).toContain("SENSITIVE_RAW_RESPONSE");
  });

  it("uses a type-separated, strict allowlist public report", () => {
    const internal = internalReportFor() as ReportData & {
      futureInternalField?: string;
      aggregate: ReportData["aggregate"] & {
        futureProviderDiagnostic?: string;
      };
    };
    internal.futureInternalField = "PRIVATE_FUTURE_INTERNAL_FIELD";
    internal.aggregate.futureProviderDiagnostic = "PRIVATE_PROVIDER_ERROR";
    const publicReport = toPublicReport(internal);
    expect(validatePublicReportShape(publicReport)).toEqual([]);
    expect(JSON.stringify(publicReport)).not.toContain(
      "PRIVATE_FUTURE_INTERNAL_FIELD",
    );
    expect(JSON.stringify(publicReport)).not.toContain(
      "PRIVATE_PROVIDER_ERROR",
    );

    const publicEvidence = firstFinding(publicReport)
      .evidence[0] as PublicReportEvidenceRef;
    // @ts-expect-error Public evidence has no raw-response field.
    const forbiddenPublicEvidence: PublicReportEvidenceRef = {
      ...publicEvidence,
      response: "private",
    };
    void forbiddenPublicEvidence;
  });

  it("keeps all public renderers free of prompts, responses, notes, rationales, and provider errors", () => {
    const internal = internalReportFor() as ReportData & {
      providerError?: string;
    };
    internal.providerError = "PRIVATE_PROVIDER_ERROR_PAYLOAD";
    const report = toPublicReport(internal);
    const outputs = [
      JSON.stringify(report),
      reportToMarkdown(report),
      reportToHtml(report),
      reportEvidenceToCsv(report),
    ];
    for (const output of outputs) {
      for (const secret of [
        "SENSITIVE_BASE_PROMPT",
        "SENSITIVE_GENERATED_PROMPT",
        "SENSITIVE_RAW_RESPONSE",
        "PRIVATE_PREVIEW",
        "PRIVATE_RATIONALE",
        "PRIVATE_NOTE",
        "PRIVATE_PROVIDER_ERROR_PAYLOAD",
      ])
        expect(output).not.toContain(secret);
    }
    expect(JSON.stringify(internal)).toContain("SENSITIVE_RAW_RESPONSE");
  });

  it("emits only slug-safe or opaque public identifiers", () => {
    const run = makeRunFixture();
    run.config.scenarios[0].id = "Sensitive customer name / path";
    run.config.scenarios[0].familyId = "PRIVATE FAMILY TEXT";
    run.trials.forEach((trial) => {
      trial.scenarioId = run.config.scenarios[0].id;
      trial.scenarioFamily = run.config.scenarios[0].familyId;
      trial.variant.scenarioId = run.config.scenarios[0].id;
    });
    run.variants.forEach((variant) => {
      variant.scenarioId = run.config.scenarios[0].id;
    });
    run.analysis.variantMetrics.forEach((metric) => {
      metric.scenarioId = run.config.scenarios[0].id;
    });
    run.analysis.scenarioMetrics.forEach((metric) => {
      metric.scenarioId = run.config.scenarios[0].id;
    });
    const manifest = makeRunFixture().manifest;
    run.manifest = manifest;
    run.manifest.integrityStatus = "mismatch";
    const report = publicReportFor(run);
    const identifiers = report.sourceTrials.flatMap((entry) =>
      [
        entry.trialId,
        entry.scenarioId,
        entry.variantFingerprint,
        entry.replicationKey,
      ].filter((value): value is string => Boolean(value)),
    );
    expect(
      identifiers.every((identifier) =>
        /^[a-z0-9][a-z0-9_-]{0,159}$/.test(identifier),
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain("Sensitive customer name");
    expect(JSON.stringify(report)).not.toContain("PRIVATE FAMILY TEXT");
  });

  it("fails closed when a non-allowlisted public field appears", () => {
    const report = publicReportFor() as PublicReportData & {
      internalNotes?: string;
    };
    report.internalNotes = "must not render";
    expect(validateReportDetailed(report).map((issue) => issue.code)).toContain(
      "public_field_not_allowlisted",
    );
    expect(() => reportToMarkdown(report)).toThrow(/Report validation failed/);
  });

  it("fails closed with a structured issue when a required nested public field is missing", () => {
    const report = clone(publicReportFor());
    const malformed = report as PublicReportData & {
      run: Partial<PublicReportData["run"]>;
    };
    delete malformed.run.manifest;
    expect(validatePublicReportShape(report)).toContainEqual(
      expect.objectContaining({ code: "invalid_public_report_shape" }),
    );
    expect(() => reportToHtml(report)).toThrow(/Report validation failed/);
  });

  it("validates public shape before dereferencing a malformed top-level section", () => {
    const report = clone(publicReportFor());
    delete (report as Partial<PublicReportData>).aggregate;
    expect(validateReportDetailed(report)).toContainEqual(
      expect.objectContaining({ code: "invalid_public_report_shape" }),
    );
    expect(() => reportToMarkdown(report)).toThrow(/Report validation failed/);
  });
});

describe("fail-closed report validation", () => {
  const invalidCases: Array<{
    name: string;
    mutate: (report: ReportData) => void;
    code: string;
  }> = [
    {
      name: "event count above total",
      mutate: (report) => {
        firstFinding(report).events = firstFinding(report).total + 1;
      },
      code: "invalid_events",
    },
    {
      name: "event rate mismatch",
      mutate: (report) => {
        firstFinding(report).eventRate = 0.123;
      },
      code: "event_rate_mismatch",
    },
    {
      name: "reversed Wilson interval",
      mutate: (report) => {
        firstFinding(report).interval = { low: 0.8, high: 0.2 };
      },
      code: "invalid_wilson_interval",
    },
    {
      name: "Wilson interval outside unit range",
      mutate: (report) => {
        firstFinding(report).interval.low = -0.1;
      },
      code: "invalid_wilson_interval",
    },
    {
      name: "reversed risk-difference interval",
      mutate: (report) => {
        firstFinding(report).riskDifferenceInterval = { low: 0.5, high: -0.5 };
      },
      code: "invalid_risk_difference_interval",
    },
    {
      name: "risk-difference interval outside mathematical range",
      mutate: (report) => {
        firstFinding(report).riskDifferenceInterval.low = -1.1;
      },
      code: "invalid_risk_difference_interval",
    },
    {
      name: "non-finite value",
      mutate: (report) => {
        firstFinding(report).eventRate = Number.NaN;
      },
      code: "non_finite",
    },
    {
      name: "negative total",
      mutate: (report) => {
        firstFinding(report).total = -1;
      },
      code: "invalid_total",
    },
    {
      name: "completed count greater than total",
      mutate: (report) => {
        report.scope.totalTrials = 0;
      },
      code: "completed_exceeds_total",
    },
    {
      name: "malformed split total",
      mutate: (report) => {
        report.scope.splits[0].total = -1;
      },
      code: "invalid_split_total",
    },
    {
      name: "aggregate and split total mismatch",
      mutate: (report) => {
        report.scope.splits[0].total += 1;
      },
      code: "split_total_mismatch",
    },
    {
      name: "claim references missing evidence",
      mutate: (report) => {
        report.claims[0].evidenceIds = ["missing-evidence"];
      },
      code: "unknown_evidence_reference",
    },
    {
      name: "finding references missing claim",
      mutate: (report) => {
        firstFinding(report).claimIds = ["missing-claim"];
      },
      code: "unknown_claim_reference",
    },
    {
      name: "evidence references missing trial",
      mutate: (report) => {
        firstFinding(report).evidence[0].trialId = "missing-trial";
      },
      code: "unknown_trial_reference",
    },
    {
      name: "sample exceeds eligible",
      mutate: (report) => {
        report.aggregate.secondaryReviews.randomlySampled =
          report.aggregate.secondaryReviews.eligibleTrials + 1;
      },
      code: "secondary_sample_exceeds_eligible",
    },
    {
      name: "negative secondary-review count",
      mutate: (report) => {
        report.aggregate.secondaryReviews.failedReviews = -1;
      },
      code: "invalid_secondary_count",
    },
    {
      name: "completed secondary review exceeds attempted",
      mutate: (report) => {
        report.aggregate.secondaryReviews.completedReviews =
          report.aggregate.secondaryReviews.attemptedReviews + 1;
      },
      code: "secondary_completed_exceeds_attempted",
    },
    {
      name: "secondary disagreement exceeds completed",
      mutate: (report) => {
        report.aggregate.secondaryReviews.disagreements =
          report.aggregate.secondaryReviews.completedReviews + 1;
      },
      code: "secondary_disagreement_exceeds_completed",
    },
    {
      name: "secondary denominator differs from completed",
      mutate: (report) => {
        report.aggregate.secondaryReviews.disagreementRateDenominator += 1;
      },
      code: "secondary_denominator_mismatch",
    },
    {
      name: "secondary disagreement rate differs from completed denominator",
      mutate: (report) => {
        report.aggregate.secondaryReviews.disagreementRate = 0.123;
      },
      code: "secondary_rate_mismatch",
    },
    {
      name: "aggregate contract rate differs from count",
      mutate: (report) => {
        report.aggregate.contractFailureRate = 0.123;
      },
      code: "aggregate_rate_mismatch",
    },
    {
      name: "fractional finding count",
      mutate: (report) => {
        firstFinding(report).events = 1.5;
      },
      code: "invalid_events",
    },
  ];

  it.each(invalidCases)("rejects $name", ({ mutate, code }) => {
    const report = clone(internalReportFor());
    mutate(report);
    expect(validateReportDetailed(report).map((issue) => issue.code)).toContain(
      code,
    );
  });

  it.each([
    "prompt",
    "response",
    "responsePreview",
    "rationale",
    "signals",
  ] as const)("rejects public evidence containing %s", (field) => {
    const report = clone(publicReportFor());
    const evidence = firstFinding(report).evidence[0] as ReportEvidenceRef &
      Record<string, unknown>;
    evidence[field] =
      field === "signals" ? ["quoted model output"] : "quoted model output";
    expect(validateReportDetailed(report).map((issue) => issue.code)).toContain(
      "public_disclosure_leak",
    );
  });

  it("rejects a confirmed tier whose preregistration, manifest, split, or depth claims are false", () => {
    const source = internalReportFor(
      makeRunFixture({
        cells: [
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
        publishRepetitions: 10,
      }),
    );
    for (const mutate of [
      (report: ReportData) => {
        firstFinding(report).tierAssessment.requirements.preregistered = false;
      },
      (report: ReportData) => {
        report.run.manifest.integrityStatus = "mismatch";
        report.integrity.manifestVerified = false;
        firstFinding(report).tierAssessment.requirements.manifestVerified =
          false;
      },
      (report: ReportData) => {
        firstFinding(
          report,
        ).tierAssessment.requirements.nonDevelopmentEvidencePresent = false;
      },
      (report: ReportData) => {
        firstFinding(
          report,
        ).tierAssessment.requirements.distinctSplitReplicationPresent = false;
      },
      (report: ReportData) => {
        firstFinding(report).tierAssessment.requirements.publicationDepthMet =
          false;
      },
    ]) {
      const report = clone(source);
      mutate(report);
      expect(
        validateReportDetailed(report).map((issue) => issue.code),
      ).toContain("unsupported_confirmed_tier");
    }
  });

  it("rejects an invalid manifest and exploratory run from confirmation during construction", () => {
    const invalidManifest = publicReportFor(
      makeRunFixture({ validManifest: false }),
    );
    const exploratory = publicReportFor(
      makeRunFixture({ runMode: "exploratory" }),
    );
    expect(
      invalidManifest.findings.every(
        (finding) => finding.tier === "exploratory",
      ),
    ).toBe(true);
    expect(
      exploratory.findings.every((finding) => finding.tier === "exploratory"),
    ).toBe(true);
  });

  it("prevents rendering an invalid report", () => {
    const report = clone(internalReportFor());
    firstFinding(report).riskDifferenceInterval.high = 2;
    expect(() => reportToMarkdown(report)).toThrow(/Report validation failed/);
    expect(() => reportToHtml(report)).toThrow(/Report validation failed/);
    expect(() => reportEvidenceToCsv(report)).toThrow(
      /Report validation failed/,
    );
  });

  it.each([
    [
      "finding contract failure rate",
      (report: ReportData) => {
        firstFinding(report).contractFailureRate = 1.1;
      },
      "rate_out_of_bounds",
    ],
    [
      "finding harm severity",
      (report: ReportData) => {
        firstFinding(report).meanHarmSeverity = 5.1;
      },
      "severity_out_of_bounds",
    ],
    [
      "relative risk derivation",
      (report: ReportData) => {
        firstFinding(report).relativeRisk = 99;
      },
      "relative_risk_mismatch",
    ],
    [
      "Wilson derivation",
      (report: ReportData) => {
        firstFinding(report).interval.low += 0.01;
      },
      "wilson_interval_mismatch",
    ],
    [
      "overall invariance range",
      (report: ReportData) => {
        report.aggregate.overallInvariance = 1.01;
      },
      "aggregate_rate_out_of_bounds",
    ],
    [
      "severity weighted derivation",
      (report: ReportData) => {
        report.aggregate.severityWeightedRisk = 0.123;
      },
      "severity_weighted_risk_mismatch",
    ],
    [
      "split severity",
      (report: ReportData) => {
        report.scope.splits[0].meanHarmSeverity = -0.1;
      },
      "invalid_split_severity",
    ],
    [
      "fractional aggregate count",
      (report: ReportData) => {
        report.aggregate.contractFailures = 1.5;
      },
      "invalid_aggregate_count",
    ],
    [
      "calibration range",
      (report: ReportData) => {
        report.calibration.behaviorAccuracy = 1.1;
      },
      "invalid_calibration_rate",
    ],
    [
      "axis risk difference",
      (report: ReportData) => {
        report.axisEffects[0].riskDifferenceVsBaseline = 1.1;
      },
      "invalid_axis_risk_difference",
    ],
    [
      "boundary rate",
      (report: ReportData) => {
        report.boundaryMetrics[0].boundaryAccuracy = -0.1;
      },
      "invalid_boundary_rate",
    ],
  ] as const)("rejects %s", (_name, mutate, code) => {
    const report = clone(internalReportFor());
    mutate(report);
    expect(validateReportDetailed(report).map((issue) => issue.code)).toContain(
      code,
    );
  });

  it.each([
    [
      "wrong scenario",
      (report: ReportData) => {
        firstFinding(report).evidence[0].scenarioId = "other-scenario";
      },
      "evidence_scenario_mismatch",
    ],
    [
      "wrong variant",
      (report: ReportData) => {
        firstFinding(report).evidence[0].variantFingerprint = "other-variant";
      },
      "evidence_variant_mismatch",
    ],
    [
      "wrong response hash",
      (report: ReportData) => {
        firstFinding(report).evidence[0].responseHash = "f".repeat(64);
      },
      "evidence_response_hash_mismatch",
    ],
    [
      "wrong split",
      (report: ReportData) => {
        firstFinding(report).evidence[0].datasetSplit = "development";
      },
      "evidence_split_mismatch",
    ],
    [
      "wrong replication identity",
      (report: ReportData) => {
        firstFinding(report).evidence[0].replicationKey = "wrong-replication";
      },
      "evidence_replication_mismatch",
    ],
  ] as const)("rejects evidence with %s", (_name, mutate, code) => {
    const report = clone(internalReportFor());
    mutate(report);
    expect(validateReportDetailed(report).map((issue) => issue.code)).toContain(
      code,
    );
  });

  it("rejects duplicated evidence and incompatible cross-finding attachment", () => {
    const duplicate = clone(internalReportFor());
    const evidence = structuredClone(firstFinding(duplicate).evidence[0]);
    evidence.id = `${evidence.id}-duplicate`;
    firstFinding(duplicate).evidence.push(evidence);
    expect(
      validateReportDetailed(duplicate).map((issue) => issue.code),
    ).toContain("duplicate_evidence_trial");

    const incompatible = clone(
      internalReportFor(
        makeRunFixture({
          cells: [
            {
              split: "development",
              role: "development",
              depth: 5,
              stage: "confirm",
            },
            {
              split: "validation",
              role: "validation",
              depth: 5,
              stage: "confirm",
            },
          ],
        }),
      ),
    );
    if (incompatible.findings.length < 2)
      throw new Error("Fixture needs two findings for linkage test.");
    const copied = structuredClone(incompatible.findings[0].evidence[0]);
    copied.id = `${copied.id}-other-finding`;
    incompatible.findings[1].evidence.push(copied);
    expect(
      validateReportDetailed(incompatible).map((issue) => issue.code),
    ).toContain("incompatible_evidence_attachment");
  });

  it("accepts evidence bound to its source scenario, variant, split, hash, and replication identity", () => {
    const report = internalReportFor();
    expect(
      validateReportDetailed(report).filter((issue) =>
        issue.code.startsWith("evidence_"),
      ),
    ).toEqual([]);
  });
});

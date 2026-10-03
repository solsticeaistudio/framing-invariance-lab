import type {
  PublicReportData,
  PublicReportEvidenceRef,
  PublicReportFinding,
  ReportData,
  ReportValidationIssue,
  SourceTrialLedgerEntry,
} from "../types.js";
import { sha256, shortHash } from "./hash.js";

const SAFE_IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,159}$/;

export function safePublicIdentifier(value: string, prefix: string): string {
  const normalized = value.trim().toLowerCase();
  return SAFE_IDENTIFIER.test(normalized)
    ? normalized
    : `${prefix}-${shortHash(value)}`;
}

function safeHash(value: string): string {
  return /^[a-f0-9]{64}$/.test(value) ? value : sha256(value);
}

function findingMapper(report: ReportData) {
  const evidenceIds = new Map<string, string>();
  const findingIds = new Map<string, string>();
  const claimIds = new Map(
    report.claims.map((claim) => [
      claim.id,
      safePublicIdentifier(claim.id, "claim"),
    ]),
  );
  const mapEvidence = (evidence: ReportData["findings"][number]["evidence"]) =>
    evidence.map((item): PublicReportEvidenceRef => {
      const id = safePublicIdentifier(item.id, "evidence");
      evidenceIds.set(item.id, id);
      return {
        id,
        trialId: safePublicIdentifier(item.trialId, "trial"),
        responseHash: safeHash(item.responseHash),
        scenarioId: safePublicIdentifier(item.scenarioId, "scenario"),
        variantFingerprint: safePublicIdentifier(
          item.variantFingerprint,
          "variant",
        ),
        datasetSplit: item.datasetSplit,
        replicationKey: item.replicationKey
          ? safePublicIdentifier(item.replicationKey, "replication")
          : undefined,
        stopReason: item.stopReason,
        harmSeverity: item.harmSeverity,
        summary: {
          behavior: item.summary.behavior,
          policyCorrectness: item.summary.policyCorrectness,
          contractPass: item.summary.contractPass,
          failureModes: [...item.summary.failureModes],
        },
      };
    });
  const mapFinding = (
    finding: ReportData["findings"][number],
  ): PublicReportFinding => {
    const id = safePublicIdentifier(finding.id, "finding");
    findingIds.set(finding.id, id);
    const scenarioId = safePublicIdentifier(finding.scenarioId, "scenario");
    const variantId = safePublicIdentifier(finding.variantId, "variant");
    const variantFingerprint = safePublicIdentifier(
      finding.variantFingerprint,
      "variant",
    );
    const requirements = finding.tierAssessment.requirements;
    return {
      id,
      kind: finding.kind,
      tier: finding.tier,
      tierAssessment: {
        assignedTier: finding.tierAssessment.assignedTier,
        replicationKey: finding.tierAssessment.replicationKey
          ? safePublicIdentifier(
              finding.tierAssessment.replicationKey,
              "replication",
            )
          : undefined,
        matchingSplits: [...finding.tierAssessment.matchingSplits],
        requirements: {
          preregistered: requirements.preregistered,
          manifestVerified: requirements.manifestVerified,
          positiveConservativeEffect: requirements.positiveConservativeEffect,
          supportedDepthMet: requirements.supportedDepthMet,
          publicationDepthMet: requirements.publicationDepthMet,
          confirmatoryStagePresent: requirements.confirmatoryStagePresent,
          nonDevelopmentEvidencePresent:
            requirements.nonDevelopmentEvidencePresent,
          distinctSplitReplicationPresent:
            requirements.distinctSplitReplicationPresent,
          validationReplicationPresent:
            requirements.validationReplicationPresent,
          validationProvenanceTrusted: requirements.validationProvenanceTrusted,
          confirmatoryReplicationPresent:
            requirements.confirmatoryReplicationPresent,
          confirmatoryProvenanceTrusted:
            requirements.confirmatoryProvenanceTrusted,
          provenanceManifestCovered: requirements.provenanceManifestCovered,
          roleSplitConsistent: requirements.roleSplitConsistent,
          sealedHoldoutReplicationPresent:
            requirements.sealedHoldoutReplicationPresent,
          independentReplicationPresent:
            requirements.independentReplicationPresent,
        },
        blockers: [...finding.tierAssessment.blockers],
      },
      title: `${scenarioId} — framing condition`,
      scenarioId,
      scenarioTitle: scenarioId,
      family: safePublicIdentifier(finding.family, "family"),
      policyArea: finding.policyArea,
      datasetSplit: finding.datasetSplit,
      boundaryPosition: finding.boundaryPosition,
      variantId,
      variantFingerprint,
      variantLabel: "Sanitized framing condition",
      framingAxes: {
        context: safePublicIdentifier(finding.framingAxes.context, "axis"),
        authority: safePublicIdentifier(finding.framingAxes.authority, "axis"),
        perspective: safePublicIdentifier(
          finding.framingAxes.perspective,
          "axis",
        ),
        pressure: safePublicIdentifier(finding.framingAxes.pressure, "axis"),
        format: safePublicIdentifier(finding.framingAxes.format, "axis"),
        indirection: safePublicIdentifier(
          finding.framingAxes.indirection,
          "axis",
        ),
        socialProof: safePublicIdentifier(
          finding.framingAxes.socialProof,
          "axis",
        ),
      },
      total: finding.total,
      events: finding.events,
      eventRate: finding.eventRate,
      baselineRate: finding.baselineRate,
      absoluteRiskDifference: finding.absoluteRiskDifference,
      relativeRisk: finding.relativeRisk,
      interval: { low: finding.interval.low, high: finding.interval.high },
      riskDifferenceInterval: {
        low: finding.riskDifferenceInterval.low,
        high: finding.riskDifferenceInterval.high,
      },
      contractFailureRate: finding.contractFailureRate,
      meanHarmSeverity: finding.meanHarmSeverity,
      reproducibility: finding.reproducibility,
      judgeDisagreementRate: finding.judgeDisagreementRate,
      failureModes: [...finding.failureModes],
      explanation: `Observed ${finding.events} events in ${finding.total} completed trials; the assigned evidence tier is ${finding.tier}.`,
      evidence: mapEvidence(finding.evidence),
      claimIds: finding.claimIds.map(
        (id) => claimIds.get(id) ?? safePublicIdentifier(id, "claim"),
      ),
    };
  };
  return { mapFinding, evidenceIds, findingIds, claimIds };
}

function publicLedgerEntry(
  entry: SourceTrialLedgerEntry,
): SourceTrialLedgerEntry {
  return {
    trialId: safePublicIdentifier(entry.trialId, "trial"),
    scenarioId: safePublicIdentifier(entry.scenarioId, "scenario"),
    variantFingerprint: safePublicIdentifier(
      entry.variantFingerprint,
      "variant",
    ),
    responseHash: safeHash(entry.responseHash),
    datasetSplit: entry.datasetSplit,
    replicationKey: entry.replicationKey
      ? safePublicIdentifier(entry.replicationKey, "replication")
      : undefined,
  };
}

export function toPublicReport(report: ReportData): PublicReportData {
  const { mapFinding, evidenceIds, claimIds } = findingMapper(report);
  const findings = report.findings.map(mapFinding);
  const strengths = report.strengths.map(mapFinding);
  const inconclusive = report.inconclusive.map(mapFinding);
  const totalFindings = findings.filter(
    (finding) => finding.kind === "weakness",
  ).length;
  return {
    schemaVersion: "2.0",
    generatedAt: report.generatedAt,
    reportId: safePublicIdentifier(report.reportId, "report"),
    audience: report.audience,
    disclosure: "public",
    title: `Public findings report ${safePublicIdentifier(report.run.id, "run")}`,
    run: {
      id: safePublicIdentifier(report.run.id, "run"),
      name: `Public run ${safePublicIdentifier(report.run.id, "run")}`,
      status: report.run.status,
      createdAt: report.run.createdAt,
      targetModel: safePublicIdentifier(report.run.targetModel, "model"),
      harnessVersion: report.run.harnessVersion,
      methodologyVersion: report.run.methodologyVersion,
      runMode: report.run.runMode,
      replicationMode: report.run.replicationMode,
      manifest: {
        manifestVersion: report.run.manifest.manifestVersion,
        canonicalization: report.run.manifest.canonicalization,
        lockedAt: report.run.manifest.lockedAt,
        runMode: report.run.manifest.runMode,
        scenarioRegistryHash: report.run.manifest.scenarioRegistryHash,
        replicationProvenanceHash:
          report.run.manifest.replicationProvenanceHash,
        axisDefinitionHash: report.run.manifest.axisDefinitionHash,
        judgeProtocolHash: report.run.manifest.judgeProtocolHash,
        targetConfigHash: report.run.manifest.targetConfigHash,
        methodologyCompatibilityHash:
          report.run.manifest.methodologyCompatibilityHash,
        replicationPlanHash: report.run.manifest.replicationPlanHash,
        designHash: report.run.manifest.designHash,
        variantSetHash: report.run.manifest.variantSetHash,
        executionManifestHash: report.run.manifest.executionManifestHash,
        fullManifestHash: report.run.manifest.fullManifestHash,
        integrityStatus: report.run.manifest.integrityStatus,
      },
    },
    integrity: {
      publishable: report.integrity.publishable,
      manifestVerified: report.integrity.manifestVerified,
      grade: report.integrity.grade,
      reasons: [...report.integrity.reasons],
    },
    executiveSummary: [
      `${report.scope.completedTrials} completed trials were included across ${report.scope.scenarios} scenarios.`,
      `${totalFindings} sanitized weakness findings are included in this public report.`,
      `Evidence grade: ${report.integrity.grade}.`,
    ],
    scope: {
      scenarios: report.scope.scenarios,
      variants: report.scope.variants,
      totalTrials: report.scope.totalTrials,
      recordedTrials: report.scope.recordedTrials,
      completedTrials: report.scope.completedTrials,
      errors: report.scope.errors,
      splits: report.scope.splits.map((split) => ({
        split: split.split,
        total: split.total,
        unsafeRate: split.unsafeRate,
        incorrectRate: split.incorrectRate,
        contractFailureRate: split.contractFailureRate,
        meanHarmSeverity: split.meanHarmSeverity,
      })),
    },
    aggregate: {
      unsafeSuccesses: report.aggregate.unsafeSuccesses,
      incorrectDecisions: report.aggregate.incorrectDecisions,
      contractFailures: report.aggregate.contractFailures,
      unsafeRate: report.aggregate.unsafeRate,
      contractFailureRate: report.aggregate.contractFailureRate,
      incorrectRate: report.aggregate.incorrectRate,
      meanHarmSeverity: report.aggregate.meanHarmSeverity,
      severityWeightedRisk: report.aggregate.severityWeightedRisk,
      overallInvariance: report.aggregate.overallInvariance,
      judgeDisagreementRate: report.aggregate.judgeDisagreementRate,
      secondaryJudgeDisagreementRate:
        report.aggregate.secondaryJudgeDisagreementRate,
      secondaryReviews: {
        eligibleTrials: report.aggregate.secondaryReviews.eligibleTrials,
        notSelected: report.aggregate.secondaryReviews.notSelected,
        randomlySampled: report.aggregate.secondaryReviews.randomlySampled,
        disagreementEscalations:
          report.aggregate.secondaryReviews.disagreementEscalations,
        forcedReviews: report.aggregate.secondaryReviews.forcedReviews,
        otherSelections: report.aggregate.secondaryReviews.otherSelections,
        legacyUnknown: report.aggregate.secondaryReviews.legacyUnknown,
        attemptedReviews: report.aggregate.secondaryReviews.attemptedReviews,
        completedReviews: report.aggregate.secondaryReviews.completedReviews,
        failedReviews: report.aggregate.secondaryReviews.failedReviews,
        skippedReviews: report.aggregate.secondaryReviews.skippedReviews,
        disagreements: report.aggregate.secondaryReviews.disagreements,
        disagreementRate: report.aggregate.secondaryReviews.disagreementRate,
        disagreementRateDenominator:
          report.aggregate.secondaryReviews.disagreementRateDenominator,
      },
      judgeQuality: {
        structuredSuccesses: report.aggregate.judgeQuality.structuredSuccesses,
        heuristicOnly: report.aggregate.judgeQuality.heuristicOnly,
        heuristicFallbacks: report.aggregate.judgeQuality.heuristicFallbacks,
        transportFailures: report.aggregate.judgeQuality.transportFailures,
        legacyUnknown: report.aggregate.judgeQuality.legacyUnknown,
        evidenceGrade: report.aggregate.judgeQuality.evidenceGrade,
        degraded: report.aggregate.judgeQuality.degraded,
      },
    },
    calibration: {
      goldItems: report.calibration.goldItems,
      adjudicatedItems: report.calibration.adjudicatedItems,
      doubleAnnotatedItems: report.calibration.doubleAnnotatedItems,
      behaviorAccuracy: report.calibration.behaviorAccuracy,
      behaviorKappa: report.calibration.behaviorKappa,
      humanHumanKappa: report.calibration.humanHumanKappa,
      contractAccuracy: report.calibration.contractAccuracy,
      correctnessAccuracy: report.calibration.correctnessAccuracy,
      unsafeDetailMae: report.calibration.unsafeDetailMae,
      harmSeverityMae: report.calibration.harmSeverityMae,
      unsafeLeakageRecall: report.calibration.unsafeLeakageRecall,
      unsafeLeakageFalseNegativeRate:
        report.calibration.unsafeLeakageFalseNegativeRate,
      heuristicBehaviorAccuracy: report.calibration.heuristicBehaviorAccuracy,
      heuristicBehaviorKappa: report.calibration.heuristicBehaviorKappa,
      confusionMatrix: Object.fromEntries(
        Object.entries(report.calibration.confusionMatrix).map(
          ([key, values]) => [
            safePublicIdentifier(key, "class"),
            Object.fromEntries(
              Object.entries(values).map(([innerKey, value]) => [
                safePublicIdentifier(innerKey, "class"),
                value,
              ]),
            ),
          ],
        ),
      ),
      classMetrics: report.calibration.classMetrics.map((metric) => ({
        label: safePublicIdentifier(metric.label, "class"),
        support: metric.support,
        precision: metric.precision,
        recall: metric.recall,
        f1: metric.f1,
      })),
    },
    findings,
    strengths,
    inconclusive,
    boundaryMetrics: report.boundaryMetrics.map((metric) => ({
      pairId: safePublicIdentifier(metric.pairId, "pair"),
      total: metric.total,
      positionsPresent: [...metric.positionsPresent],
      boundaryAccuracy: metric.boundaryAccuracy,
      negativeControlPassRate: metric.negativeControlPassRate,
      allowedBoundaryPassRate: metric.allowedBoundaryPassRate,
      disallowedBoundaryPassRate: metric.disallowedBoundaryPassRate,
      overrefusalRate: metric.overrefusalRate,
      underrefusalRate: metric.underrefusalRate,
      weakestPosition: metric.weakestPosition,
    })),
    axisEffects: report.axisEffects.map((metric) => ({
      axis: safePublicIdentifier(metric.axis, "axis"),
      value: safePublicIdentifier(metric.value, "axis-value"),
      label: `${safePublicIdentifier(metric.axis, "axis")}:${safePublicIdentifier(metric.value, "axis-value")}`,
      total: metric.total,
      unsafeRate: metric.unsafeRate,
      incorrectRate: metric.incorrectRate,
      contractFailureRate: metric.contractFailureRate,
      meanHarmSeverity: metric.meanHarmSeverity,
      riskDifferenceVsBaseline: metric.riskDifferenceVsBaseline,
      interval: { low: metric.interval.low, high: metric.interval.high },
    })),
    failureModes: report.failureModes.map((metric) => ({
      mode: metric.mode,
      count: metric.count,
      rate: metric.rate,
    })),
    comparison: report.comparison
      ? {
          baselineRunId: safePublicIdentifier(
            report.comparison.baselineRunId,
            "run",
          ),
          candidateRunId: safePublicIdentifier(
            report.comparison.candidateRunId,
            "run",
          ),
          comparable: report.comparison.comparable,
          comparabilityWarnings: report.comparison.comparabilityWarnings.map(
            () => "Comparison limitation recorded.",
          ),
          matchedVariants: report.comparison.matchedVariants,
          fixed: report.comparison.fixed,
          regressed: report.comparison.regressed,
          introduced: report.comparison.introduced,
          unchanged: report.comparison.unchanged,
          unsafeRateDelta: report.comparison.unsafeRateDelta,
          contractFailureDelta: report.comparison.contractFailureDelta,
          meanSeverityDelta: report.comparison.meanSeverityDelta,
          releaseGate: {
            pass: report.comparison.releaseGate.pass,
            reasons: report.comparison.releaseGate.reasons.map(
              () => "Release-gate condition recorded.",
            ),
            criticalUnsafeRateDelta:
              report.comparison.releaseGate.criticalUnsafeRateDelta,
            benignOverrefusalDelta:
              report.comparison.releaseGate.benignOverrefusalDelta,
            newCanaryLeaks: report.comparison.releaseGate.newCanaryLeaks,
            thresholds: {
              criticalUnsafeRateDelta:
                report.comparison.releaseGate.thresholds
                  .criticalUnsafeRateDelta,
              benignOverrefusalDelta:
                report.comparison.releaseGate.thresholds.benignOverrefusalDelta,
            },
          },
          metrics: report.comparison.metrics.map((metric) => ({
            key: safePublicIdentifier(metric.key, "comparison"),
            label: safePublicIdentifier(metric.key, "comparison"),
            baselineTotal: metric.baselineTotal,
            candidateTotal: metric.candidateTotal,
            baselineUnsafeRate: metric.baselineUnsafeRate,
            candidateUnsafeRate: metric.candidateUnsafeRate,
            unsafeRateDelta: metric.unsafeRateDelta,
            baselineContractFailureRate: metric.baselineContractFailureRate,
            candidateContractFailureRate: metric.candidateContractFailureRate,
            contractFailureDelta: metric.contractFailureDelta,
            baselineMeanSeverity: metric.baselineMeanSeverity,
            candidateMeanSeverity: metric.candidateMeanSeverity,
            severityDelta: metric.severityDelta,
            status: metric.status,
          })),
        }
      : undefined,
    limitations: [...report.limitations],
    claims: report.claims.map((claim) => ({
      id: claimIds.get(claim.id) ?? safePublicIdentifier(claim.id, "claim"),
      text:
        claim.kind === "finding"
          ? "Finding supported by linked aggregate evidence."
          : "Aggregate report claim.",
      evidenceIds: claim.evidenceIds.map(
        (id) => evidenceIds.get(id) ?? safePublicIdentifier(id, "evidence"),
      ),
      kind: claim.kind,
    })),
    sourceTrials: report.sourceTrials.map(publicLedgerEntry),
    replicationCapability: {
      builtInValidationAvailable:
        report.replicationCapability.builtInValidationAvailable,
      builtInConfirmationAvailable:
        report.replicationCapability.builtInConfirmationAvailable,
      externalPackRequired: report.replicationCapability.externalPackRequired,
      explicitReplicationScenarios:
        report.replicationCapability.explicitReplicationScenarios,
      crossSplitReplicationFamilies:
        report.replicationCapability.crossSplitReplicationFamilies,
      threeSplitReplicationFamilies:
        report.replicationCapability.threeSplitReplicationFamilies,
    },
  };
}

const KEYS = {
  top: [
    "schemaVersion",
    "generatedAt",
    "reportId",
    "audience",
    "disclosure",
    "title",
    "run",
    "integrity",
    "executiveSummary",
    "scope",
    "aggregate",
    "calibration",
    "findings",
    "strengths",
    "inconclusive",
    "boundaryMetrics",
    "axisEffects",
    "failureModes",
    "comparison",
    "limitations",
    "claims",
    "sourceTrials",
    "replicationCapability",
  ],
  run: [
    "id",
    "name",
    "status",
    "createdAt",
    "targetModel",
    "harnessVersion",
    "methodologyVersion",
    "runMode",
    "replicationMode",
    "manifest",
  ],
  manifest: [
    "manifestVersion",
    "canonicalization",
    "lockedAt",
    "runMode",
    "scenarioRegistryHash",
    "replicationProvenanceHash",
    "axisDefinitionHash",
    "judgeProtocolHash",
    "targetConfigHash",
    "methodologyCompatibilityHash",
    "replicationPlanHash",
    "designHash",
    "variantSetHash",
    "executionManifestHash",
    "fullManifestHash",
    "integrityStatus",
  ],
  integrity: ["publishable", "manifestVerified", "grade", "reasons"],
  scope: [
    "scenarios",
    "variants",
    "totalTrials",
    "recordedTrials",
    "completedTrials",
    "errors",
    "splits",
  ],
  split: [
    "split",
    "total",
    "unsafeRate",
    "incorrectRate",
    "contractFailureRate",
    "meanHarmSeverity",
  ],
  aggregate: [
    "unsafeSuccesses",
    "incorrectDecisions",
    "contractFailures",
    "unsafeRate",
    "contractFailureRate",
    "incorrectRate",
    "meanHarmSeverity",
    "severityWeightedRisk",
    "overallInvariance",
    "judgeDisagreementRate",
    "secondaryJudgeDisagreementRate",
    "secondaryReviews",
    "judgeQuality",
  ],
  judgeQuality: [
    "structuredSuccesses",
    "heuristicOnly",
    "heuristicFallbacks",
    "transportFailures",
    "legacyUnknown",
    "evidenceGrade",
    "degraded",
  ],
  secondary: [
    "eligibleTrials",
    "notSelected",
    "randomlySampled",
    "disagreementEscalations",
    "forcedReviews",
    "otherSelections",
    "legacyUnknown",
    "attemptedReviews",
    "completedReviews",
    "failedReviews",
    "skippedReviews",
    "disagreements",
    "disagreementRate",
    "disagreementRateDenominator",
  ],
  finding: [
    "id",
    "kind",
    "tier",
    "tierAssessment",
    "title",
    "scenarioId",
    "scenarioTitle",
    "family",
    "policyArea",
    "datasetSplit",
    "boundaryPosition",
    "variantId",
    "variantFingerprint",
    "variantLabel",
    "framingAxes",
    "total",
    "events",
    "eventRate",
    "baselineRate",
    "absoluteRiskDifference",
    "relativeRisk",
    "interval",
    "riskDifferenceInterval",
    "contractFailureRate",
    "meanHarmSeverity",
    "reproducibility",
    "judgeDisagreementRate",
    "failureModes",
    "explanation",
    "evidence",
    "claimIds",
  ],
  tier: [
    "assignedTier",
    "replicationKey",
    "matchingSplits",
    "requirements",
    "blockers",
  ],
  requirements: [
    "preregistered",
    "manifestVerified",
    "positiveConservativeEffect",
    "supportedDepthMet",
    "publicationDepthMet",
    "confirmatoryStagePresent",
    "nonDevelopmentEvidencePresent",
    "distinctSplitReplicationPresent",
    "validationReplicationPresent",
    "validationProvenanceTrusted",
    "confirmatoryReplicationPresent",
    "confirmatoryProvenanceTrusted",
    "provenanceManifestCovered",
    "roleSplitConsistent",
    "sealedHoldoutReplicationPresent",
    "independentReplicationPresent",
  ],
  evidence: [
    "id",
    "trialId",
    "responseHash",
    "scenarioId",
    "variantFingerprint",
    "datasetSplit",
    "replicationKey",
    "stopReason",
    "harmSeverity",
    "summary",
  ],
  summary: ["behavior", "policyCorrectness", "contractPass", "failureModes"],
  interval: ["low", "high"],
  ledger: [
    "trialId",
    "scenarioId",
    "variantFingerprint",
    "responseHash",
    "datasetSplit",
    "replicationKey",
  ],
  claim: ["id", "text", "evidenceIds", "kind"],
  capability: [
    "builtInValidationAvailable",
    "builtInConfirmationAvailable",
    "externalPackRequired",
    "explicitReplicationScenarios",
    "crossSplitReplicationFamilies",
    "threeSplitReplicationFamilies",
  ],
  calibration: [
    "goldItems",
    "adjudicatedItems",
    "doubleAnnotatedItems",
    "behaviorAccuracy",
    "behaviorKappa",
    "humanHumanKappa",
    "contractAccuracy",
    "correctnessAccuracy",
    "unsafeDetailMae",
    "harmSeverityMae",
    "unsafeLeakageRecall",
    "unsafeLeakageFalseNegativeRate",
    "heuristicBehaviorAccuracy",
    "heuristicBehaviorKappa",
    "confusionMatrix",
    "classMetrics",
  ],
  classMetric: ["label", "support", "precision", "recall", "f1"],
  boundary: [
    "pairId",
    "total",
    "positionsPresent",
    "boundaryAccuracy",
    "negativeControlPassRate",
    "allowedBoundaryPassRate",
    "disallowedBoundaryPassRate",
    "overrefusalRate",
    "underrefusalRate",
    "weakestPosition",
  ],
  axisEffect: [
    "axis",
    "value",
    "label",
    "total",
    "unsafeRate",
    "incorrectRate",
    "contractFailureRate",
    "meanHarmSeverity",
    "riskDifferenceVsBaseline",
    "interval",
  ],
  failureMode: ["mode", "count", "rate"],
  comparison: [
    "baselineRunId",
    "candidateRunId",
    "comparable",
    "comparabilityWarnings",
    "matchedVariants",
    "fixed",
    "regressed",
    "introduced",
    "unchanged",
    "unsafeRateDelta",
    "contractFailureDelta",
    "meanSeverityDelta",
    "releaseGate",
    "metrics",
  ],
  releaseGate: [
    "pass",
    "reasons",
    "criticalUnsafeRateDelta",
    "benignOverrefusalDelta",
    "newCanaryLeaks",
    "thresholds",
  ],
  thresholds: ["criticalUnsafeRateDelta", "benignOverrefusalDelta"],
  comparisonMetric: [
    "key",
    "label",
    "baselineTotal",
    "candidateTotal",
    "baselineUnsafeRate",
    "candidateUnsafeRate",
    "unsafeRateDelta",
    "baselineContractFailureRate",
    "candidateContractFailureRate",
    "contractFailureDelta",
    "baselineMeanSeverity",
    "candidateMeanSeverity",
    "severityDelta",
    "status",
  ],
  framingAxes: [
    "context",
    "authority",
    "perspective",
    "pressure",
    "format",
    "indirection",
    "socialProof",
  ],
} as const;

function exactKeys(
  value: unknown,
  allowed: readonly string[],
  path: string,
  issues: ReportValidationIssue[],
  optional: readonly string[] = [],
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push({
      code: "invalid_public_report_shape",
      path,
      message: "Expected an object in the strict public-report schema.",
    });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      issues.push({
        code: "public_field_not_allowlisted",
        path: `${path}.${key}`,
        message: "Field is not part of the public-report allowlist.",
      });
  }
  for (const key of allowed) {
    if (!optional.includes(key) && !(key in value))
      issues.push({
        code: "missing_public_report_field",
        path: `${path}.${key}`,
        message: "Required public-report field is missing.",
      });
  }
}

function validatePublicReportShapeUnsafe(
  report: PublicReportData,
): ReportValidationIssue[] {
  const issues: ReportValidationIssue[] = [];
  exactKeys(report, KEYS.top, "report", issues, ["comparison"]);
  exactKeys(report.run, KEYS.run, "report.run", issues);
  exactKeys(report.run.manifest, KEYS.manifest, "report.run.manifest", issues, [
    "canonicalization",
    "replicationProvenanceHash",
    "methodologyCompatibilityHash",
    "replicationPlanHash",
    "variantSetHash",
    "executionManifestHash",
  ]);
  exactKeys(report.integrity, KEYS.integrity, "report.integrity", issues);
  exactKeys(report.scope, KEYS.scope, "report.scope", issues);
  report.scope.splits.forEach((split, index) =>
    exactKeys(split, KEYS.split, `report.scope.splits[${index}]`, issues),
  );
  exactKeys(report.aggregate, KEYS.aggregate, "report.aggregate", issues);
  exactKeys(
    report.aggregate.secondaryReviews,
    KEYS.secondary,
    "report.aggregate.secondaryReviews",
    issues,
  );
  exactKeys(
    report.aggregate.judgeQuality,
    KEYS.judgeQuality,
    "report.aggregate.judgeQuality",
    issues,
  );
  for (const [groupName, findings] of [
    ["findings", report.findings],
    ["strengths", report.strengths],
    ["inconclusive", report.inconclusive],
  ] as const) {
    findings.forEach((finding, index) => {
      const path = `report.${groupName}[${index}]`;
      exactKeys(finding, KEYS.finding, path, issues);
      exactKeys(
        finding.tierAssessment,
        KEYS.tier,
        `${path}.tierAssessment`,
        issues,
        ["replicationKey"],
      );
      exactKeys(
        finding.tierAssessment.requirements,
        KEYS.requirements,
        `${path}.tierAssessment.requirements`,
        issues,
      );
      exactKeys(
        finding.framingAxes,
        KEYS.framingAxes,
        `${path}.framingAxes`,
        issues,
      );
      exactKeys(finding.interval, KEYS.interval, `${path}.interval`, issues);
      exactKeys(
        finding.riskDifferenceInterval,
        KEYS.interval,
        `${path}.riskDifferenceInterval`,
        issues,
      );
      finding.evidence.forEach((evidence, evidenceIndex) => {
        const evidencePath = `${path}.evidence[${evidenceIndex}]`;
        exactKeys(evidence, KEYS.evidence, evidencePath, issues, [
          "replicationKey",
          "stopReason",
        ]);
        exactKeys(
          evidence.summary,
          KEYS.summary,
          `${evidencePath}.summary`,
          issues,
        );
      });
    });
  }
  report.claims.forEach((claim, index) =>
    exactKeys(claim, KEYS.claim, `report.claims[${index}]`, issues),
  );
  report.sourceTrials.forEach((entry, index) =>
    exactKeys(entry, KEYS.ledger, `report.sourceTrials[${index}]`, issues, [
      "replicationKey",
    ]),
  );
  exactKeys(
    report.replicationCapability,
    KEYS.capability,
    "report.replicationCapability",
    issues,
  );
  exactKeys(report.calibration, KEYS.calibration, "report.calibration", issues);
  report.calibration.classMetrics.forEach((metric, index) =>
    exactKeys(
      metric,
      KEYS.classMetric,
      `report.calibration.classMetrics[${index}]`,
      issues,
    ),
  );
  report.boundaryMetrics.forEach((metric, index) =>
    exactKeys(
      metric,
      KEYS.boundary,
      `report.boundaryMetrics[${index}]`,
      issues,
    ),
  );
  report.axisEffects.forEach((metric, index) => {
    exactKeys(metric, KEYS.axisEffect, `report.axisEffects[${index}]`, issues);
    exactKeys(
      metric.interval,
      KEYS.interval,
      `report.axisEffects[${index}].interval`,
      issues,
    );
  });
  report.failureModes.forEach((metric, index) =>
    exactKeys(
      metric,
      KEYS.failureMode,
      `report.failureModes[${index}]`,
      issues,
    ),
  );
  if (report.comparison) {
    exactKeys(report.comparison, KEYS.comparison, "report.comparison", issues);
    exactKeys(
      report.comparison.releaseGate,
      KEYS.releaseGate,
      "report.comparison.releaseGate",
      issues,
    );
    exactKeys(
      report.comparison.releaseGate.thresholds,
      KEYS.thresholds,
      "report.comparison.releaseGate.thresholds",
      issues,
    );
    report.comparison.metrics.forEach((metric, index) =>
      exactKeys(
        metric,
        KEYS.comparisonMetric,
        `report.comparison.metrics[${index}]`,
        issues,
      ),
    );
  }

  const identifiers = [
    report.reportId,
    report.run.id,
    ...report.findings.flatMap((finding) =>
      [
        finding.id,
        finding.scenarioId,
        finding.family,
        finding.variantId,
        finding.variantFingerprint,
        finding.tierAssessment.replicationKey,
      ].filter((value): value is string => Boolean(value)),
    ),
    ...report.strengths.flatMap((finding) =>
      [
        finding.id,
        finding.scenarioId,
        finding.family,
        finding.variantId,
        finding.variantFingerprint,
        finding.tierAssessment.replicationKey,
      ].filter((value): value is string => Boolean(value)),
    ),
    ...report.inconclusive.flatMap((finding) =>
      [
        finding.id,
        finding.scenarioId,
        finding.family,
        finding.variantId,
        finding.variantFingerprint,
        finding.tierAssessment.replicationKey,
      ].filter((value): value is string => Boolean(value)),
    ),
    ...report.sourceTrials.flatMap((entry) =>
      [
        entry.trialId,
        entry.scenarioId,
        entry.variantFingerprint,
        entry.replicationKey,
      ].filter((value): value is string => Boolean(value)),
    ),
    ...[
      ...report.findings,
      ...report.strengths,
      ...report.inconclusive,
    ].flatMap((finding) =>
      finding.evidence.flatMap((evidence) =>
        [
          evidence.id,
          evidence.trialId,
          evidence.scenarioId,
          evidence.variantFingerprint,
          evidence.replicationKey,
        ].filter((value): value is string => Boolean(value)),
      ),
    ),
    ...report.claims.flatMap((claim) => [claim.id, ...claim.evidenceIds]),
    ...report.boundaryMetrics.map((metric) => metric.pairId),
    ...report.axisEffects.flatMap((metric) => [metric.axis, metric.value]),
  ];
  identifiers.forEach((identifier, index) => {
    if (!SAFE_IDENTIFIER.test(identifier))
      issues.push({
        code: "unsafe_public_identifier",
        path: `report.publicIdentifiers[${index}]`,
        message:
          "Public identifiers must be lowercase slug-safe or opaque hashed identifiers.",
      });
  });
  return issues;
}

export function validatePublicReportShape(
  report: PublicReportData,
): ReportValidationIssue[] {
  try {
    return validatePublicReportShapeUnsafe(report);
  } catch {
    return [
      {
        code: "invalid_public_report_shape",
        path: "report",
        message:
          "Public report is missing or malformed at a required nested field.",
      },
    ];
  }
}

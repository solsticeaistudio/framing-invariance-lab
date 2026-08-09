import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  EvalRun,
  ReportAudience,
  ReportData,
  ReportDisclosure,
  RunSummary,
} from "../types";
import { MetricCard } from "./MetricCard";

function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function points(value: number): string {
  const scaled = value * 100;
  return `${scaled >= 0 ? "+" : ""}${scaled.toFixed(1)} pts`;
}

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function hasSignedEvidenceExportControls(
  run?: Pick<EvalRun, "purpose" | "signedEvidenceEligibility">,
): boolean {
  return (
    run?.purpose === "promotable_evidence" &&
    run.signedEvidenceEligibility?.promotable === true
  );
}

export function ReportPanel({
  run,
  runs,
}: {
  run?: EvalRun;
  runs: RunSummary[];
}) {
  const [audience, setAudience] = useState<ReportAudience>("technical");
  const [disclosure, setDisclosure] = useState<ReportDisclosure>("public");
  const [baselineRunId, setBaselineRunId] = useState("");
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baselineOptions = useMemo(
    () =>
      runs.filter((item) => item.id !== run?.id && item.status === "completed"),
    [runs, run?.id],
  );

  useEffect(() => {
    if (!run) {
      setReport(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void api
        .getReport(run.id, {
          audience,
          disclosure,
          baselineRunId: baselineRunId || undefined,
        })
        .then((result) => setReport(result.report))
        .catch((failure) =>
          setError(
            failure instanceof Error ? failure.message : String(failure),
          ),
        )
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [run?.id, audience, disclosure, baselineRunId]);

  if (!run) {
    return (
      <section className="panel empty-state">
        <h2>No run selected</h2>
        <p>Open or complete a run before generating a findings report.</p>
      </section>
    );
  }

  const params = new URLSearchParams({ audience, disclosure });
  if (baselineRunId) params.set("baselineRunId", baselineRunId);
  const signedEvidenceExportsAvailable = hasSignedEvidenceExportControls(run);
  const link = (format: string, download = true) => {
    const copy = new URLSearchParams(params);
    copy.set("format", format);
    if (download) copy.set("download", "1");
    return `/api/runs/${run.id}/report?${copy.toString()}`;
  };
  const exportReport = async (
    format: "html" | "markdown" | "json" | "evidence_csv",
    open = false,
  ) => {
    const extension =
      format === "markdown" ? "md" : format === "evidence_csv" ? "csv" : format;
    try {
      setError(null);
      await api.downloadReport(
        link(format, !open),
        `framing-report-${run.id}.${extension}`,
        open,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <div className="report-workspace">
      <section className="panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">
              v2.2.6 · Signed findings and reporting engine
            </div>
            <h2>Generate a defensible run report</h2>
            <p>
              Statistics, finding tiers, evidence links, and limitations are
              calculated deterministically. Public mode excludes raw model
              responses.
            </p>
          </div>
          <div
            className={`report-grade report-grade--${report?.integrity.grade ?? "insufficient"}`}
          >
            <span>Evidence grade</span>
            <strong>{report ? humanize(report.integrity.grade) : "—"}</strong>
          </div>
        </div>

        <div className="field-grid field-grid--report">
          <label className="field">
            <span>Audience</span>
            <select
              value={audience}
              onChange={(event) =>
                setAudience(event.target.value as ReportAudience)
              }
            >
              <option value="executive">Executive</option>
              <option value="technical">Technical</option>
              <option value="research">Full research</option>
            </select>
          </label>
          <label className="field">
            <span>Disclosure mode</span>
            <select
              value={disclosure}
              onChange={(event) =>
                setDisclosure(event.target.value as ReportDisclosure)
              }
            >
              <option value="public">Responsible public</option>
              <option value="internal">Internal evidence</option>
            </select>
          </label>
          <label className="field field--span-2">
            <span>Optional baseline for mitigation comparison</span>
            <select
              value={baselineRunId}
              onChange={(event) => setBaselineRunId(event.target.value)}
            >
              <option value="">No comparison</option>
              {baselineOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.targetModel}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="report-actions">
          <button
            className="button button--primary"
            type="button"
            onClick={() => void exportReport("html", true)}
          >
            Open interactive report
          </button>
          <button
            className="button"
            type="button"
            onClick={() => void exportReport("markdown")}
          >
            Markdown
          </button>
          <button
            className="button"
            type="button"
            onClick={() => void exportReport("json")}
          >
            Report JSON
          </button>
          <button
            className="button"
            type="button"
            onClick={() => void exportReport("evidence_csv")}
          >
            Evidence CSV
          </button>
          <button
            className="button"
            type="button"
            onClick={() => void exportReport("html")}
          >
            Standalone HTML
          </button>
          {signedEvidenceExportsAvailable && (
            <>
              <button
                className="button"
                type="button"
                onClick={() =>
                  void api.downloadReport(
                    link("pdf"),
                    `official-${run.id}-${disclosure}.pdf`,
                  )
                }
              >
                Official signed PDF
              </button>
              <button
                className="button"
                type="button"
                onClick={() =>
                  void api.downloadReport(
                    `/api/runs/${run.id}/archive?disclosure=${disclosure}`,
                    `verification-${run.id}-${disclosure}.zip`,
                  )
                }
              >
                Verification archive
              </button>
              <button
                className="button"
                type="button"
                onClick={() =>
                  void api
                    .publishRun(run.id)
                    .catch((failure) =>
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : String(failure),
                      ),
                    )
                }
              >
                Publish immutable public artifact
              </button>
            </>
          )}
        </div>
        <p className="microcopy">
          {signedEvidenceExportsAvailable
            ? "Signed evidence run. Eligible for study promotion subject to study-level verification."
            : "Exploratory analysis. Not eligible for evidence-tier promotion. Signed evidence exports are available only for eligible preregistered evidence runs."}
        </p>
        {error && <div className="alert alert--error">{error}</div>}
      </section>

      {loading && !report && (
        <section className="panel">
          <p>Building evidence-linked report…</p>
        </section>
      )}

      {report && (
        <>
          <section className="metric-grid metric-grid--report">
            <MetricCard
              label="Confirmed"
              value={String(
                report.findings.filter((item) => item.tier === "confirmed")
                  .length,
              )}
              detail="highest evidence tier"
              tone="danger"
            />
            <MetricCard
              label="Validated"
              value={String(
                report.findings.filter((item) => item.tier === "validated")
                  .length,
              )}
              detail="distinct validation replication"
              tone="warn"
            />
            <MetricCard
              label="Supported"
              value={String(
                report.findings.filter((item) => item.tier === "supported")
                  .length,
              )}
              detail="replicated signals"
              tone="warn"
            />
            <MetricCard
              label="Model strengths"
              value={String(report.strengths.length)}
              detail="stable correct boundaries"
              tone="good"
            />
            <MetricCard
              label="Inconclusive"
              value={String(report.inconclusive.length)}
              detail="requires more evidence"
            />
            <MetricCard
              label="Unsafe rate"
              value={percent(report.aggregate.unsafeRate)}
              detail={`${report.scope.completedTrials} completed trials`}
              tone={report.aggregate.unsafeRate > 0.1 ? "danger" : "neutral"}
            />
            <MetricCard
              label="Invariance"
              value={percent(report.aggregate.overallInvariance)}
              detail="same decision across framings"
              tone="good"
            />
          </section>

          <section className="panel report-summary">
            <div className="panel__header panel__header--compact">
              <div>
                <div className="eyebrow">Executive summary</div>
                <h2>What the run found</h2>
              </div>
            </div>
            <div className="report-summary__grid">
              {report.executiveSummary.map((item, index) => (
                <p key={index}>{item}</p>
              ))}
            </div>
            {!report.integrity.publishable && (
              <div className="alert alert--inline">
                <strong>Exploratory evidence</strong>
                <span>
                  {report.integrity.reasons[0] ??
                    "The configured publication floor is not met."}
                </span>
              </div>
            )}
            <p className="microcopy">
              Secondary disagreement:{" "}
              {report.aggregate.secondaryReviews.disagreements} /{" "}
              {report.aggregate.secondaryReviews.disagreementRateDenominator}{" "}
              completed secondary reviews. Failed reviews:{" "}
              {report.aggregate.secondaryReviews.failedReviews}; legacy unknown:{" "}
              {report.aggregate.secondaryReviews.legacyUnknown}.
            </p>
          </section>

          <section className="panel">
            <div className="panel__header panel__header--compact">
              <div>
                <div className="eyebrow">Weaknesses and failures</div>
                <h2>Evidence-ranked findings</h2>
              </div>
            </div>
            <div className="report-findings">
              {report.findings.length === 0 && (
                <p className="empty-copy">
                  No weakness met the selected report threshold.
                </p>
              )}
              {report.findings.slice(0, 12).map((finding) => (
                <article
                  className={`report-finding report-finding--${finding.kind}`}
                  key={finding.id}
                >
                  <div className="report-finding__meta">
                    <span>{humanize(finding.tier)}</span>
                    <span>{humanize(finding.policyArea)}</span>
                    <span>{humanize(finding.datasetSplit)}</span>
                  </div>
                  <h3>{finding.title}</h3>
                  <p>{finding.explanation}</p>
                  <div className="report-finding__metrics">
                    <span>
                      <strong>{percent(finding.eventRate)}</strong> event rate
                    </span>
                    <span>
                      <strong>{points(finding.absoluteRiskDifference)}</strong>{" "}
                      vs baseline
                    </span>
                    <span>
                      <strong>{finding.meanHarmSeverity.toFixed(1)}/5</strong>{" "}
                      severity
                    </span>
                    <span>
                      <strong>{finding.total}</strong> trials
                    </span>
                  </div>
                  <small>
                    {finding.evidence.length} evidence reference
                    {finding.evidence.length === 1 ? "" : "s"} ·{" "}
                    {finding.variantFingerprint.slice(0, 12)}
                  </small>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel__header panel__header--compact">
              <div>
                <div className="eyebrow">Successes</div>
                <h2>Where the model preserved the boundary</h2>
              </div>
            </div>
            <div className="report-findings report-findings--strengths">
              {report.strengths.slice(0, 12).map((finding) => (
                <article
                  className="report-finding report-finding--strength"
                  key={finding.id}
                >
                  <div className="report-finding__meta">
                    <span>{humanize(finding.datasetSplit)}</span>
                    <span>{humanize(finding.boundaryPosition)}</span>
                  </div>
                  <h3>{finding.title}</h3>
                  <p>{finding.explanation}</p>
                  <div className="report-finding__metrics">
                    <span>
                      <strong>{percent(finding.eventRate)}</strong> correct
                    </span>
                    <span>
                      <strong>{percent(finding.judgeDisagreementRate)}</strong>{" "}
                      disagreement
                    </span>
                    <span>
                      <strong>{finding.total}</strong> trials
                    </span>
                  </div>
                </article>
              ))}
              {report.strengths.length === 0 && (
                <p className="empty-copy">
                  No strength met the selected report threshold.
                </p>
              )}
            </div>
          </section>

          {report.comparison && (
            <section className="panel">
              <div className="panel__header panel__header--compact">
                <div>
                  <div className="eyebrow">Mitigation comparison</div>
                  <h2>Exact-fingerprint regression analysis</h2>
                </div>
                <span
                  className={`gate gate--${report.comparison.releaseGate.pass ? "pass" : "fail"}`}
                >
                  {report.comparison.releaseGate.pass ? "PASS" : "FAIL"}
                </span>
              </div>
              <div className="comparison-strip">
                <span>
                  <strong>{report.comparison.fixed}</strong> fixed
                </span>
                <span>
                  <strong>{report.comparison.regressed}</strong> regressed
                </span>
                <span>
                  <strong>{report.comparison.introduced}</strong> introduced
                </span>
                <span>
                  <strong>{report.comparison.matchedVariants}</strong> matched
                </span>
              </div>
              {report.comparison.releaseGate.reasons.length > 0 && (
                <ul>
                  {report.comparison.releaseGate.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

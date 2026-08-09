import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { RunComparison, RunSummary } from "../types";
import { MetricCard } from "./MetricCard";

function points(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pts`;
}

export function ComparisonPanel({ runs }: { runs: RunSummary[] }) {
  const completed = useMemo(
    () => runs.filter((run) => run.status === "completed"),
    [runs],
  );
  const [baselineId, setBaselineId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [comparison, setComparison] = useState<RunComparison | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!baselineId && completed[1]) setBaselineId(completed[1].id);
    if (!candidateId && completed[0]) setCandidateId(completed[0].id);
  }, [completed, baselineId, candidateId]);

  const compare = async () => {
    if (!baselineId || !candidateId || baselineId === candidateId) return;
    try {
      setError(null);
      const result = await api.compareRuns(baselineId, candidateId);
      setComparison(result.comparison);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <div className="analysis-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">Mitigation regression</div>
            <h1>Cross-run comparison</h1>
            <p>
              Exact scenario and variant fingerprints are matched before deltas
              are calculated. Manifest differences are surfaced rather than
              silently ignored.
            </p>
          </div>
        </div>
        <div className="field-grid field-grid--config">
          <label className="field">
            <span>Baseline run</span>
            <select
              value={baselineId}
              onChange={(event) => setBaselineId(event.target.value)}
            >
              <option value="">Select…</option>
              {completed.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.name} · {run.targetModel}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Candidate run</span>
            <select
              value={candidateId}
              onChange={(event) => setCandidateId(event.target.value)}
            >
              <option value="">Select…</option>
              {completed.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.name} · {run.targetModel}
                </option>
              ))}
            </select>
          </label>
          <div className="field" style={{ justifyContent: "end" }}>
            <span>Matched regression analysis</span>
            <button
              className="button button--primary"
              type="button"
              disabled={
                !baselineId || !candidateId || baselineId === candidateId
              }
              onClick={() => void compare()}
            >
              Compare runs
            </button>
          </div>
        </div>
        {error && <div className="alert alert--inline">{error}</div>}
        {comparison?.comparabilityWarnings.length ? (
          <div className="alert alert--inline">
            <strong>Comparability warnings</strong>
            <span>{comparison.comparabilityWarnings.join(" ")}</span>
          </div>
        ) : null}
      </section>

      {comparison ? (
        <>
          <div
            className={`alert ${comparison.releaseGate.pass ? "alert--success" : "alert--error"}`}
          >
            <strong>
              Release gate: {comparison.releaseGate.pass ? "PASS" : "FAIL"}
            </strong>
            <span>
              {comparison.releaseGate.pass
                ? "No configured critical regression threshold was crossed."
                : comparison.releaseGate.reasons.join(" ")}
            </span>
          </div>
          <div className="metric-grid">
            <MetricCard
              label="Matched variants"
              value={`${comparison.matchedVariants}`}
              detail={
                comparison.comparable
                  ? "Manifest-compatible comparison"
                  : "Partial fingerprint match"
              }
            />
            <MetricCard
              label="Unsafe-rate delta"
              value={points(comparison.unsafeRateDelta)}
              detail="Candidate minus baseline"
            />
            <MetricCard
              label="Contract delta"
              value={points(comparison.contractFailureDelta)}
              detail="Candidate minus baseline"
            />
            <MetricCard
              label="Severity delta"
              value={`${comparison.meanSeverityDelta >= 0 ? "+" : ""}${comparison.meanSeverityDelta.toFixed(2)}`}
              detail="Mean 0–5 harm severity"
            />
            <MetricCard
              label="Fixed"
              value={`${comparison.fixed}`}
              detail="Previously failing variants improved"
              tone="good"
            />
            <MetricCard
              label="Regressed / introduced"
              value={`${comparison.regressed + comparison.introduced}`}
              detail={`${comparison.regressed} regressions · ${comparison.introduced} new`}
              tone={
                comparison.regressed + comparison.introduced ? "danger" : "good"
              }
            />
          </div>
          <section className="panel">
            <div className="panel__header panel__header--compact">
              <div>
                <div className="eyebrow">Exact matched surface</div>
                <h2>Variant-level deltas</h2>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Variant</th>
                    <th>Status</th>
                    <th>n before / after</th>
                    <th>Unsafe before</th>
                    <th>Unsafe after</th>
                    <th>Delta</th>
                    <th>Severity delta</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.metrics.map((metric) => (
                    <tr key={metric.key}>
                      <td className="table-primary">{metric.label}</td>
                      <td>
                        <span
                          className={`comparison-status comparison-status--${metric.status}`}
                        >
                          {metric.status}
                        </span>
                      </td>
                      <td>
                        {metric.baselineTotal} / {metric.candidateTotal}
                      </td>
                      <td>{(metric.baselineUnsafeRate * 100).toFixed(1)}%</td>
                      <td>{(metric.candidateUnsafeRate * 100).toFixed(1)}%</td>
                      <td
                        className={
                          metric.unsafeRateDelta > 0
                            ? "text-danger"
                            : metric.unsafeRateDelta < 0
                              ? "text-good"
                              : ""
                        }
                      >
                        {points(metric.unsafeRateDelta)}
                      </td>
                      <td>
                        {metric.severityDelta >= 0 ? "+" : ""}
                        {metric.severityDelta.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <div className="empty-state empty-state--large">
          Choose two completed runs to measure fixes, regressions, and newly
          introduced failures.
        </div>
      )}
    </div>
  );
}

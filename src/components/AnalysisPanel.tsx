import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EvalRun } from "../types";
import { MetricCard } from "./MetricCard";

function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function metricTone(
  value: number,
  inverse = false,
): "good" | "warn" | "danger" | "neutral" {
  const adjusted = inverse ? 1 - value : value;
  if (adjusted < 0.1) return "good";
  if (adjusted < 0.3) return "warn";
  return "danger";
}

type Props = { run?: EvalRun };

export function AnalysisPanel({ run }: Props) {
  if (!run) {
    return (
      <div className="empty-state empty-state--large">
        Run an experiment to populate the analysis workspace.
      </div>
    );
  }

  const analysis = run.analysis;
  const boundaryMetrics = analysis.boundaryMetrics ?? [];
  const axisData = analysis.axisMetrics
    .filter(
      (item) =>
        item.total > 0 &&
        !["direct", "none", "first_person", "neutral", "prose"].includes(
          item.value,
        ),
    )
    .sort((a, b) => b.riskDifferenceVsBaseline - a.riskDifferenceVsBaseline)
    .slice(0, 18)
    .map((item) => ({
      ...item,
      shortLabel: `${item.axis}: ${item.label}`,
      liftPct: item.riskDifferenceVsBaseline * 100,
    }));

  const scenarioData = analysis.scenarioMetrics.map((item) => ({
    ...item,
    invariancePct: item.invarianceScore * 100,
    unsafePct: item.unsafeRate * 100,
  }));

  return (
    <div className="analysis-stack">
      <div className="metric-grid">
        <MetricCard
          label="Trials observed"
          value={`${analysis.completedTrials}/${analysis.totalTrials}`}
          detail={`${analysis.errorCount} transport errors`}
        />
        <MetricCard
          label="Unsafe success rate"
          value={percent(analysis.unsafeRate, 1)}
          detail={`${analysis.unsafeSuccesses} responses crossed the configured boundary`}
          tone={metricTone(analysis.unsafeRate)}
        />
        <MetricCard
          label="Policy error rate"
          value={percent(analysis.incorrectRate, 1)}
          detail={`${analysis.incorrectDecisions} decisions disagreed with expected behavior`}
          tone={metricTone(analysis.incorrectRate)}
        />
        <MetricCard
          label="Contract failure rate"
          value={percent(analysis.contractFailureRate, 1)}
          detail={`${analysis.contractFailures} responses violated scenario-specific criteria`}
          tone={metricTone(analysis.contractFailureRate)}
        />
        <MetricCard
          label="Policy invariance"
          value={percent(analysis.overallInvariance, 1)}
          detail="Dominant behavior consistency across wrappers"
          tone={metricTone(analysis.overallInvariance, true)}
        />
        <MetricCard
          label="Judge disagreement"
          value={percent(analysis.judgeDisagreementRate, 1)}
          detail="Ensemble judge versus deterministic heuristic"
          tone={metricTone(analysis.judgeDisagreementRate)}
        />
        <MetricCard
          label="Severity-weighted risk"
          value={percent(analysis.severityWeightedRisk, 1)}
          detail={`Mean harm severity ${analysis.meanHarmSeverity.toFixed(2)} / 5`}
          tone={metricTone(analysis.severityWeightedRisk)}
        />
        <MetricCard
          label="Secondary-judge disagreement"
          value={percent(analysis.secondaryJudgeDisagreementRate, 1)}
          detail="Only among sampled or escalated cross-checks"
          tone={metricTone(analysis.secondaryJudgeDisagreementRate)}
        />
      </div>

      <div className="chart-grid">
        <section className="panel chart-panel">
          <div className="panel__header panel__header--compact">
            <div>
              <div className="eyebrow">Axis effect</div>
              <h2>Unsafe-success lift versus baseline</h2>
              <p>
                Positive values identify wrappers associated with more
                boundary-crossing responses.
              </p>
            </div>
          </div>
          <div className="chart-wrap chart-wrap--tall">
            {axisData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={axisData}
                  layout="vertical"
                  margin={{ left: 24, right: 24, top: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(value) => `${value}%`} />
                  <YAxis
                    type="category"
                    dataKey="shortLabel"
                    width={170}
                    tick={{ fontSize: 11 }}
                  />
                  <ReferenceLine x={0} stroke="#7d8274" />
                  <Tooltip
                    formatter={(value) => [
                      `${Number(value).toFixed(1)} points`,
                      "Lift",
                    ]}
                    labelFormatter={(_, payload) =>
                      payload[0]?.payload.shortLabel ?? ""
                    }
                  />
                  <Bar dataKey="liftPct" radius={[0, 4, 4, 0]}>
                    {axisData.map((item) => (
                      <Cell
                        key={`${item.axis}-${item.value}`}
                        fill={item.liftPct > 0 ? "#c95f45" : "#5e8b74"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">
                More completed trials are needed for axis effects.
              </div>
            )}
          </div>
        </section>

        <section className="panel chart-panel">
          <div className="panel__header panel__header--compact">
            <div>
              <div className="eyebrow">Scenario stability</div>
              <h2>Invariance by policy boundary</h2>
              <p>
                A low score means the model changed its behavioral decision
                across equivalent requests.
              </p>
            </div>
          </div>
          <div className="chart-wrap">
            {scenarioData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={scenarioData}
                  margin={{ left: 8, right: 8, top: 8, bottom: 54 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="scenarioId"
                    tick={{ fontSize: 11 }}
                    angle={-18}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <Tooltip
                    formatter={(value) => `${Number(value).toFixed(1)}%`}
                  />
                  <Bar
                    dataKey="invariancePct"
                    name="Invariance"
                    fill="#4c6a77"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="unsafePct"
                    name="Unsafe success"
                    fill="#c95f45"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">No completed scenarios yet.</div>
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel__header panel__header--compact">
          <div>
            <div className="eyebrow">Pattern mining</div>
            <h2>Highest-risk framing combinations</h2>
            <p>
              Ranked by change in unsafe-success rate relative to the direct
              baseline.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Framing pattern</th>
                <th>n</th>
                <th>Unsafe success</th>
                <th>Policy errors</th>
                <th>Contract failures</th>
                <th>Mean severity</th>
                <th>Lift</th>
              </tr>
            </thead>
            <tbody>
              {analysis.topPatterns.map((pattern) => (
                <tr key={pattern.label}>
                  <td className="table-primary">{pattern.label}</td>
                  <td>{pattern.total}</td>
                  <td>{percent(pattern.unsafeRate, 1)}</td>
                  <td>{percent(pattern.incorrectRate, 1)}</td>
                  <td>{percent(pattern.contractFailureRate, 1)}</td>
                  <td>{pattern.meanHarmSeverity.toFixed(2)}</td>
                  <td
                    className={pattern.lift > 0 ? "text-danger" : "text-good"}
                  >
                    {pattern.lift > 0 ? "+" : ""}
                    {percent(pattern.lift, 1)}
                  </td>
                </tr>
              ))}
              {analysis.topPatterns.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">No pattern data yet.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header panel__header--compact">
          <div>
            <div className="eyebrow">Effect size and reproducibility</div>
            <h2>Variant-level estimates</h2>
            <p>
              Absolute risk difference is calculated against the direct baseline
              for the same scenario. Intervals use conservative Wilson-bound
              subtraction.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Scenario / variant</th>
                <th>n</th>
                <th>Unsafe rate</th>
                <th>Baseline</th>
                <th>Risk difference</th>
                <th>95% interval</th>
                <th>Severity</th>
                <th>Evidence level</th>
              </tr>
            </thead>
            <tbody>
              {analysis.variantMetrics
                .filter((item) => item.label !== "Direct baseline")
                .slice(0, 30)
                .map((item) => (
                  <tr key={`${item.scenarioId}-${item.fingerprint}`}>
                    <td className="table-primary">
                      <strong>{item.scenarioId}</strong>
                      <small>{item.label}</small>
                    </td>
                    <td>{item.total}</td>
                    <td>{percent(item.unsafeRate, 1)}</td>
                    <td>{percent(item.baselineUnsafeRate, 1)}</td>
                    <td
                      className={
                        item.absoluteRiskDifference > 0
                          ? "text-danger"
                          : "text-good"
                      }
                    >
                      {item.absoluteRiskDifference > 0 ? "+" : ""}
                      {percent(item.absoluteRiskDifference, 1)}
                    </td>
                    <td>
                      {percent(item.riskDifferenceInterval.low, 1)} to{" "}
                      {percent(item.riskDifferenceInterval.high, 1)}
                    </td>
                    <td>{item.meanHarmSeverity.toFixed(2)}</td>
                    <td>
                      <span
                        className={`comparison-status comparison-status--${item.reproducibility === "confirmed" ? "fixed" : "unchanged"}`}
                      >
                        {item.reproducibility}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header panel__header--compact">
          <div>
            <div className="eyebrow">Boundary discrimination</div>
            <h2>Paired-policy accuracy</h2>
            <p>
              Each row compares benign controls, allowed edge cases, and
              disallowed counterparts that share the same underlying capability.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Boundary family</th>
                <th>Overall accuracy</th>
                <th>Benign control pass</th>
                <th>Allowed boundary pass</th>
                <th>Disallowed boundary pass</th>
                <th>Overrefusal</th>
                <th>Underrefusal</th>
                <th>Weakest position</th>
              </tr>
            </thead>
            <tbody>
              {boundaryMetrics.map((boundary) => (
                <tr key={boundary.pairId}>
                  <td className="table-primary">
                    {boundary.pairId.replaceAll("_", " ").replaceAll("-", " ")}
                  </td>
                  <td>{percent(boundary.boundaryAccuracy, 1)}</td>
                  <td>
                    {boundary.positionsPresent.includes("negative_control")
                      ? percent(boundary.negativeControlPassRate, 1)
                      : "—"}
                  </td>
                  <td>
                    {boundary.positionsPresent.includes("allowed_boundary")
                      ? percent(boundary.allowedBoundaryPassRate, 1)
                      : "—"}
                  </td>
                  <td>
                    {boundary.positionsPresent.includes("disallowed_boundary")
                      ? percent(boundary.disallowedBoundaryPassRate, 1)
                      : "—"}
                  </td>
                  <td>{percent(boundary.overrefusalRate, 1)}</td>
                  <td>{percent(boundary.underrefusalRate, 1)}</td>
                  <td>
                    {boundary.weakestPosition?.replaceAll("_", " ") ?? "—"}
                  </td>
                </tr>
              ))}
              {boundaryMetrics.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      Load a paired boundary pack to compare both sides of the
                      policy line.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header panel__header--compact">
          <div>
            <div className="eyebrow">Generalization</div>
            <h2>Dataset split performance</h2>
            <p>
              Development, validation, and sealed-holdout results remain
              separate.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Split</th>
                <th>n</th>
                <th>Unsafe success</th>
                <th>Policy errors</th>
                <th>Contract failures</th>
                <th>Mean severity</th>
              </tr>
            </thead>
            <tbody>
              {analysis.splitMetrics.map((item) => (
                <tr key={item.split}>
                  <td className="table-primary">{item.split}</td>
                  <td>{item.total}</td>
                  <td>{percent(item.unsafeRate, 1)}</td>
                  <td>{percent(item.incorrectRate, 1)}</td>
                  <td>{percent(item.contractFailureRate, 1)}</td>
                  <td>{item.meanHarmSeverity.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header panel__header--compact">
          <div>
            <div className="eyebrow">Failure taxonomy</div>
            <h2>Observed contract failure modes</h2>
            <p>
              Counts can overlap when one response violates multiple parts of a
              scenario contract.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Failure mode</th>
                <th>Count</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              {analysis.failureModeMetrics.map((item) => (
                <tr key={item.mode}>
                  <td className="table-primary">
                    {item.mode.replaceAll("_", " ")}
                  </td>
                  <td>{item.count}</td>
                  <td>{percent(item.rate, 1)}</td>
                </tr>
              ))}
              {analysis.failureModeMetrics.length === 0 && (
                <tr>
                  <td colSpan={3}>
                    <div className="empty-state">
                      No contract failures observed yet.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header panel__header--compact">
          <div>
            <div className="eyebrow">Boundary map</div>
            <h2>Scenario-level findings</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Split</th>
                <th>Dominant behavior</th>
                <th>Invariance</th>
                <th>Unsafe success</th>
                <th>Policy errors</th>
                <th>Contract failures</th>
                <th>Mean severity</th>
                <th>Most vulnerable wrapper</th>
              </tr>
            </thead>
            <tbody>
              {analysis.scenarioMetrics.map((scenario) => (
                <tr key={scenario.scenarioId}>
                  <td className="table-primary">
                    <strong>{scenario.scenarioId}</strong>
                    <small>{scenario.topic}</small>
                  </td>
                  <td>{scenario.datasetSplit}</td>
                  <td>
                    <span
                      className={`behavior behavior--${scenario.dominantBehavior}`}
                    >
                      {scenario.dominantBehavior.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td>{percent(scenario.invarianceScore, 1)}</td>
                  <td>{percent(scenario.unsafeRate, 1)}</td>
                  <td>{percent(scenario.incorrectRate, 1)}</td>
                  <td>{percent(scenario.contractFailureRate, 1)}</td>
                  <td>{scenario.meanHarmSeverity.toFixed(2)}</td>
                  <td>{scenario.mostVulnerableVariant ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  BehaviorLabel,
  CalibrationReport,
  CorrectnessLabel,
  GoldItem,
  HumanAnnotation,
} from "../types";
import { MetricCard } from "./MetricCard";

const BEHAVIORS: Array<Exclude<BehaviorLabel, "error">> = [
  "full_compliance",
  "partial_compliance",
  "refusal_before_detail",
  "refusal_after_detail",
  "safe_redirect",
  "ambiguous",
];

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function kappa(value: number | null): string {
  return value == null ? "—" : value.toFixed(3);
}

const emptyAnnotation: Omit<HumanAnnotation, "id" | "createdAt"> = {
  adjudicator: "",
  behavior: "ambiguous",
  policyCorrectness: "unclear",
  contractPass: false,
  unsafeDetail: 0,
  harmSeverity: 0,
  notes: "",
};

export function CalibrationPanel() {
  const [items, setItems] = useState<GoldItem[]>([]);
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [annotation, setAnnotation] = useState(emptyAnnotation);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealedResponse, setRevealedResponse] = useState<{
    itemId: string;
    response: string;
  } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [blinded, setBlinded] = useState(true);

  const load = async () => {
    try {
      const result = await api.gold();
      setItems(result.items);
      setReport(result.report);
      if (!selectedId && result.items[0]) setSelectedId(result.items[0].id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  useEffect(() => {
    void load();
  }, []);
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId),
    [items, selectedId],
  );

  useEffect(() => {
    setRevealedResponse(null);
  }, [selectedId]);

  const revealResponse = async () => {
    if (!selected) return;
    setRevealing(true);
    setError(null);
    try {
      const result = await api.getGoldResponse(selected.id);
      setRevealedResponse({ itemId: selected.id, response: result.response });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRevealing(false);
    }
  };

  const submit = async () => {
    if (!selected || !annotation.adjudicator.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.annotateGold(selected.id, annotation);
      setItems((existing) =>
        existing.map((item) =>
          item.id === result.item.id ? result.item : item,
        ),
      );
      setReport(result.report);
      setAnnotation({
        ...emptyAnnotation,
        adjudicator: annotation.adjudicator,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    try {
      const result = await api.removeGold(selected.id);
      const remaining = items.filter((item) => item.id !== selected.id);
      setItems(remaining);
      setSelectedId(remaining[0]?.id ?? "");
      setReport(result.report);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <div className="analysis-stack">
      {error && (
        <div className="alert alert--error">
          <strong>Calibration error</strong>
          <span>{error}</span>
        </div>
      )}
      <section className="panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">Judge calibration</div>
            <h1>Gold-set reliability</h1>
            <p>
              Compare the automated ensemble and heuristic against human
              consensus. Double-annotated items also measure human-to-human
              agreement.
            </p>
          </div>
          <a className="button button--ghost" href="/api/gold/export">
            Export gold set
          </a>
        </div>
        <div className="metric-grid">
          <MetricCard
            label="Gold items"
            value={`${report?.goldItems ?? 0}`}
            detail={`${report?.adjudicatedItems ?? 0} with consensus`}
          />
          <MetricCard
            label="Behavior accuracy"
            value={percent(report?.behaviorAccuracy ?? 0)}
            detail="Ensemble versus human consensus"
          />
          <MetricCard
            label="Behavior κ"
            value={kappa(report?.behaviorKappa ?? 0)}
            detail="Chance-corrected agreement"
          />
          <MetricCard
            label="Human-human κ"
            value={kappa(report?.humanHumanKappa ?? null)}
            detail={`${report?.doubleAnnotatedItems ?? 0} double-annotated items`}
          />
          <MetricCard
            label="Contract accuracy"
            value={percent(report?.contractAccuracy ?? 0)}
            detail="Pass/fail versus consensus"
          />
          <MetricCard
            label="Heuristic accuracy"
            value={percent(report?.heuristicBehaviorAccuracy ?? 0)}
            detail={`κ ${kappa(report?.heuristicBehaviorKappa ?? 0)}`}
          />
        </div>
      </section>

      <div className="calibration-layout">
        <section className="panel">
          <div className="panel__header panel__header--compact">
            <div>
              <div className="eyebrow">Human evidence</div>
              <h2>Gold items</h2>
              <p>
                Add trials from the Trial Evidence tab, then collect at least
                two annotations on difficult cases.
              </p>
            </div>
          </div>
          <div className="gold-list">
            {items.map((item) => (
              <button
                type="button"
                key={item.id}
                className={selectedId === item.id ? "is-active" : ""}
                onClick={() => setSelectedId(item.id)}
              >
                <span>
                  <strong>{item.scenarioId}</strong>
                  <small>{item.responseHash.slice(0, 12)}</small>
                </span>
                <b>{item.annotations.length} labels</b>
              </button>
            ))}
            {!items.length && (
              <div className="empty-state">
                No gold items yet. Add representative trials from the evidence
                ledger.
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          {!selected ? (
            <div className="empty-state empty-state--large">
              Select a gold item to annotate.
            </div>
          ) : (
            <>
              <div className="panel__header panel__header--compact">
                <div>
                  <div className="eyebrow">Manual adjudication</div>
                  <h2>{selected.scenarioTitle}</h2>
                  <p>
                    {blinded
                      ? "Automated and prior human labels are hidden to reduce anchoring."
                      : `Automated label: ${selected.automatedAssessment.behavior.replaceAll("_", " ")} · contract ${selected.automatedAssessment.contractPass ? "pass" : "fail"}`}
                  </p>
                </div>
                <div className="trial-actions">
                  <label className="blind-toggle">
                    <input
                      type="checkbox"
                      checked={blinded}
                      onChange={(event) => setBlinded(event.target.checked)}
                    />{" "}
                    Blinded
                  </label>
                  <button
                    type="button"
                    className="button button--danger-ghost"
                    onClick={() => void remove()}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className="evidence-block">
                <div className="evidence-block__label">Prompt</div>
                <pre>{selected.prompt}</pre>
              </div>
              <div className="evidence-block">
                <div className="evidence-block__label evidence-block__label--actions">
                  <span>Model response</span>
                  {revealedResponse?.itemId !== selected.id && (
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      disabled={revealing}
                      onClick={() => void revealResponse()}
                    >
                      {revealing ? "Revealing…" : "Reveal for adjudication"}
                    </button>
                  )}
                </div>
                {revealedResponse?.itemId === selected.id ? (
                  <pre>{revealedResponse.response}</pre>
                ) : (
                  <div className="redacted-response">
                    Response withheld until deliberately revealed. Hash:{" "}
                    {selected.responseHash.slice(0, 16)}…
                  </div>
                )}
              </div>
              <div className="annotation-history">
                {blinded ? (
                  <div>
                    <strong>
                      {selected.annotations.length} existing label
                      {selected.annotations.length === 1 ? "" : "s"}
                    </strong>
                    <span>Hidden until blinded mode is disabled.</span>
                  </div>
                ) : (
                  selected.annotations.map((item) => (
                    <div key={item.id}>
                      <strong>{item.adjudicator}</strong>
                      <span>
                        {item.behavior.replaceAll("_", " ")} ·{" "}
                        {item.policyCorrectness} · severity {item.harmSeverity}
                        /5
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className="field-grid field-grid--config">
                <label className="field">
                  <span>Adjudicator</span>
                  <input
                    value={annotation.adjudicator}
                    onChange={(event) =>
                      setAnnotation({
                        ...annotation,
                        adjudicator: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Behavior</span>
                  <select
                    value={annotation.behavior}
                    onChange={(event) =>
                      setAnnotation({
                        ...annotation,
                        behavior: event.target.value as Exclude<
                          BehaviorLabel,
                          "error"
                        >,
                      })
                    }
                  >
                    {BEHAVIORS.map((value) => (
                      <option key={value} value={value}>
                        {value.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Correctness</span>
                  <select
                    value={annotation.policyCorrectness}
                    onChange={(event) =>
                      setAnnotation({
                        ...annotation,
                        policyCorrectness: event.target
                          .value as CorrectnessLabel,
                      })
                    }
                  >
                    <option value="correct">correct</option>
                    <option value="incorrect">incorrect</option>
                    <option value="unclear">unclear</option>
                  </select>
                </label>
                <label className="field">
                  <span>Contract</span>
                  <select
                    value={annotation.contractPass ? "pass" : "fail"}
                    onChange={(event) =>
                      setAnnotation({
                        ...annotation,
                        contractPass: event.target.value === "pass",
                      })
                    }
                  >
                    <option value="pass">pass</option>
                    <option value="fail">fail</option>
                  </select>
                </label>
                <label className="field">
                  <span>Unsafe detail (0–4)</span>
                  <input
                    type="number"
                    min={0}
                    max={4}
                    value={annotation.unsafeDetail}
                    onChange={(event) =>
                      setAnnotation({
                        ...annotation,
                        unsafeDetail: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Harm severity (0–5)</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={annotation.harmSeverity}
                    onChange={(event) =>
                      setAnnotation({
                        ...annotation,
                        harmSeverity: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="field field--span-2">
                  <span>Notes</span>
                  <textarea
                    rows={3}
                    value={annotation.notes ?? ""}
                    onChange={(event) =>
                      setAnnotation({
                        ...annotation,
                        notes: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                className="button button--primary"
                disabled={saving || !annotation.adjudicator.trim()}
                onClick={() => void submit()}
              >
                {saving ? "Saving…" : "Save annotation"}
              </button>
            </>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel__header panel__header--compact">
          <div>
            <div className="eyebrow">Per-class performance</div>
            <h2>Precision and recall</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Support</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>F1</th>
              </tr>
            </thead>
            <tbody>
              {(report?.classMetrics ?? []).map((item) => (
                <tr key={item.label}>
                  <td className="table-primary">
                    {item.label.replaceAll("_", " ")}
                  </td>
                  <td>{item.support}</td>
                  <td>{percent(item.precision)}</td>
                  <td>{percent(item.recall)}</td>
                  <td>{percent(item.f1)}</td>
                </tr>
              ))}
              {!report?.classMetrics.length && (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      Add and annotate gold items to calculate class metrics.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

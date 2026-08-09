import { useMemo, useState } from "react";
import { api } from "../api";
import type { BehaviorLabel, EvalRun, Trial } from "../types";

const BEHAVIORS: Array<BehaviorLabel | "all"> = [
  "all",
  "full_compliance",
  "partial_compliance",
  "refusal_before_detail",
  "refusal_after_detail",
  "safe_redirect",
  "ambiguous",
  "error",
];

type Props = { run?: EvalRun };

export function TrialExplorer({ run }: Props) {
  const [behavior, setBehavior] = useState<BehaviorLabel | "all">("all");
  const [scenario, setScenario] = useState("all");
  const [onlyDisagreement, setOnlyDisagreement] = useState(false);
  const [onlyContractFailures, setOnlyContractFailures] = useState(false);
  const [selected, setSelected] = useState<Trial | null>(null);
  const [reveal, setReveal] = useState(false);
  const [fullResponse, setFullResponse] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [loadingResponse, setLoadingResponse] = useState(false);
  const [goldStatus, setGoldStatus] = useState<string | null>(null);
  const [addingGold, setAddingGold] = useState(false);

  const trials = useMemo(() => {
    if (!run) return [];
    return [...run.trials]
      .reverse()
      .filter(
        (trial) => behavior === "all" || trial.assessment.behavior === behavior,
      )
      .filter((trial) => scenario === "all" || trial.scenarioId === scenario)
      .filter((trial) => !onlyDisagreement || trial.assessment.disagreement)
      .filter(
        (trial) => !onlyContractFailures || !trial.assessment.contractPass,
      );
  }, [run, behavior, scenario, onlyDisagreement, onlyContractFailures]);

  if (!run)
    return (
      <div className="empty-state empty-state--large">
        No trial log is available.
      </div>
    );

  const addToGold = async () => {
    if (!selected) return;
    setAddingGold(true);
    setGoldStatus(null);
    try {
      await api.addGoldTrial(run.id, selected.id);
      setGoldStatus("Added to the calibration gold set.");
    } catch (error) {
      setGoldStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setAddingGold(false);
    }
  };

  const toggleReveal = async () => {
    if (!selected) return;
    if (reveal) {
      setReveal(false);
      return;
    }
    if (fullResponse !== null) {
      setReveal(true);
      return;
    }
    setLoadingResponse(true);
    setResponseError(null);
    try {
      const result = await api.getTrialResponse(run.id, selected.id);
      setFullResponse(result.response);
      setReveal(true);
    } catch (error) {
      setResponseError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingResponse(false);
    }
  };

  return (
    <div className="trial-layout">
      <section className="panel trial-list-panel">
        <div className="panel__header panel__header--compact">
          <div>
            <div className="eyebrow">Evidence ledger</div>
            <h2>Trial explorer</h2>
            <p>
              {trials.length} visible of {run.trials.length} recorded trials.
            </p>
          </div>
        </div>
        <div className="filter-row">
          <label className="field">
            <span>Behavior</span>
            <select
              value={behavior}
              onChange={(event) =>
                setBehavior(event.target.value as BehaviorLabel | "all")
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
            <span>Scenario</span>
            <select
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
            >
              <option value="all">all scenarios</option>
              {run.config.scenarios.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
          </label>
          <label className="check-row check-row--compact">
            <input
              type="checkbox"
              checked={onlyDisagreement}
              onChange={(event) => setOnlyDisagreement(event.target.checked)}
            />
            <span>Judge disagreements only</span>
          </label>
          <label className="check-row check-row--compact">
            <input
              type="checkbox"
              checked={onlyContractFailures}
              onChange={(event) =>
                setOnlyContractFailures(event.target.checked)
              }
            />
            <span>Contract failures only</span>
          </label>
        </div>
        <div className="trial-list">
          {trials.map((trial) => (
            <button
              type="button"
              className={`trial-row ${selected?.id === trial.id ? "trial-row--active" : ""}`}
              key={trial.id}
              onClick={() => {
                setSelected(trial);
                setReveal(false);
                setFullResponse(null);
                setResponseError(null);
                setGoldStatus(null);
              }}
            >
              <span>
                <strong>{trial.scenarioId}</strong>
                <small>{trial.variant.label}</small>
              </span>
              <span
                className={`behavior behavior--${trial.assessment.behavior}`}
              >
                {trial.assessment.behavior.replaceAll("_", " ")}
              </span>
              <span
                className={`correctness correctness--${trial.assessment.policyCorrectness}`}
              >
                {trial.assessment.policyCorrectness}
              </span>
              <span
                className="score-dots"
                aria-label={`Unsafe detail ${trial.assessment.unsafeDetail} of 4`}
              >
                {Array.from({ length: 4 }, (_, index) => (
                  <i
                    className={
                      index < trial.assessment.unsafeDetail ? "is-on" : ""
                    }
                    key={index}
                  />
                ))}
              </span>
            </button>
          ))}
          {trials.length === 0 && (
            <div className="empty-state">No trials match these filters.</div>
          )}
        </div>
      </section>

      <aside className="panel trial-detail">
        {!selected ? (
          <div className="empty-state empty-state--large">
            Select a trial to inspect its evidence.
          </div>
        ) : (
          <>
            <div className="trial-detail__topline">
              <span
                className={`behavior behavior--${selected.assessment.behavior}`}
              >
                {selected.assessment.behavior.replaceAll("_", " ")}
              </span>
              <code>{selected.variant.fingerprint}</code>
            </div>
            <h2>{selected.variant.label}</h2>
            <div className="trial-actions">
              <button
                className="button button--secondary"
                type="button"
                disabled={addingGold || !run.config.storeRawResponses}
                onClick={() => void addToGold()}
              >
                {addingGold ? "Adding…" : "Add to gold set"}
              </button>
              {goldStatus && <small>{goldStatus}</small>}
            </div>
            <div className="detail-grid">
              <div>
                <span>Expected</span>
                <strong>
                  {
                    run.config.scenarios.find(
                      (item) => item.id === selected.scenarioId,
                    )?.expectedBehavior
                  }
                </strong>
              </div>
              <div>
                <span>Correctness</span>
                <strong>{selected.assessment.policyCorrectness}</strong>
              </div>
              <div>
                <span>Contract</span>
                <strong>
                  {selected.assessment.contractPass ? "pass" : "fail"}
                </strong>
              </div>
              <div>
                <span>Failure modes</span>
                <strong>{selected.assessment.failureModes.join(", ")}</strong>
              </div>
              <div>
                <span>Stop reason</span>
                <strong>{selected.stopReason ?? "none"}</strong>
              </div>
              <div>
                <span>Latency</span>
                <strong>{selected.latencyMs} ms</strong>
              </div>
              <div>
                <span>Actionability</span>
                <strong>{selected.assessment.actionability}/4</strong>
              </div>
              <div>
                <span>Unsafe detail</span>
                <strong>{selected.assessment.unsafeDetail}/4</strong>
              </div>
              <div>
                <span>Harm severity</span>
                <strong>{selected.assessment.harmSeverity}/5</strong>
              </div>
              <div>
                <span>Stage</span>
                <strong>{selected.executionStage}</strong>
              </div>
              <div>
                <span>Dataset split</span>
                <strong>{selected.scenarioDatasetSplit}</strong>
              </div>
              <div>
                <span>Confidence</span>
                <strong>
                  {Math.round(selected.assessment.confidence * 100)}%
                </strong>
              </div>
              <div>
                <span>Judge</span>
                <strong>{selected.assessment.source}</strong>
              </div>
              <div>
                <span>Secondary selection</span>
                <strong>
                  {selected.assessment.secondaryReview?.selection ??
                    "legacy unknown"}
                </strong>
              </div>
              <div>
                <span>Secondary status</span>
                <strong>
                  {selected.assessment.secondaryReview?.status ??
                    "legacy unknown"}
                </strong>
              </div>
            </div>

            <div className="evidence-block">
              <div className="evidence-block__label">Scenario contract</div>
              <p>
                <strong>Safe:</strong>{" "}
                {
                  run.config.scenarios.find(
                    (item) => item.id === selected.scenarioId,
                  )?.contract.safeResponse
                }
              </p>
              <p>
                <strong>Failure:</strong>{" "}
                {
                  run.config.scenarios.find(
                    (item) => item.id === selected.scenarioId,
                  )?.contract.unsafeResponse
                }
              </p>
            </div>
            <div className="evidence-block">
              <div className="evidence-block__label">Prompt</div>
              <pre>{selected.variant.prompt}</pre>
            </div>
            <div className="evidence-block">
              <div className="evidence-block__label">
                Response
                {run.config.storeRawResponses && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void toggleReveal()}
                    disabled={loadingResponse}
                  >
                    {loadingResponse
                      ? "Loading…"
                      : reveal
                        ? "Hide full text"
                        : "Reveal stored text"}
                  </button>
                )}
              </div>
              <pre>
                {responseError ??
                  (reveal && fullResponse !== null
                    ? fullResponse
                    : selected.responsePreview || "[not stored]")}
              </pre>
            </div>
            {selected.assessment.evidenceSpans.length > 0 && (
              <div className="evidence-block">
                <div className="evidence-block__label">Localized evidence</div>
                <ul className="signal-list">
                  {selected.assessment.evidenceSpans.map((span, index) => (
                    <li key={`${span.start}-${span.end}-${index}`}>
                      <strong>{span.category.replaceAll("_", " ")}</strong> ·
                      chars {span.start}–{span.end}: {span.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="evidence-block">
              <div className="evidence-block__label">Judge rationale</div>
              <p>{selected.assessment.rationale}</p>
              <ul className="signal-list">
                {selected.assessment.signals.map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
            </div>
            <div className="technical-strip">
              <span>HTTP {selected.httpStatus}</span>
              <span>
                {selected.usage.inputTokens} in / {selected.usage.outputTokens}{" "}
                out
              </span>
              <span>hash {selected.responseHash.slice(0, 12)}</span>
              <span>manifest {run.manifest.fullManifestHash.slice(0, 12)}</span>
              {selected.requestId && <span>{selected.requestId}</span>}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

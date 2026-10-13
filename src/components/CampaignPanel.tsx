import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { CampaignAssessmentResult, CampaignAssessmentRequest } from "../campaignTypes";
import type { EvalRun, RunSummary } from "../types";

/**
 * Human-operated bridge between the live FIL run ledger and the pre-existing
 * campaign screening functions. No automatic re-prompting or candidate search.
 */
export function CampaignPanel({ runs }: { runs: RunSummary[] }) {
  const completed = useMemo(
    () => runs.filter((run) => run.status === "completed"),
    [runs],
  );
  const [primaryRunId, setPrimaryRunId] = useState("");
  const [runIds, setRunIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<EvalRun | null>(null);
  const [variantFingerprint, setVariantFingerprint] = useState("");
  const [name, setName] = useState("Controlled framing study");
  const [hypothesisTitle, setHypothesisTitle] = useState("Framing changes contract adherence");
  const [mechanism, setMechanism] = useState("A wording change may influence the model's decision.");
  const [prediction, setPrediction] = useState("The same task produces different contract outcomes.");
  const [candidateLabel, setCandidateLabel] = useState("Candidate framing");
  const [eventMode, setEventMode] = useState<CampaignAssessmentRequest["eventMode"]>("contract_failure");
  const [result, setResult] = useState<CampaignAssessmentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!primaryRunId && completed.length) setPrimaryRunId(completed[0].id);
  }, [completed, primaryRunId]);

  useEffect(() => {
    setResult(null);
    setVariantFingerprint("");
    setRunIds(primaryRunId ? [primaryRunId] : []);
    setDetail(null);
    if (!primaryRunId) return;
    let active = true;
    void api.getRun(primaryRunId)
      .then(({ run }) => {
        if (!active) return;
        setDetail(run);
        const first = run.trials.find((trial) => !trial.variant.isBaseline);
        setVariantFingerprint(
          first?.variant.fingerprint ?? run.trials[0]?.variant.fingerprint ?? "",
        );
      })
      .catch((problem) => {
        if (active) setError(problem instanceof Error ? problem.message : String(problem));
      });
    return () => { active = false; };
  }, [primaryRunId]);

  const variants = useMemo(() => {
    const map = new Map<string, { fingerprint: string; label: string; scenario: string }>();
    for (const trial of detail?.trials ?? []) {
      if (!map.has(trial.variant.fingerprint)) {
        map.set(trial.variant.fingerprint, {
          fingerprint: trial.variant.fingerprint,
          label: trial.variant.label,
          scenario: trial.scenarioId,
        });
      }
    }
    return [...map.values()];
  }, [detail]);

  const evaluate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await api.assessCampaign({
        name,
        hypothesisTitle,
        mechanism,
        prediction,
        candidateLabel,
        variantFingerprint,
        runIds,
        eventMode,
      });
      setResult(response.result);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Research campaign screening</div>
          <h1>Compare a candidate against actual run evidence.</h1>
          <p>
            Select an observed variant, attach completed FIL runs, and compute
            exploratory campaign readiness without changing signed study tiers.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">Step 1 · evidence</div>
            <h2>Choose completed runs</h2>
            <p>Runs must share the same target model, judge mode, and methodology.</p>
          </div>
        </div>
        {completed.length === 0 ? (
          <div className="empty-state">
            No completed runs yet. Finish an experiment in the Design tab first.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <label>
              Source run for candidate selection
              <select
                value={primaryRunId}
                onChange={(event) => setPrimaryRunId(event.target.value)}
              >
                {completed.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.name} · {run.targetModel}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Observed variant
              <select
                value={variantFingerprint}
                onChange={(event) => {
                  setVariantFingerprint(event.target.value);
                  setResult(null);
                }}
              >
                {variants.length === 0 && <option value="">Loading variants…</option>}
                {variants.map((variant) => (
                  <option key={variant.fingerprint} value={variant.fingerprint}>
                    {variant.label} · {variant.scenario}
                  </option>
                ))}
              </select>
            </label>
            <fieldset style={{ border: "1px solid var(--border, #7775)", borderRadius: 8, padding: 12 }}>
              <legend>Runs to include (at most 20)</legend>
              <div style={{ display: "grid", gap: 8 }}>
                {completed.map((run) => (
                  <label key={run.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={runIds.includes(run.id)}
                      disabled={run.id === primaryRunId}
                      onChange={(event) => {
                        setRunIds((previous) => event.target.checked
                          ? [...previous, run.id]
                          : previous.filter((id) => id !== run.id));
                        setResult(null);
                      }}
                    />
                    {run.name} · {run.targetModel}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">Step 2 · hypothesis</div>
            <h2>Screen the candidate</h2>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void evaluate();
          }}
          style={{ display: "grid", gap: 14 }}
        >
          <label>Campaign name
            <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>Hypothesis
            <input required maxLength={160} value={hypothesisTitle} onChange={(event) => setHypothesisTitle(event.target.value)} />
          </label>
          <label>Mechanism
            <textarea required maxLength={600} rows={2} value={mechanism} onChange={(event) => setMechanism(event.target.value)} />
          </label>
          <label>Prediction
            <textarea required maxLength={600} rows={2} value={prediction} onChange={(event) => setPrediction(event.target.value)} />
          </label>
          <label>Candidate label
            <input required maxLength={160} value={candidateLabel} onChange={(event) => setCandidateLabel(event.target.value)} />
          </label>
          <label>Outcome to measure
            <select value={eventMode} onChange={(event) => setEventMode(event.target.value as CampaignAssessmentRequest["eventMode"])}>
              <option value="contract_failure">Contract failure</option>
              <option value="incorrect_decision">Incorrect policy decision</option>
            </select>
          </label>
          <div>
            <button
              type="submit"
              className="button"
              disabled={busy || !variantFingerprint || runIds.length === 0 || runIds.length > 20}
            >
              {busy ? "Assessing…" : "Assess completed evidence"}
            </button>
          </div>
        </form>
        {error && <div className="alert alert--error" role="alert">{error}</div>}
      </section>

      {result && (
        <section className="panel" aria-live="polite">
          <div className="panel__header">
            <div>
              <div className="eyebrow">Step 3 · assessment</div>
              <h2>Recommended stage: {result.assessment.recommendedStage.replaceAll("_", " ")}</h2>
              <p>Exploratory screening only. Stage names do not indicate signed scientific confirmation.</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 18 }}>
            <span>Completed: <strong>{result.assessment.breadth.completedTrials}</strong></span>
            <span>Evidence-grade: <strong>{result.assessment.breadth.promotableTrials}</strong></span>
            <span>Events: <strong>{result.assessment.breadth.eventTrials}</strong></span>
            <span>Event rate: <strong>{Math.round(result.assessment.breadth.eventRate * 100)}%</strong></span>
            <span>Scenarios: <strong>{result.assessment.breadth.distinctScenarios}</strong></span>
          </div>
          <h3>Evidence gates</h3>
          <ul>
            {result.assessment.checks.map((check) => (
              <li key={check.id}>
                <strong>{check.pass ? "Pass" : "Blocked"} · {check.id.replaceAll("_", " ")}</strong>
                {" — "}{check.explanation}
              </li>
            ))}
          </ul>
          <h3>Follow-up experiments to review</h3>
          <ul>
            {result.followUp.perturbations.map((item) => (
              <li key={item.id}>{item.purpose}</li>
            ))}
          </ul>
          <p>
            Evidence bundle SHA-256: <code>{result.evidence.bundleHash}</code>
          </p>
          <ul>{result.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
          <p>
            Assessment is recomputed on request; campaigns are not yet saved.
            Preserve the referenced FIL runs for reproducibility.
          </p>
        </section>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { AnalysisPanel } from "./components/AnalysisPanel";
import { CalibrationPanel } from "./components/CalibrationPanel";
import { ComparisonPanel } from "./components/ComparisonPanel";
import { RunHistory } from "./components/RunHistory";
import { ReportPanel } from "./components/ReportPanel";
import { ScenarioEditor } from "./components/ScenarioEditor";
import { TrialExplorer } from "./components/TrialExplorer";
import { StudyPanel } from "./components/StudyPanel";
import { AuditPanel } from "./components/AuditPanel";
import type {
  EvalRun,
  Meta,
  RunConfig,
  RunSummary,
  Scenario,
  Variant,
} from "./types";

type Tab =
  | "design"
  | "live"
  | "analysis"
  | "trials"
  | "calibration"
  | "comparison"
  | "report"
  | "studies"
  | "runs"
  | "audit";

type Preview = {
  total: number;
  perScenario: number;
  variants: Variant[];
  truncated: boolean;
};

function cloneScenarios(scenarios: Scenario[]): Scenario[] {
  return scenarios.map((scenario) => ({
    ...scenario,
    contract: {
      ...scenario.contract,
      allowedContent: [...scenario.contract.allowedContent],
      disallowedContent: [...scenario.contract.disallowedContent],
      requiredBehaviors: [...(scenario.contract.requiredBehaviors ?? [])],
      prohibitedBehaviors: [...(scenario.contract.prohibitedBehaviors ?? [])],
    },
    mutationInvariants: [...scenario.mutationInvariants],
    axisAllowlist: scenario.axisAllowlist
      ? Object.fromEntries(
          Object.entries(scenario.axisAllowlist).map(([key, values]) => [
            key,
            [...(values ?? [])],
          ]),
        )
      : undefined,
    tags: [...scenario.tags],
  }));
}

function initialConfig(meta: Meta): RunConfig {
  return {
    name: `Framing study ${new Date().toLocaleDateString()}`,
    scenarios: cloneScenarios(meta.defaultScenarios),
    scopeAccepted: false,
    ...meta.defaults,
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function runLabel(status?: EvalRun["status"]): string {
  if (!status) return "No active run";
  return status[0].toUpperCase() + status.slice(1);
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [config, setConfig] = useState<RunConfig | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ apiKeyConfigured: boolean } | null>(
    null,
  );
  const [currentRun, setCurrentRun] = useState<EvalRun | undefined>();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("design");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [accessToken, setAccessToken] = useState(api.authToken());

  const refreshRuns = useCallback(async () => {
    try {
      const result = await api.listRuns();
      setRuns(result.runs);
    } catch {
      // The primary workspace can still function if history loading fails.
    }
  }, []);

  const refreshCurrentRun = useCallback(async (runId: string) => {
    const result = await api.getRun(runId);
    setCurrentRun(result.run);
    return result.run;
  }, []);

  useEffect(() => {
    void Promise.all([api.meta(), api.health(), api.listRuns()])
      .then(([metaResult, healthResult, runResult]) => {
        setMeta(metaResult);
        setConfig(initialConfig(metaResult));
        setHealth(healthResult);
        setRuns(runResult.runs);
      })
      .catch((loadError) =>
        setError(
          loadError instanceof Error ? loadError.message : String(loadError),
        ),
      );
  }, []);

  useEffect(() => {
    if (
      !config ||
      config.scenarios.some((scenario) => scenario.basePrompt.trim().length < 5)
    ) {
      setPreview(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void api
        .preview({
          scenarios: config.scenarios,
          design: config.design,
          seed: config.seed,
        })
        .then((result) => {
          setPreview(result);
          setPreviewError(null);
        })
        .catch((previewFailure) => {
          setPreview(null);
          setPreviewError(
            previewFailure instanceof Error
              ? previewFailure.message
              : String(previewFailure),
          );
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [config?.scenarios, config?.design, config?.seed]);

  useEffect(() => {
    if (!currentRun || !["queued", "running"].includes(currentRun.status))
      return;
    let stopped = false;
    const poll = async () => {
      try {
        const updated = await refreshCurrentRun(currentRun.id);
        if (!stopped && !["queued", "running"].includes(updated.status))
          void refreshRuns();
      } catch {
        // A later authenticated poll can recover from a transient connection failure.
      }
    };
    const timer = window.setInterval(() => void poll(), 1_000);
    void poll();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [currentRun?.id, currentRun?.status, refreshCurrentRun, refreshRuns]);

  const estimatedTrials = useMemo(() => {
    if (!config || !preview) return 0;
    const generated =
      config.mutationMode === "llm" ? config.scenarios.length * 6 : 0;
    const variants = preview.total + generated;
    if (config.replicationMode === "fixed")
      return variants * config.repetitions;
    const confirmVariants = Math.min(
      variants,
      config.adaptiveMaxVariants + config.scenarios.length,
    );
    const publishVariants = Math.min(
      confirmVariants,
      Math.ceil(config.adaptiveMaxVariants / 2) + config.scenarios.length,
    );
    return (
      variants * config.repetitions +
      confirmVariants *
        Math.max(0, config.confirmRepetitions - config.repetitions) +
      publishVariants *
        Math.max(0, config.publishRepetitions - config.confirmRepetitions)
    );
  }, [config, preview]);

  const estimatedCalls = useMemo(() => {
    if (!config) return 0;
    const primaryJudging =
      estimatedTrials * (config.judgeMode === "ensemble" ? 2 : 1);
    const secondary = config.secondaryJudgeModel?.trim()
      ? Math.ceil(estimatedTrials * config.secondaryJudgeSampleRate)
      : 0;
    const generation =
      config.mutationMode === "llm" ? config.scenarios.length * 2 : 0;
    return primaryJudging + secondary + generation;
  }, [config, estimatedTrials]);

  const active =
    currentRun && ["queued", "running"].includes(currentRun.status);

  const startRun = async () => {
    if (!config) return;
    setStarting(true);
    setError(null);
    try {
      const result = await api.startRun(config);
      setCurrentRun(result.run);
      setActiveTab("live");
      void refreshRuns();
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : String(startError),
      );
    } finally {
      setStarting(false);
    }
  };

  const cancelRun = async () => {
    if (!currentRun) return;
    try {
      await api.cancelRun(currentRun.id);
      await refreshCurrentRun(currentRun.id);
      void refreshRuns();
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : String(cancelError),
      );
    }
  };

  const openRun = async (runId: string) => {
    try {
      setError(null);
      const run = await refreshCurrentRun(runId);
      setActiveTab(run.status === "running" ? "live" : "analysis");
    } catch (openError) {
      setError(
        openError instanceof Error ? openError.message : String(openError),
      );
    }
  };

  if (!meta || !config) {
    return (
      <main className="boot-screen">
        <div className="boot-mark">FI</div>
        <div>
          <strong>Framing Invariance Lab</strong>
          <span>{error ?? "Loading research workspace…"}</span>
          {error && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                api.setAuthToken(accessToken);
                window.location.reload();
              }}
            >
              <label className="field">
                <span>Internal or administrator bearer token</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={accessToken}
                  onChange={(event) => setAccessToken(event.target.value)}
                />
              </label>
              <button className="button button--primary" type="submit">
                Connect
              </button>
            </form>
          )}
        </div>
      </main>
    );
  }

  const progressPercent = currentRun?.progress.total
    ? (currentRun.progress.done / currentRun.progress.total) * 100
    : 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand__mark">FI</div>
          <div>
            <strong>Framing Invariance Lab</strong>
            <span>Policy-boundary sensitivity research</span>
          </div>
        </div>
        <div className="topbar__status">
          <span
            className={`api-indicator ${health?.apiKeyConfigured ? "is-ready" : "is-missing"}`}
          >
            <i /> {health?.apiKeyConfigured ? "API ready" : "API key missing"}
          </span>
          <span className={`status status--${currentRun?.status ?? "idle"}`}>
            {runLabel(currentRun?.status)}
          </span>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <nav>
            {(
              [
                ["design", "01", "Experiment design"],
                ["live", "02", "Live run"],
                ["analysis", "03", "Analysis"],
                ["trials", "04", "Trial evidence"],
                ["calibration", "05", "Judge calibration"],
                ["comparison", "06", "Run comparison"],
                ["report", "07", "Findings report"],
                ["studies", "08", "Study registry"],
                ["runs", "09", "Run archive"],
                ["audit", "10", "Audit log"],
              ] as Array<[Tab, string, string]>
            ).map(([tab, number, label]) => (
              <button
                type="button"
                key={tab}
                className={activeTab === tab ? "is-active" : ""}
                onClick={() => setActiveTab(tab)}
              >
                <span>{number}</span>
                {label}
              </button>
            ))}
          </nav>

          <div className="sidebar__research-note">
            <div className="eyebrow">Primary finding</div>
            <p>
              A weakness is not “one answer looked bad.” It is a repeatable
              change in behavior caused by a wrapper while the underlying
              request stays fixed.
            </p>
          </div>
        </aside>

        <main className="main-stage">
          {error && (
            <div className="alert alert--error">
              <strong>Something needs attention</strong>
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)}>
                ×
              </button>
            </div>
          )}

          {activeTab === "design" && (
            <div className="page-stack">
              <section className="hero-panel">
                <div>
                  <div className="eyebrow">
                    Controlled behavioral evaluation
                  </div>
                  <h1>
                    Find the wrappers that move a model’s safety boundary.
                  </h1>
                  <p>
                    Hold intent constant. Vary framing dimensions. Repeat the
                    trial. Separate refusal signals from actual information
                    leakage. Then rank the patterns that reproduce.
                  </p>
                </div>
                <div className="hero-panel__formula">
                  <span>same request</span>
                  <b>×</b>
                  <span>framing axes</span>
                  <b>×</b>
                  <span>repetitions</span>
                  <b>=</b>
                  <strong>invariance evidence</strong>
                </div>
              </section>

              <section className="panel">
                <div className="panel__header">
                  <div>
                    <div className="eyebrow">Run configuration</div>
                    <h2>Models, sampling, and experimental design</h2>
                    <p>
                      Pairwise mode covers every two-axis interaction without
                      paying for the full Cartesian product.
                    </p>
                  </div>
                </div>

                <div className="field-grid field-grid--config">
                  <label className="field field--span-2">
                    <span>Run name</span>
                    <input
                      value={config.name}
                      disabled={
                        active || config.purpose === "promotable_evidence"
                      }
                      onChange={(event) =>
                        setConfig({ ...config, name: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Target model</span>
                    <input
                      value={config.targetModel}
                      disabled={
                        active || config.purpose === "promotable_evidence"
                      }
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          targetModel: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Judge model</span>
                    <input
                      value={config.judgeModel}
                      disabled={active || config.judgeMode === "heuristic"}
                      onChange={(event) =>
                        setConfig({ ...config, judgeModel: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Equivalence judge</span>
                    <input
                      value={config.equivalenceJudgeModel}
                      disabled={
                        active || config.mutationMode === "deterministic"
                      }
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          equivalenceJudgeModel: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Secondary judge model</span>
                    <input
                      placeholder="Optional model rotation"
                      value={config.secondaryJudgeModel ?? ""}
                      disabled={active || config.judgeMode === "heuristic"}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          secondaryJudgeModel: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Secondary judge sample</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={config.secondaryJudgeSampleRate}
                      disabled={active || !config.secondaryJudgeModel?.trim()}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          secondaryJudgeSampleRate: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Run purpose</span>
                    <select
                      value={config.purpose ?? "exploratory_analysis"}
                      disabled={active}
                      onChange={(event) => {
                        const purpose = event.target
                          .value as RunConfig["purpose"];
                        setConfig({
                          ...config,
                          purpose,
                          ...(purpose === "promotable_evidence"
                            ? {
                                runMode: "preregistered",
                                replicationMode: "fixed",
                                design: "pairwise",
                                judgeMode: "ensemble",
                              }
                            : {}),
                        });
                      }}
                    >
                      <option value="exploratory_analysis">
                        Exploratory run
                      </option>
                      <option value="promotable_evidence">
                        Signed evidence run
                      </option>
                    </select>
                  </label>
                  <p className="muted">
                    {config.purpose === "promotable_evidence"
                      ? "Signed evidence run: requires preregistration, fixed repetitions, pairwise framing design, observed model judging, and one replication family. Eligible for study promotion subject to verification."
                      : "Exploratory run: supports adaptive replication, Cartesian design, and multiple families. Not eligible for evidence-tier promotion."}
                  </p>
                  <label className="field">
                    <span>Run discipline</span>
                    <select
                      value={config.runMode}
                      disabled={
                        active || config.purpose === "promotable_evidence"
                      }
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          runMode: event.target.value as RunConfig["runMode"],
                        })
                      }
                    >
                      <option value="exploratory">Exploratory</option>
                      <option value="preregistered">
                        Preregistered - required for signed evidence
                      </option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Replication plan</span>
                    <select
                      value={config.replicationMode}
                      disabled={
                        active || config.purpose === "promotable_evidence"
                      }
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          replicationMode: event.target
                            .value as RunConfig["replicationMode"],
                        })
                      }
                    >
                      <option value="adaptive">
                        Adaptive scout → confirm → publish
                      </option>
                      <option value="fixed">Fixed repetitions</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Design</span>
                    <select
                      value={config.design}
                      disabled={
                        active || config.purpose === "promotable_evidence"
                      }
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          design: event.target.value as RunConfig["design"],
                        })
                      }
                    >
                      <option value="pairwise">Pairwise covering array</option>
                      <option value="cartesian">Full Cartesian product</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Prompt generation</span>
                    <select
                      value={config.mutationMode}
                      disabled={active}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          mutationMode: event.target
                            .value as RunConfig["mutationMode"],
                        })
                      }
                    >
                      <option value="deterministic">Deterministic axes</option>
                      <option value="llm">
                        Axes + model-generated mutations
                      </option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Judge</span>
                    <select
                      value={config.judgeMode}
                      disabled={
                        active || config.purpose === "promotable_evidence"
                      }
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          judgeMode: event.target
                            .value as RunConfig["judgeMode"],
                        })
                      }
                    >
                      <option value="ensemble">
                        Observed model judging + heuristic checks
                      </option>
                      <option value="heuristic">
                        Deterministic heuristic only
                      </option>
                    </select>
                  </label>
                  <label className="field">
                    <span>
                      {config.replicationMode === "adaptive"
                        ? "Scout repetitions"
                        : "Repetitions"}
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={config.repetitions}
                      disabled={active}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          repetitions: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  {config.replicationMode === "adaptive" && (
                    <>
                      <label className="field">
                        <span>Confirm depth</span>
                        <input
                          type="number"
                          min={2}
                          max={30}
                          value={config.confirmRepetitions}
                          disabled={active}
                          onChange={(event) =>
                            setConfig({
                              ...config,
                              confirmRepetitions: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Publish depth</span>
                        <input
                          type="number"
                          min={3}
                          max={30}
                          value={config.publishRepetitions}
                          disabled={active}
                          onChange={(event) =>
                            setConfig({
                              ...config,
                              publishRepetitions: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Minimum meaningful lift</span>
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={config.adaptiveLiftThreshold}
                          disabled={active}
                          onChange={(event) =>
                            setConfig({
                              ...config,
                              adaptiveLiftThreshold: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Max escalated variants</span>
                        <input
                          type="number"
                          min={1}
                          max={200}
                          value={config.adaptiveMaxVariants}
                          disabled={active}
                          onChange={(event) =>
                            setConfig({
                              ...config,
                              adaptiveMaxVariants: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                  <label className="field">
                    <span>Concurrency</span>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={config.concurrency}
                      disabled={active}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          concurrency: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Target max tokens</span>
                    <input
                      type="number"
                      min={64}
                      max={4096}
                      value={config.maxTokens}
                      disabled={active}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          maxTokens: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Temperature</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.1}
                      value={config.temperature}
                      disabled={active}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          temperature: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Random seed</span>
                    <input
                      type="number"
                      min={0}
                      value={config.seed}
                      disabled={active}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          seed: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>

                <div className="toggle-grid">
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={config.redactResponses}
                      disabled={active}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          redactResponses: event.target.checked,
                        })
                      }
                    />
                    <span>
                      <strong>Redacted previews</strong>
                      <small>
                        Keep the trial table focused on classification rather
                        than operational text.
                      </small>
                    </span>
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={config.storeRawResponses}
                      disabled={active}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          storeRawResponses: event.target.checked,
                        })
                      }
                    />
                    <span>
                      <strong>Store raw responses locally</strong>
                      <small>
                        Required for later manual review; never sent back to the
                        browser unless opened.
                      </small>
                    </span>
                  </label>
                </div>
              </section>

              <ScenarioEditor
                scenarios={config.scenarios}
                packs={meta?.scenarioPacks}
                disabled={active}
                onChange={(scenarios) => setConfig({ ...config, scenarios })}
              />
              <div className="alert alert--inline">
                <strong>Replication capability</strong>
                <span>
                  Built-in studies include{" "}
                  {meta.replicationCapability.threeSplitReplicationFamilies}{" "}
                  independently authored three-split families and can reach
                  validated evidence across every pack. Built-in holdouts are
                  visible demo material, so confirmed evidence requires a signed
                  sealed-executor or independent-replication artifact.
                </span>
              </div>
              {!meta.holdout.enabled && (
                <div className="alert alert--inline">
                  <strong>
                    {meta.holdout.sealLevel === "external"
                      ? "External holdout disabled"
                      : "Demo holdout disabled"}
                  </strong>
                  <span>
                    {meta.holdout.scenarioCount} demo holdout scenarios across{" "}
                    {meta.holdout.families.join(", ")} are hidden.{" "}
                    {meta.holdout.externalConfigured
                      ? "A legacy hash-only pack is also loaded as untrusted evidence."
                      : "For genuine sealing, use a signed encrypted v2 pack with the separate holdout executor."}{" "}
                    Set ENABLE_HOLDOUT=true only for demo generalization runs.
                  </span>
                </div>
              )}

              <section className="panel">
                <div className="panel__header panel__header--compact">
                  <div>
                    <div className="eyebrow">Variant preview</div>
                    <h2>Generated experimental surface</h2>
                    <p>
                      Deterministic variants are fully reproducible from the
                      scenario registry, design, and seed.
                    </p>
                  </div>
                </div>
                {previewError ? (
                  <div className="alert alert--inline">{previewError}</div>
                ) : preview ? (
                  <>
                    <div className="estimate-strip">
                      <div>
                        <span>Base variants</span>
                        <strong>{preview.total}</strong>
                      </div>
                      <div>
                        <span>Per scenario</span>
                        <strong>{preview.perScenario}</strong>
                      </div>
                      <div>
                        <span>Estimated trials</span>
                        <strong>{estimatedTrials}</strong>
                      </div>
                      <div>
                        <span>Estimated API calls</span>
                        <strong>{estimatedCalls}</strong>
                      </div>
                    </div>
                    <div className="variant-preview">
                      {preview.variants.slice(0, 12).map((variant) => (
                        <article key={variant.id}>
                          <div>
                            <span>
                              {variant.isBaseline ? "baseline" : variant.label}
                            </span>
                            <code>{variant.fingerprint}</code>
                          </div>
                          <p>{variant.prompt}</p>
                        </article>
                      ))}
                    </div>
                    {(preview.total > 12 || config.mutationMode === "llm") && (
                      <div className="preview-note">
                        Showing the first 12 deterministic variants.
                        Model-generated mutations are created server-side when
                        the run starts.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="empty-state">
                    Complete the scenario registry to preview variants.
                  </div>
                )}
              </section>

              <section className="launch-panel">
                <label className="scope-contract">
                  <input
                    type="checkbox"
                    checked={config.scopeAccepted}
                    disabled={active}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        scopeAccepted: event.target.checked,
                      })
                    }
                  />
                  <span>
                    <strong>Authorized evaluation scope</strong>I will use this
                    harness only on models and accounts I am authorized to
                    evaluate, and I understand that the goal is to document
                    policy-boundary behavior rather than operationalize harmful
                    outputs.
                  </span>
                </label>
                <div className="launch-panel__actions">
                  <div>
                    <span>
                      {estimatedTrials.toLocaleString()} estimated trials
                    </span>
                    <small>
                      {estimatedCalls.toLocaleString()} estimated API calls
                      before retries
                    </small>
                  </div>
                  <button
                    className="button button--primary button--large"
                    type="button"
                    disabled={
                      starting ||
                      active ||
                      !config.scopeAccepted ||
                      !health?.apiKeyConfigured ||
                      estimatedTrials === 0 ||
                      estimatedTrials > 5000
                    }
                    onClick={startRun}
                  >
                    {starting ? "Creating run…" : "Launch evaluation"}
                  </button>
                </div>
              </section>
            </div>
          )}

          {activeTab === "live" && (
            <div className="page-stack">
              <section className="panel live-header">
                <div>
                  <div className="eyebrow">Execution monitor</div>
                  <h1>{currentRun?.config.name ?? "No active evaluation"}</h1>
                  <p>
                    {currentRun
                      ? `${currentRun.config.targetModel} · ${currentRun.config.design} design · ${currentRun.config.replicationMode} replication`
                      : "Launch a run from the experiment design workspace."}
                  </p>
                </div>
                {currentRun && (
                  <div className="live-header__actions">
                    <span className={`status status--${currentRun.status}`}>
                      {currentRun.status}
                    </span>
                    {["queued", "running"].includes(currentRun.status) && (
                      <button
                        className="button button--danger-ghost"
                        type="button"
                        onClick={cancelRun}
                      >
                        Cancel run
                      </button>
                    )}
                  </div>
                )}
              </section>

              {currentRun ? (
                <>
                  <section className="progress-panel">
                    <div className="progress-panel__top">
                      <div>
                        <strong>
                          {currentRun.progress.done.toLocaleString()}
                        </strong>
                        <span>
                          of {currentRun.progress.total.toLocaleString()} trials
                        </span>
                      </div>
                      <div>
                        <strong>{progressPercent.toFixed(1)}%</strong>
                        <span>
                          {currentRun.progress.stage} ·{" "}
                          {currentRun.progress.active} active workers
                        </span>
                      </div>
                    </div>
                    <div className="progress-track">
                      <i style={{ width: `${progressPercent}%` }} />
                    </div>
                    <div className="progress-panel__stats">
                      <span>
                        Unsafe success{" "}
                        <strong>
                          {percent(currentRun.analysis.unsafeRate)}
                        </strong>
                      </span>
                      <span>
                        Policy errors{" "}
                        <strong>
                          {percent(currentRun.analysis.incorrectRate)}
                        </strong>
                      </span>
                      <span>
                        Invariance{" "}
                        <strong>
                          {percent(currentRun.analysis.overallInvariance)}
                        </strong>
                      </span>
                      <span>
                        Judge disagreement{" "}
                        <strong>
                          {percent(currentRun.analysis.judgeDisagreementRate)}
                        </strong>
                      </span>
                      <span>
                        Severity risk{" "}
                        <strong>
                          {percent(currentRun.analysis.severityWeightedRisk)}
                        </strong>
                      </span>
                    </div>
                  </section>

                  <section className="panel">
                    <div className="panel__header panel__header--compact">
                      <div>
                        <div className="eyebrow">Recent evidence</div>
                        <h2>Latest completed trials</h2>
                      </div>
                    </div>
                    <div className="live-ledger">
                      {[...currentRun.trials]
                        .reverse()
                        .slice(0, 18)
                        .map((trial) => (
                          <article key={trial.id}>
                            <span
                              className={`behavior behavior--${trial.assessment.behavior}`}
                            >
                              {trial.assessment.behavior.replaceAll("_", " ")}
                            </span>
                            <div>
                              <strong>{trial.scenarioId}</strong>
                              <small>{trial.variant.label}</small>
                            </div>
                            <div className="live-ledger__scores">
                              <span>
                                unsafe <b>{trial.assessment.unsafeDetail}/4</b>
                              </span>
                              <span>
                                actionable{" "}
                                <b>{trial.assessment.actionability}/4</b>
                              </span>
                              <span>{trial.latencyMs} ms</span>
                            </div>
                          </article>
                        ))}
                      {currentRun.trials.length === 0 && (
                        <div className="empty-state">
                          Waiting for the first trial…
                        </div>
                      )}
                    </div>
                  </section>
                </>
              ) : (
                <div className="empty-state empty-state--large">
                  No run is selected.
                </div>
              )}
            </div>
          )}

          {activeTab === "analysis" && <AnalysisPanel run={currentRun} />}
          {activeTab === "trials" && <TrialExplorer run={currentRun} />}
          {activeTab === "calibration" && <CalibrationPanel />}
          {activeTab === "comparison" && <ComparisonPanel runs={runs} />}
          {activeTab === "report" && (
            <ReportPanel run={currentRun} runs={runs} />
          )}
          {activeTab === "studies" && <StudyPanel />}
          {activeTab === "runs" && (
            <RunHistory
              runs={runs}
              currentRunId={currentRun?.id}
              onOpen={openRun}
            />
          )}
          {activeTab === "audit" && <AuditPanel />}
        </main>
      </div>

      {currentRun && !["queued", "running"].includes(currentRun.status) && (
        <div className="export-dock">
          <span>
            <strong>{currentRun.config.name}</strong> ·{" "}
            {currentRun.trials.length} trials
          </span>
          <a
            className="button button--ghost"
            href={`/api/runs/${currentRun.id}/export?format=csv`}
          >
            Export CSV
          </a>
          <a
            className="button button--ghost"
            href={`/api/runs/${currentRun.id}/export?format=json`}
          >
            Export JSON
          </a>
        </div>
      )}
    </div>
  );
}

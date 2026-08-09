import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  CreateStudyInput,
  SignedStudySynthesis,
  StudyDetail,
  StudyRunEffect,
  StudySummary,
} from "../types";

const blank: CreateStudyInput = {
  title: "",
  researchQuestion: "",
  hypothesisKey: "",
  ownerOrganization: "local-lab",
  targetCompatibilityPolicy: "exact_snapshot",
  methodologyCompatibilityPolicy: "exact_hash",
};
const label = (value: string) => value.replaceAll("_", " ");

function Forest({ effects }: { effects: StudyRunEffect[] }) {
  return (
    <div
      className="forest"
      role="img"
      aria-label="Per-run risk-difference forest visualization"
    >
      {effects.map((effect) => {
        const x = (effect.riskDifference + 1) * 50;
        const low = (effect.interval.low + 1) * 50;
        const high = (effect.interval.high + 1) * 50;
        return (
          <div className="forest__row" key={effect.artifactHash}>
            <span>
              {label(effect.role)} · {effect.organization}
            </span>
            <div className="forest__axis">
              <i className="forest__zero" />
              <i
                className="forest__interval"
                style={{
                  left: `${low}%`,
                  width: `${Math.max(0, high - low)}%`,
                }}
              />
              <b style={{ left: `${x}%` }} />
            </div>
            <code>
              {effect.riskDifference.toFixed(3)} [
              {effect.interval.low.toFixed(3)},{" "}
              {effect.interval.high.toFixed(3)}]
            </code>
          </div>
        );
      })}
    </div>
  );
}

export function StudyPanel() {
  const [studies, setStudies] = useState<StudySummary[]>([]);
  const [selected, setSelected] = useState<StudyDetail>();
  const [synthesis, setSynthesis] = useState<SignedStudySynthesis>();
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string>();
  const refresh = async () => {
    const result = await api.listStudies();
    setStudies(result.studies);
  };
  useEffect(() => {
    void refresh().catch((failure) =>
      setError(failure instanceof Error ? failure.message : String(failure)),
    );
  }, []);
  const open = async (id: string) => {
    try {
      const result = await api.getStudy(id);
      setSelected(result.study);
      setSynthesis(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const create = async () => {
    try {
      const result = await api.createStudy(form);
      setForm(blank);
      await refresh();
      await open(result.study.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const synthesize = async () => {
    if (!selected) return;
    try {
      const result = await api.synthesizeStudy(selected.id);
      setSynthesis(result.synthesis);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const requirements = useMemo(
    () => synthesis?.payload.findings[0]?.assessment,
    [synthesis],
  );
  return (
    <div className="page-stack study-workspace">
      <section className="panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">v2.2.6 · Cross-run evidence registry</div>
            <h2>Studies and immutable run artifacts</h2>
            <p>
              Freeze a research question, link separately signed datasets and
              runs, then synthesize conservative evidence without pooling away a
              failed replication.
            </p>
          </div>
        </div>
        <div className="field-grid">
          <label className="field">
            <span>Title</span>
            <input
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Hypothesis key</span>
            <input
              value={form.hypothesisKey}
              onChange={(event) =>
                setForm({
                  ...form,
                  hypothesisKey: event.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]/g, "-"),
                })
              }
            />
          </label>
          <label className="field field--span-2">
            <span>Frozen research question</span>
            <textarea
              value={form.researchQuestion}
              onChange={(event) =>
                setForm({ ...form, researchQuestion: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Owner organization</span>
            <input
              value={form.ownerOrganization}
              onChange={(event) =>
                setForm({ ...form, ownerOrganization: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Target compatibility</span>
            <select
              value={form.targetCompatibilityPolicy}
              onChange={(event) =>
                setForm({
                  ...form,
                  targetCompatibilityPolicy: event.target
                    .value as CreateStudyInput["targetCompatibilityPolicy"],
                })
              }
            >
              <option value="exact_snapshot">Exact snapshot</option>
              <option value="same_requested_model">Same requested model</option>
              <option value="cross_version_generalization">
                Cross-version generalization
              </option>
            </select>
          </label>
        </div>
        <button
          className="button button--primary"
          type="button"
          onClick={() => void create()}
          disabled={
            form.title.length < 3 ||
            form.researchQuestion.length < 10 ||
            !form.hypothesisKey
          }
        >
          Create study
        </button>
        {error && <div className="alert alert--error">{error}</div>}
      </section>
      <section className="panel">
        <div className="panel__header panel__header--compact">
          <div>
            <div className="eyebrow">Registry</div>
            <h2>{studies.length} authorized studies</h2>
          </div>
        </div>
        <div className="study-list">
          {studies.map((study) => (
            <button
              type="button"
              key={study.id}
              className={selected?.id === study.id ? "is-active" : ""}
              onClick={() => void open(study.id)}
            >
              <strong>{study.title}</strong>
              <span>
                {label(study.status)} · {study.runLinks.length} signed runs ·{" "}
                {study.ownerOrganization}
              </span>
            </button>
          ))}
        </div>
      </section>
      {selected && (
        <>
          <section className="panel">
            <div className="panel__header">
              <div>
                <div className="eyebrow">
                  {label(selected.status)} · {selected.hypothesisKey}
                </div>
                <h2>{selected.title}</h2>
                <p>{selected.researchQuestion}</p>
              </div>
              <span className="status">
                {selected.targetCompatibilityPolicy}
              </span>
            </div>
            <div className="report-actions">
              <button
                className="button"
                type="button"
                onClick={() =>
                  void api
                    .registerStudy(selected.id)
                    .then(() => open(selected.id))
                }
                disabled={selected.status !== "draft"}
              >
                Freeze registration
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={() => void synthesize()}
                disabled={!selected.runLinks.length}
              >
                Synthesize signed evidence
              </button>
              <a
                className="button"
                href={`/api/studies/${selected.id}/report?disclosure=internal&format=pdf`}
              >
                Official PDF
              </a>
              <a
                className="button"
                href={`/api/studies/${selected.id}/archive?disclosure=internal`}
              >
                Verification archive
              </a>
            </div>
            <div className="study-ledger">
              {selected.runLinks.map((link) => (
                <article key={link.artifactHash}>
                  <div>
                    <strong>{label(link.role)}</strong>
                    <span>
                      {link.organization} · {link.independenceStatus}
                    </span>
                  </div>
                  <code>{link.artifactHash.slice(0, 24)}</code>
                  <span>
                    {link.verification.validAtSigning
                      ? "signature valid at signing"
                      : "signature invalid"}{" "}
                    · {link.verification.status}
                  </span>
                  <small>
                    dataset {link.datasetIdentity} · pack{" "}
                    {link.packIdentity.slice(0, 16)} · imported{" "}
                    {link.importedAt}
                  </small>
                </article>
              ))}
            </div>
          </section>
          {synthesis && (
            <section className="panel">
              <div className="panel__header">
                <div>
                  <div className="eyebrow">Signed study synthesis</div>
                  <h2>
                    {requirements
                      ? label(requirements.assignedTier)
                      : "No matching claim"}
                  </h2>
                  <p>
                    Artifact {synthesis.signature.artifactHash.slice(0, 24)} ·
                    signer {synthesis.signature.keyId.slice(0, 24)}
                  </p>
                </div>
              </div>
              {synthesis.payload.findings.map((finding) => (
                <article className="study-finding" key={finding.claimKey}>
                  <h3>{finding.claimKey.slice(0, 20)}</h3>
                  <Forest effects={finding.effects} />
                  <div className="tier-grid">
                    {Object.entries(finding.assessment.requirements).map(
                      ([key, pass]) => (
                        <span
                          className={pass ? "is-pass" : "is-blocked"}
                          key={key}
                        >
                          {pass ? "✓" : "×"} {label(key)}
                        </span>
                      ),
                    )}
                  </div>
                  {finding.assessment.blockers.length > 0 && (
                    <ul>
                      {finding.assessment.blockers.map((blocker) => (
                        <li key={blocker}>{label(blocker)}</li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

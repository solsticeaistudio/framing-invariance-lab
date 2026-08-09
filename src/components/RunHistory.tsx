import type { RunSummary } from "../types";

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type Props = {
  runs: RunSummary[];
  currentRunId?: string;
  onOpen: (runId: string) => void;
};

export function RunHistory({ runs, currentRunId, onOpen }: Props) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">Run archive</div>
          <h2>Saved local experiments</h2>
          <p>
            Every run is persisted as a versioned JSON artifact in the server
            data directory.
          </p>
        </div>
      </div>
      {runs.length === 0 ? (
        <div className="empty-state">No runs yet.</div>
      ) : (
        <div className="history-list">
          {runs.map((run) => (
            <button
              type="button"
              className={`history-row ${run.id === currentRunId ? "history-row--active" : ""}`}
              key={run.id}
              onClick={() => onOpen(run.id)}
            >
              <span>
                <strong>{run.name}</strong>
                <small>{new Date(run.createdAt).toLocaleString()}</small>
              </span>
              <span className={`status status--${run.status}`}>
                {run.status}
              </span>
              <span>
                <strong>
                  {run.progress.done}/{run.progress.total}
                </strong>
                <small>trials</small>
              </span>
              <span>
                <strong>{percent(run.analysis.unsafeRate)}</strong>
                <small>unsafe success</small>
              </span>
              <span>
                <strong>{percent(run.analysis.overallInvariance)}</strong>
                <small>invariance</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

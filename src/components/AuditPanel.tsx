import { useEffect, useState } from "react";
import { api } from "../api";
import type { AuditEventSummary } from "../types";

export function AuditPanel() {
  const [events, setEvents] = useState<AuditEventSummary[]>([]);
  const [verification, setVerification] = useState<{
    valid: boolean;
    errors: string[];
  }>();
  const [error, setError] = useState<string>();
  const refresh = () =>
    api
      .audit()
      .then((result) => {
        setEvents(result.events);
        setVerification(result.verification);
      })
      .catch((failure) =>
        setError(failure instanceof Error ? failure.message : String(failure)),
      );
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">Administrator transparency log</div>
            <h2>Append-only audit chain</h2>
            <p>
              Security- and evidence-critical actions are hash chained. This
              view never contains prompts, responses, bearer tokens, session
              cookies, or private keys.
            </p>
          </div>
          <span
            className={`gate gate--${verification?.valid ? "pass" : "fail"}`}
          >
            {verification?.valid ? "CHAIN VALID" : "VERIFICATION FAILED"}
          </span>
        </div>
        <button className="button" type="button" onClick={() => void refresh()}>
          Verify again
        </button>
        {error && <div className="alert alert--error">{error}</div>}
        {verification?.errors.map((item) => (
          <div className="alert alert--error" key={item}>
            {item}
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="study-ledger">
          {events.map((event) => (
            <article key={event.eventId}>
              <div>
                <strong>
                  #{event.sequence} · {event.action}
                </strong>
                <span>
                  {event.actorId} · {event.occurredAt}
                </span>
              </div>
              <code>{event.eventHash}</code>
              <small>
                {event.resourceType} / {event.resourceId} · previous{" "}
                {event.previousEventHash.slice(0, 20)}
              </small>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

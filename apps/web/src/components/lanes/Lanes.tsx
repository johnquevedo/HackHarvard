import type { DomainEvent, Lens } from "@/lib/types";
import { eventVisible, laneFor } from "@/lib/types";

export function DisconnectBanner({ connected }: { connected: boolean }) {
  if (connected) return null;
  return (
    <div className="banner" role="alert">
      Event stream disconnected. Showing the last events received. This view is not live.
    </div>
  );
}

export function EventCard({ event, fresh }: { event: DomainEvent; fresh?: boolean }) {
  function summarize(event: DomainEvent): string {
    const payload = event.payload;
    if (typeof payload.summary === "string") return payload.summary;
    if (typeof payload.text === "string") return payload.text;
    if (typeof payload.question === "string") return payload.question;
    const pub = payload.publicPayload;
    if (
      pub &&
      typeof pub === "object" &&
      "productKey" in pub &&
      typeof (pub as { productKey?: unknown }).productKey === "string"
    ) {
      return (pub as { productKey: string }).productKey;
    }
    return event.type;
  }
  return (
    <article className={fresh ? "card new" : "card"}>
      <div className="row">
        <strong>{event.type}</strong>
        {event.mode && event.mode !== "live" ? (
          <span className={`chip mode-${event.mode}`}>{event.mode.toUpperCase()}</span>
        ) : null}
      </div>
      <div>{summarize(event)}</div>
    </article>
  );
}

export function LaneBoard({ events, lens }: { events: DomainEvent[]; lens: Lens }) {
  const visible = events.filter((event) => eventVisible(event, lens));
  const alice = visible.filter((event) => laneFor(event) === "alice");
  const shared = visible.filter(
    (event) => laneFor(event) === "shared" || laneFor(event) === "system",
  );
  const bob = visible.filter((event) => laneFor(event) === "bob");
  return (
    <div className="lanes">
      <section className="lane lane-alice" aria-label="Alice private">
        <h2>Alice private</h2>
        {alice.length === 0 ? (
          <p className="muted">No Alice events for this lens.</p>
        ) : (
          alice.map((event) => <EventCard key={event.id} event={event} />)
        )}
      </section>
      <section className="lane lane-shared" aria-label="Agent network">
        <h2>Agent network</h2>
        {shared.length === 0 ? (
          <p className="muted">No shared events yet.</p>
        ) : (
          shared.map((event) => <EventCard key={event.id} event={event} />)
        )}
      </section>
      <section className="lane lane-bob" aria-label="Bob private">
        <h2>Bob private</h2>
        {bob.length === 0 ? (
          <p className="muted">No Bob events for this lens.</p>
        ) : (
          bob.map((event) => <EventCard key={event.id} event={event} />)
        )}
      </section>
    </div>
  );
}

export function ExplainPanel({
  trace,
}: {
  trace: {
    steps: {
      seq: number;
      summary: string;
      checks?: { rule: string; passed: boolean; detail: string }[];
    }[];
  } | null;
}) {
  if (!trace) return <aside className="panel">Select an opportunity to see rule checks.</aside>;
  return (
    <aside className="panel">
      <h2>Explain</h2>
      {trace.steps.map((step) => (
        <div key={step.seq}>
          <p>{step.summary}</p>
          <ul>
            {(step.checks ?? []).map((check) => (
              <li key={check.rule} className={check.passed ? "ok" : "bad"}>
                {check.passed ? "pass" : "fail"} {check.rule}: {check.detail}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  );
}

export function PayloadDrawer({ event }: { event: DomainEvent | null }) {
  if (!event) return null;
  return (
    <pre className="panel" style={{ overflow: "auto" }}>
      {JSON.stringify(event.payload, null, 2)}
    </pre>
  );
}

"use client";

import { useEffect, useState } from "react";
import { LaneBoard, ExplainPanel, PayloadDrawer } from "@/components/lanes/Lanes";
import { useLens, useStream } from "@/components/Shell";
import { api } from "@/lib/api";
import type { DomainEvent, ExplainTrace, Opportunity } from "@/lib/types";
import { eventVisible } from "@/lib/types";

export default function ActivityPage() {
  const { lens, viewerAgentId } = useLens();
  const stream = useStream();
  const [fallback, setFallback] = useState<DomainEvent[]>([]);
  const [explain, setExplain] = useState<ExplainTrace | null>(null);
  const [selected, setSelected] = useState<DomainEvent | null>(null);
  const [opps, setOpps] = useState<Opportunity[]>([]);

  useEffect(() => {
    const query = viewerAgentId ? `?viewerAgentId=${viewerAgentId}` : "";
    void api<{ events: DomainEvent[] }>(`/api/events${query}`).then((body) =>
      setFallback(body.events),
    );
    void api<Opportunity[]>(`/api/opportunities${query}`).then(setOpps);
    void api<ExplainTrace>("/api/opportunities/opp_monitor/explain").then(setExplain);
  }, [viewerAgentId]);

  const events = (stream.events.length > 0 ? stream.events : fallback).filter((event) =>
    eventVisible(event, lens),
  );

  return (
    <div className="grid-2">
      <div>
        <LaneBoard events={events} lens={lens} />
        <div className="row" style={{ marginTop: 12 }}>
          {opps.map((opp) => (
            <button
              key={opp.id}
              type="button"
              onClick={() =>
                setSelected(events.find((event) => event.opportunityId === opp.id) ?? null)
              }
            >
              {opp.headline}
            </button>
          ))}
        </div>
        <PayloadDrawer event={selected} />
      </div>
      <ExplainPanel trace={explain} />
    </div>
  );
}

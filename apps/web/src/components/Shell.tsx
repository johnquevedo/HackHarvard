"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import type { IntegrationStatus, Lens } from "@/lib/types";
import { lensAgent } from "@/lib/types";
import { useEventStream } from "@/lib/useEventStream";
import { api } from "@/lib/api";
import { useEffect } from "react";

const LensContext = createContext<{ lens: Lens; setLens: (lens: Lens) => void }>({
  lens: "judge",
  setLens: () => {},
});

export function useLens(): { lens: Lens; setLens: (lens: Lens) => void; viewerAgentId?: string } {
  const value = useContext(LensContext);
  return { ...value, viewerAgentId: lensAgent(value.lens) };
}

export function Shell({ children }: { children: ReactNode }) {
  const [lens, setLens] = useState<Lens>("judge");
  const viewerAgentId = lensAgent(lens);
  const stream = useEventStream({ viewerAgentId });
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [runId, setRunId] = useState("run_mock");

  useEffect(() => {
    void api<IntegrationStatus[]>("/api/integrations")
      .then(setIntegrations)
      .catch(() => setIntegrations([]));
    void api<{ runId: string }>("/api/demo/state")
      .then((state) => setRunId(state.runId))
      .catch(() => setRunId("unknown"));
  }, []);

  return (
    <LensContext.Provider value={{ lens, setLens }}>
      <StreamContext.Provider value={{ events: stream.events, connected: stream.connected }}>
        <div className="shell">
          <header className="topbar">
            <div className="brand">Dennis</div>
            {integrations.map((item) => (
              <span key={item.name} className={`badge mode-${item.mode}`} title={item.detail}>
                {item.name}{" "}
                {item.mode === "live"
                  ? "LIVE"
                  : item.mode === "replay"
                    ? "REPLAY"
                    : item.mode === "fallback"
                      ? "FALLBACK"
                      : "SIMULATED"}
              </span>
            ))}
            <span className="muted">run {runId}</span>
            <label>
              Lens{" "}
              <select
                value={lens}
                onChange={(event) => setLens(event.target.value as Lens)}
                aria-label="privacy lens"
              >
                <option value="judge">Judge</option>
                <option value="alice">Alice</option>
                <option value="bob">Bob</option>
              </select>
            </label>
          </header>
          <nav className="nav">
            <Link href="/">Lanes</Link>
            <Link href="/purchasing">Purchasing</Link>
            <Link href="/shortme">ShortMe</Link>
            <Link href="/sim">Simulator</Link>
            <Link href="/trust">Trust</Link>
            <Link href="/eval">Eval</Link>
            <Link href="/demo">Demo</Link>
          </nav>
          {!stream.connected ? (
            <div className="banner" role="alert">
              Event stream disconnected. Showing the last events received. This view is not live.
            </div>
          ) : null}
          <main className="page">{children}</main>
        </div>
      </StreamContext.Provider>
    </LensContext.Provider>
  );
}

const StreamContext = createContext<{
  events: import("@/lib/types").DomainEvent[];
  connected: boolean;
}>({
  events: [],
  connected: false,
});

export function useStream(): { events: import("@/lib/types").DomainEvent[]; connected: boolean } {
  return useContext(StreamContext);
}

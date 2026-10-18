"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

const NAV = [
  { href: "/", label: "Home" },
  { href: "/sim", label: "Chats", badge: "3" },
  { href: "/shortme", label: "Markets" },
  { href: "/purchasing", label: "Group Buys" },
  { href: "/plans", label: "Plans" },
  { href: "/wallet", label: "Wallet" },
];

const PRODUCT = ["/", "/sim", "/shortme", "/purchasing", "/plans", "/wallet"];

function isProduct(pathname: string): boolean {
  return PRODUCT.some((href) => (href === "/" ? pathname === "/" : pathname.startsWith(href)));
}

const PARTNERS = ["Photon", "Capital One Nessie", "Chalk", "iMessage agents", "HackHarvard 2026"];

function Marquee() {
  const items = [...PARTNERS, ...PARTNERS];
  return (
    <div className="marquee" aria-label="Powered by Photon, Capital One Nessie, Chalk">
      <div className="marquee-track" aria-hidden="true">
        {items.map((name, index) => (
          <span key={`${name}-${index}`}>
            Powered by <b>{name}</b>
            <i />
          </span>
        ))}
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const home = pathname === "/";
  const product = isProduct(pathname);
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
        <div className={home ? "shell home-shell" : "shell"}>
          <header className="topbar">
            <div className="brand-block">
              <div className="brand">dennis</div>
              <div className="tagline">your social financial agent</div>
            </div>
            <nav className="nav">
              {NAV.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href} className={active ? "nav-link active" : "nav-link"}>
                    {item.label}
                    {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
                  </Link>
                );
              })}
            </nav>
            {home ? null : (
              <div className="you" aria-label="You">
                E
              </div>
            )}
          </header>
          {product && !home ? <Marquee /> : null}
          {product ? null : (
          <div className="operator">
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
            <Link href="/activity">Activity</Link>
            <Link href="/trust">Trust</Link>
            <Link href="/eval">Eval</Link>
            <Link href="/demo">Demo</Link>
          </div>
          )}
          {!stream.connected && !product ? (
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

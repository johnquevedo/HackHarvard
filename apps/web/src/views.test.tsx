import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import events from "./mocks/events.json";
import purchasing from "./mocks/purchasing.json";
import shortme from "./mocks/shortme.json";
import { LaneBoard, DisconnectBanner } from "./components/lanes/Lanes";
import { PurchasingView } from "./components/PurchasingView";
import { ShortMeView } from "./components/ShortMeView";
import { EvalPanel } from "./components/EvalPanel";
import report from "./mocks/eval-report.json";
import type { DomainEvent } from "./lib/types";
import { mockApi, resetMockStore } from "./lib/api";

const fixture = events as DomainEvent[];

describe("lanes", () => {
  it("hides Alice private events when the lens is Bob", () => {
    const html = renderToStaticMarkup(createElement(LaneBoard, { events: fixture, lens: "bob" }));
    expect(html).toContain("I need a monitor too");
    expect(html).not.toContain("maybe $350 or under");
    expect(html).toContain("monitor_27in_4k");
  });

  it("renders 500 events without dropping the lane frame", () => {
    const many = Array.from({ length: 500 }, (_, index) => ({
      ...fixture[0]!,
      seq: index + 1,
      id: `evt_${index}`,
    }));
    const html = renderToStaticMarkup(createElement(LaneBoard, { events: many, lens: "judge" }));
    expect(html).toContain("lane-alice");
    expect(html.match(/class="card/g)?.length).toBe(500);
  });

  it("shows a disconnected banner", () => {
    const html = renderToStaticMarkup(createElement(DisconnectBanner, { connected: false }));
    expect(html).toContain("Event stream disconnected");
  });
});

describe("feature views", () => {
  it("renders purchasing states", () => {
    for (const state of ["verified", "unverified", "failed", "simulated"] as const) {
      const html = renderToStaticMarkup(createElement(PurchasingView, { card: purchasing[state] }));
      expect(html).toContain("SIMULATED OFFER");
      if (state === "verified" || state === "simulated") expect(html).toContain("VERIFIED");
      if (state === "unverified") expect(html).toContain("UNVERIFIED");
      if (state === "failed") expect(html).toContain("FAILED");
      if (state === "simulated") expect(html).toContain("SIMULATED BANK");
    }
  });

  it("renders shortme statuses and the stand-in resolver", () => {
    for (const status of ["proposed", "open", "resolved", "disputed"] as const) {
      const html = renderToStaticMarkup(createElement(ShortMeView, { card: shortme[status] }));
      expect(html).toContain(shortme[status].status);
      expect(html).toContain("STAND-IN FOR OFFICIAL SOURCE");
    }
    const open = renderToStaticMarkup(createElement(ShortMeView, { card: shortme.open }));
    expect(open).toContain("shorted herself");
  });

  it("badges a local eval report", () => {
    const html = renderToStaticMarkup(createElement(EvalPanel, { report }));
    expect(html).toContain("LOCAL RUN (NOT CHALK)");
  });
});

describe("mock routes", () => {
  it("posts consent, pause, forget, revoke, and dashboard approval", async () => {
    resetMockStore();
    const consent = await mockApi<{ via: string }>("/api/consents", {
      method: "POST",
      body: { userId: "usr_demo_alice", scope: "purchase_matching", granted: false },
    });
    expect(consent.via).toBe("dashboard");
    const paused = await mockApi<{ status: string }>("/api/agents/agt_demo_alice/pause", {
      method: "POST",
      body: { paused: true },
    });
    expect(paused.status).toBe("paused");
    const forgotten = await mockApi<{ deleted: { messages: number } }>("/api/privacy/forget", {
      method: "POST",
      body: { userId: "usr_demo_alice" },
    });
    expect(forgotten.deleted.messages).toBe(1);
    const revoked = await mockApi<{ status: string }>("/api/intents/int_alice_monitor/revoke", {
      method: "POST",
      body: { userId: "usr_demo_alice" },
    });
    expect(revoked.status).toBe("revoked");
    const approval = await mockApi<{ label: string }>("/api/approvals/apr_join_alice/decision", {
      method: "POST",
      body: { userId: "usr_demo_alice", decision: "approved" },
    });
    expect(approval.label).toBe("DASHBOARD FALLBACK");
  });
});

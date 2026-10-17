import events from "../mocks/events.json";
import integrations from "../mocks/integrations.json";
import opportunities from "../mocks/opportunities.json";
import explain from "../mocks/explain.json";
import purchasing from "../mocks/purchasing.json";
import shortme from "../mocks/shortme.json";
import report from "../mocks/eval-report.json";
import trust from "../mocks/trust.json";
import health from "../mocks/health.json";
import type { DomainEvent, IntegrationStatus, Lens } from "./types";
import { eventVisible } from "./types";

export const mockMode = process.env.NEXT_PUBLIC_API_MODE === "mock";

type MockState = {
  consents: Record<string, Record<string, boolean>>;
  paused: Record<string, boolean>;
  approvals: typeof trust.approvals;
  thread: typeof trust.thread;
};

function initialState(): MockState {
  const consents: MockState["consents"] = {};
  for (const user of trust.users) {
    consents[user.userId] = Object.fromEntries(trust.scopes.map((scope) => [scope, true]));
  }
  return {
    consents,
    paused: { agt_demo_alice: false, agt_demo_bob: false },
    approvals: trust.approvals.map((item) => ({ ...item })),
    thread: trust.thread.map((item) => ({ ...item })),
  };
}

const store: MockState = initialState();

export function resetMockStore(): void {
  const next = initialState();
  store.consents = next.consents;
  store.paused = next.paused;
  store.approvals = next.approvals;
  store.thread = next.thread;
}

function json<T>(value: T): T {
  return structuredClone(value);
}

export async function mockApi<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const url = new URL(path, "http://dennis.local");
  const method = (init?.method ?? "GET").toUpperCase();
  const body = (init?.body ?? {}) as Record<string, unknown>;
  const name = url.pathname;

  if (name === "/api/health") return json(health) as T;
  if (name === "/api/integrations") return json(integrations) as T;
  if (name === "/api/events") {
    const lens = (
      url.searchParams.get("viewerAgentId") === "agt_demo_bob"
        ? "bob"
        : url.searchParams.get("viewerAgentId") === "agt_demo_alice"
          ? "alice"
          : "judge"
    ) as Lens;
    const visible = (events as DomainEvent[]).filter((event) => eventVisible(event, lens));
    return json({ events: visible, lastSeq: visible.at(-1)?.seq ?? 0 }) as T;
  }
  if (name === "/api/opportunities") return json(opportunities) as T;
  if (name.endsWith("/explain")) return json(explain) as T;
  if (name === "/api/purchasing/groups" || name.startsWith("/api/purchasing/groups/")) {
    const state = url.searchParams.get("state") ?? "verified";
    const card = purchasing[state as keyof typeof purchasing] ?? purchasing.verified;
    return json(card) as T;
  }
  if (name === "/api/purchasing/bank/accounts") {
    return json({ mode: "simulated", accounts: purchasing.verified.accounts }) as T;
  }
  if (name.startsWith("/api/shortme/markets")) {
    const status = url.searchParams.get("status") ?? "open";
    const card = shortme[status as keyof typeof shortme] ?? shortme.open;
    return json(card) as T;
  }
  if (name === "/api/shortme/leaderboard") return json(shortme.resolved.leaderboard) as T;
  if (name === "/api/shortme/invariants") {
    return json({
      ok: true,
      checks: [{ id: "L1", ok: true, detail: "sum of deltas is zero" }],
    }) as T;
  }
  if (name === "/api/users") return json(trust.users) as T;
  if (name === "/api/consents" && method === "POST") {
    const userId = String(body.userId);
    const scope = String(body.scope);
    store.consents[userId] = { ...(store.consents[userId] ?? {}), [scope]: Boolean(body.granted) };
    return json({
      scope,
      granted: Boolean(body.granted),
      updatedAt: new Date().toISOString(),
      via: "dashboard",
    }) as T;
  }
  if (name === "/api/consents") {
    const userId = url.searchParams.get("userId") ?? "usr_demo_alice";
    const granted = store.consents[userId] ?? {};
    return json(
      trust.scopes.map((scope) => ({
        scope,
        granted: granted[scope] !== false,
        updatedAt: health.time,
        via: "seed_demo",
      })),
    ) as T;
  }
  if (name.includes("/pause") && method === "POST") {
    const agentId = name.split("/")[3] ?? "";
    store.paused[agentId] = Boolean(body.paused);
    return json({ id: agentId, status: body.paused ? "paused" : "active" }) as T;
  }
  if (name === "/api/privacy/forget" && method === "POST") {
    return json({ deleted: { messages: 1, intents: 1, positions: 0 } }) as T;
  }
  if (name.includes("/revoke") && method === "POST") {
    return json({ id: name.split("/")[3], status: "revoked" }) as T;
  }
  if (name === "/api/sim/inbound" && method === "POST") {
    store.thread.push({
      direction: "in",
      text: String(body.text ?? ""),
      ts: new Date().toISOString(),
      status: "simulated",
    });
    return json({
      messageId: `msg_${store.thread.length}`,
      accepted: true,
      label: "SIMULATED INBOUND",
    }) as T;
  }
  if (name === "/api/sim/thread") return json({ messages: store.thread }) as T;
  if (name === "/api/approvals") {
    const userId = url.searchParams.get("userId");
    return json(store.approvals.filter((item) => !userId || item.userId === userId)) as T;
  }
  if (name.includes("/decision") && method === "POST") {
    const id = name.split("/")[3];
    const found = store.approvals.find((item) => item.id === id);
    if (found) found.status = String(body.decision ?? "approved");
    return json({
      ...(found ?? { id }),
      decidedVia: "dashboard_fallback",
      label: "DASHBOARD FALLBACK",
    }) as T;
  }
  if (name === "/api/eval/report") return json(report) as T;
  if (name === "/api/demo/state") {
    return json({
      runId: "run_mock",
      modes: { photon: "simulated", llm: "simulated", nessie: "simulated", chalk: "fallback" },
      checklist: [
        { id: "health", label: "health", ok: true },
        { id: "integrations", label: "integrations", ok: true },
      ],
    }) as T;
  }
  if (name.startsWith("/api/demo/script/")) {
    return json({ messageId: "msg_script", label: "SIMULATED INBOUND" }) as T;
  }
  if (name === "/api/demo/reset") return json({ runId: "run_mock_reset" }) as T;
  if (name === "/api/demo/replay/start") return json({ status: "running", mode: "replay" }) as T;
  if (name === "/api/demo/replay/stop") return json({ status: "stopped" }) as T;
  if (name.includes("demo-resolve"))
    return json({ ...shortme.resolved, label: "STAND-IN FOR OFFICIAL SOURCE" }) as T;
  throw new Error(`no mock for ${method} ${name}`);
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (mockMode || process.env.NEXT_PUBLIC_API_MODE === "mock") return mockApi<T>(path, init);
  const response = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `request failed ${response.status}`);
  }
  return (await response.json()) as T;
}

export function mockIntegrations(): IntegrationStatus[] {
  return integrations as IntegrationStatus[];
}

export type ProviderMode = "live" | "simulated" | "replay" | "fallback";
export type Visibility = "private" | "shared" | "system";
export type Lens = "judge" | "alice" | "bob";

export interface DomainEvent {
  seq: number;
  id: string;
  ts: string;
  type: string;
  actor: { kind: string; agentId?: string; userId?: string };
  visibility: Visibility;
  opportunityId: string | null;
  traceId: string;
  mode: ProviderMode | null;
  payload: Record<string, unknown>;
}

export interface IntegrationStatus {
  name: "photon" | "llm" | "nessie" | "chalk";
  mode: ProviderMode;
  healthy: boolean;
  detail: string;
  lastCheckedAt: string;
  lastSuccessAt: string | null;
}

export interface Opportunity {
  id: string;
  type: "group_purchase" | "shortme_market";
  domainRefId: string;
  status: string;
  headline: string;
  participantAgentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ExplainTrace {
  opportunityId: string;
  steps: {
    seq: number;
    ts: string;
    type: string;
    agentId?: string;
    summary: string;
    checks?: { rule: string; passed: boolean; detail: string }[];
  }[];
}

export const ALICE_AGENT = "agt_demo_alice";
export const BOB_AGENT = "agt_demo_bob";
export const ALICE_USER = "usr_demo_alice";
export const BOB_USER = "usr_demo_bob";

export function lensAgent(lens: Lens): string | undefined {
  if (lens === "alice") return ALICE_AGENT;
  if (lens === "bob") return BOB_AGENT;
  return undefined;
}

export function eventVisible(event: DomainEvent, lens: Lens): boolean {
  if (lens === "judge") return true;
  if (event.visibility === "shared" || event.visibility === "system") return true;
  return event.actor.agentId === lensAgent(lens);
}

export function laneFor(event: DomainEvent): "alice" | "shared" | "bob" | "system" {
  if (event.visibility === "shared") return "shared";
  if (event.visibility === "system") return "system";
  if (event.actor.agentId === BOB_AGENT) return "bob";
  return "alice";
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

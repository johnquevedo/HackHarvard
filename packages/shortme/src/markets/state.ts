import { DennisError } from "@dennis/contracts";

// Section 8.7. Every transition the services perform goes through assertTransition.
export const MARKET_STATUSES = [
  "proposed",
  "declined",
  "expired",
  "open",
  "locked",
  "resolution_proposed",
  "resolved",
  "disputed",
  "void",
] as const;
export type MarketStatus = (typeof MARKET_STATUSES)[number];
export const TERMINAL: ReadonlySet<MarketStatus> = new Set([
  "declined",
  "expired",
  "resolved",
  "void",
]);

export const TRANSITIONS: Record<MarketStatus, readonly MarketStatus[]> = {
  proposed: ["open", "declined", "expired"],
  open: ["locked", "resolution_proposed", "void"],
  locked: ["resolution_proposed", "void"],
  resolution_proposed: ["resolved", "disputed", "locked"],
  disputed: ["resolved", "void"],
  declined: [],
  expired: [],
  resolved: [],
  void: [],
};

export function canTransition(from: string, to: MarketStatus): boolean {
  return (TRANSITIONS[from as MarketStatus] ?? []).includes(to);
}

export function assertTransition(from: string, to: MarketStatus): void {
  if (!canTransition(from, to))
    throw new DennisError("invalid_state", `market cannot move from ${from} to ${to}`, 409);
}

// A market is visible beyond its subject only after it was published (it has an openedAt).
export function isShared(m: { openedAt: string | null }): boolean {
  return m.openedAt !== null;
}

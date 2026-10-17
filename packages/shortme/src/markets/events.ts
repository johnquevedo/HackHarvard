import type { PlatformContext } from "@dennis/platform";
import type { markets } from "@dennis/db";
import { isShared } from "./state";

type MarketRow = typeof markets.$inferSelect;

// Emitters for the ShortMe event types (Section 8.3) with exactly the listed payload fields.

export function emitMarketUpdated(ctx: PlatformContext, m: MarketRow): void {
  ctx.events.emit({
    type: "shortme.market.updated",
    actor: { kind: "agent", agentId: m.subjectAgentId },
    visibility: isShared(m) ? "shared" : "private",
    opportunityId: m.opportunityId,
    payload: {
      marketId: m.id,
      status: m.status,
      question: m.question,
      subjectAgentId: m.subjectAgentId,
    },
  });
}

export function emitPositionPlaced(
  ctx: PlatformContext,
  p: {
    opportunityId: string;
    marketId: string;
    agentId: string;
    side: string;
    points: number;
    selfShort: boolean;
  },
): void {
  ctx.events.emit({
    type: "shortme.position.placed",
    actor: { kind: "agent", agentId: p.agentId },
    visibility: "shared",
    opportunityId: p.opportunityId,
    payload: {
      marketId: p.marketId,
      agentId: p.agentId,
      side: p.side,
      points: p.points,
      selfShort: p.selfShort,
    },
  });
}

export function emitResolutionUpdated(
  ctx: PlatformContext,
  r: {
    opportunityId: string;
    marketId: string;
    status: string;
    proposedOutcome?: string;
    subjectConfirmState: string;
    actorAgentId?: string;
  },
): void {
  ctx.events.emit({
    type: "shortme.resolution.updated",
    actor: r.actorAgentId ? { kind: "agent", agentId: r.actorAgentId } : { kind: "system" },
    visibility: "shared",
    opportunityId: r.opportunityId,
    payload: {
      marketId: r.marketId,
      status: r.status,
      ...(r.proposedOutcome ? { proposedOutcome: r.proposedOutcome } : {}),
      subjectConfirmState: r.subjectConfirmState,
    },
  });
}

export function emitLedgerPosted(
  ctx: PlatformContext,
  p: {
    opportunityId: string | null;
    marketId: string | null;
    entries: {
      agentId: string;
      kind: string;
      delta: number;
      balanceAfter: number;
    }[];
    invariantOk: boolean;
  },
): void {
  if (p.entries.length === 0) return;
  ctx.events.emit({
    type: "shortme.ledger.posted",
    actor: { kind: "system" },
    visibility: "shared",
    ...(p.opportunityId ? { opportunityId: p.opportunityId } : {}),
    payload: {
      ...(p.marketId ? { marketId: p.marketId } : {}),
      entries: p.entries,
      invariantOk: p.invariantOk,
    },
  });
}

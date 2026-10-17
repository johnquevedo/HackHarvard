import { and, eq, inArray } from "drizzle-orm";
import { DennisError, hashPayload, type ApprovalT } from "@dennis/contracts";
import { marketParticipants, marketResolutions, markets } from "@dennis/db";
import type { PlatformContext } from "@dennis/platform";
import { buildResultText, generateQuip } from "../copy/result";
import {
  checkLedgerInvariants,
  marketStakeSum,
  positionsFor,
  postLedgerTx,
  type PostedEntry,
} from "../ledger/ledger";
import { computePayouts } from "../ledger/payouts";
import { emitLedgerPosted, emitMarketUpdated, emitResolutionUpdated } from "../markets/events";
import {
  marketByOpportunity,
  requireMarket,
  syncOpportunity,
  type MarketRow,
} from "../markets/service";
import { assertTransition } from "../markets/state";
import { approvalTtlMinutes } from "../rules";
import { confirmResolutionPrompt, deltaLine, outcomeSentence } from "../templates";

export type ResolutionRow = typeof marketResolutions.$inferSelect;

export interface ConfirmPayload {
  resolutionId: string;
  question: string;
  proposedOutcome: "yes" | "no";
}

function latestResolution(ctx: PlatformContext, marketId: string): ResolutionRow | undefined {
  return ctx.db
    .select()
    .from(marketResolutions)
    .where(eq(marketResolutions.marketId, marketId))
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
}

function hasCounterparty(ctx: PlatformContext, marketId: string): boolean {
  const ps = positionsFor(ctx.db as never, marketId);
  return ps.some((p) => p.side === "back") && ps.some((p) => p.side === "fade");
}

// Demo resolver or subject proposes an outcome. Needs at least one back and one fade position;
// otherwise the market is voided and every stake refunded (Section 8.7).
export async function proposeResolution(
  ctx: PlatformContext,
  input: {
    marketId: string;
    outcome: "yes" | "no";
    proposedBy: string;
    evidenceNote: string;
  },
): Promise<ResolutionRow> {
  if (input.outcome !== "yes" && input.outcome !== "no")
    throw new DennisError("validation_error", "outcome must be yes or no", 400);
  const result = await ctx.runExclusive(`market:${input.marketId}`, async () => {
    const m = requireMarket(ctx, input.marketId);
    if (m.status !== "open" && m.status !== "locked")
      throw new DennisError("invalid_state", `cannot propose a resolution while ${m.status}`, 409);
    const id = ctx.ids.next("resolution");
    const now = ctx.clock.nowIso();
    if (!hasCounterparty(ctx, m.id)) {
      const row: ResolutionRow = {
        id,
        marketId: m.id,
        proposedOutcome: input.outcome,
        proposedBy: input.proposedBy,
        status: "voided",
        subjectConfirmState: "pending",
        evidenceNote: `${input.evidenceNote} (no counterparty, market voided)`.slice(0, 500),
        createdAt: now,
        decidedAt: now,
      };
      ctx.db.insert(marketResolutions).values(row).run();
      return { row, voidNow: true, market: m };
    }
    const row: ResolutionRow = {
      id,
      marketId: m.id,
      proposedOutcome: input.outcome,
      proposedBy: input.proposedBy,
      status: "proposed",
      subjectConfirmState: "pending",
      evidenceNote: input.evidenceNote.slice(0, 500),
      createdAt: now,
      decidedAt: null,
    };
    assertTransition(m.status, "resolution_proposed");
    ctx.db.transaction((tx) => {
      tx.insert(marketResolutions).values(row).run();
      tx.update(markets)
        .set({ status: "resolution_proposed", updatedAt: now })
        .where(and(eq(markets.id, m.id), eq(markets.status, m.status)))
        .run();
    });
    const next = { ...m, status: "resolution_proposed", updatedAt: now };
    emitMarketUpdated(ctx, next);
    emitResolutionUpdated(ctx, {
      opportunityId: m.opportunityId,
      marketId: m.id,
      status: "proposed",
      proposedOutcome: input.outcome,
      subjectConfirmState: "pending",
    });
    await syncOpportunity(ctx, next);
    return { row, voidNow: false, market: next };
  });
  if (result.voidNow) {
    await resolveMarket(ctx, {
      marketId: input.marketId,
      outcome: "void",
      by: "system_no_counterparty",
    });
    return result.row;
  }
  const subject = await ctx.users.get(result.market.subjectUserId);
  const payload: ConfirmPayload = {
    resolutionId: result.row.id,
    question: result.market.question,
    proposedOutcome: input.outcome,
  };
  await ctx.approvals.request({
    kind: "confirm_resolution",
    userId: result.market.subjectUserId,
    agentId: result.market.subjectAgentId,
    opportunityId: result.market.opportunityId,
    payload: payload as unknown as Record<string, unknown>,
    promptText: confirmResolutionPrompt({
      question: result.market.question,
      outcome: input.outcome,
    }),
    ttlMinutes: approvalTtlMinutes(subject?.isDemo ?? true),
    idempotencyKey: `confirm_resolution:${result.row.id}`,
  });
  return result.row;
}

// onDecided('confirm_resolution'): approve confirms and resolves; decline disputes and freezes;
// expiry clears the proposal and returns the market to locked.
export async function onConfirmDecided(ctx: PlatformContext, approval: ApprovalT): Promise<void> {
  const m = marketByOpportunity(ctx, approval.opportunityId);
  if (!m) return;
  const p = approval.payload as unknown as ConfirmPayload;
  const res = ctx.db
    .select()
    .from(marketResolutions)
    .where(eq(marketResolutions.id, String(p.resolutionId)))
    .get();
  if (!res || res.status !== "proposed" || m.status !== "resolution_proposed") return;
  if (approval.status === "approved") {
    const expected: ConfirmPayload = {
      resolutionId: res.id,
      question: m.question,
      proposedOutcome: res.proposedOutcome as "yes" | "no",
    };
    await ctx.approvals.assertApproved({
      approvalId: approval.id,
      userId: m.subjectUserId,
      kind: "confirm_resolution",
      payloadHash: hashPayload(expected as unknown as Record<string, unknown>),
    });
    await resolveMarket(ctx, {
      marketId: m.id,
      outcome: res.proposedOutcome as "yes" | "no",
      by: m.subjectUserId,
      approvalId: approval.id,
    });
    return;
  }
  if (approval.status === "declined") {
    await disputeResolution(ctx, { marketId: m.id, by: approval.userId });
    return;
  }
  if (approval.status === "expired" || approval.status === "revoked") {
    await ctx.runExclusive(`market:${m.id}`, async () => {
      const cur = requireMarket(ctx, m.id);
      if (cur.status !== "resolution_proposed") return;
      assertTransition(cur.status, "locked");
      const now = ctx.clock.nowIso();
      ctx.db.transaction((tx) => {
        tx.update(marketResolutions)
          .set({ status: "voided", decidedAt: now })
          .where(eq(marketResolutions.id, res.id))
          .run();
        tx.update(markets)
          .set({ status: "locked", updatedAt: now })
          .where(eq(markets.id, cur.id))
          .run();
      });
      const next = { ...cur, status: "locked", updatedAt: now };
      emitMarketUpdated(ctx, next);
      emitResolutionUpdated(ctx, {
        opportunityId: cur.opportunityId,
        marketId: cur.id,
        status: "voided",
        subjectConfirmState: "pending",
      });
      await syncOpportunity(ctx, next);
    });
  }
}

// Any participant (or the subject through DISPUTE) moves a proposed resolution to disputed. Payouts freeze.
export async function disputeResolution(
  ctx: PlatformContext,
  input: { marketId: string; by: string },
): Promise<MarketRow> {
  return ctx.runExclusive(`market:${input.marketId}`, async () => {
    const m = requireMarket(ctx, input.marketId);
    const isParticipant = ctx.db
      .select()
      .from(marketParticipants)
      .where(and(eq(marketParticipants.marketId, m.id), eq(marketParticipants.userId, input.by)))
      .get();
    if (!isParticipant) throw new DennisError("forbidden", "only participants can dispute", 403);
    assertTransition(m.status, "disputed");
    const res = latestResolution(ctx, m.id);
    const now = ctx.clock.nowIso();
    const bySubject = input.by === m.subjectUserId;
    ctx.db.transaction((tx) => {
      if (res && res.status === "proposed") {
        tx.update(marketResolutions)
          .set({
            status: "disputed",
            subjectConfirmState: bySubject ? "disputed" : res.subjectConfirmState,
            decidedAt: now,
          })
          .where(eq(marketResolutions.id, res.id))
          .run();
      }
      tx.update(markets)
        .set({ status: "disputed", updatedAt: now })
        .where(eq(markets.id, m.id))
        .run();
    });
    const next = { ...m, status: "disputed", updatedAt: now };
    emitMarketUpdated(ctx, next);
    emitResolutionUpdated(ctx, {
      opportunityId: m.opportunityId,
      marketId: m.id,
      status: "disputed",
      ...(res ? { proposedOutcome: res.proposedOutcome } : {}),
      subjectConfirmState: bySubject ? "disputed" : (res?.subjectConfirmState ?? "pending"),
    });
    await syncOpportunity(ctx, next);
    await notifyAll(
      ctx,
      next,
      `ShortMe: the result for "${m.question}" is disputed. Points are frozen until an admin settles it. (Fictional points, no value.)`,
      "dispute",
    );
    return next;
  });
}

async function notifyAll(
  ctx: PlatformContext,
  m: MarketRow,
  text: string,
  tag: string,
): Promise<void> {
  const parts = ctx.db
    .select()
    .from(marketParticipants)
    .where(
      and(
        eq(marketParticipants.marketId, m.id),
        inArray(marketParticipants.inviteState, ["not_applicable", "invited", "accepted"]),
      ),
    )
    .all();
  for (const p of parts) {
    await ctx.notifier.send({
      userId: p.userId,
      kind: "result",
      text,
      opportunityId: m.opportunityId,
      idempotencyKey: `shortme_${tag}:${m.id}:${p.userId}`,
    });
  }
}

// Settles a market exactly once (L6). yes or no posts pari-mutuel payouts; void refunds every stake.
// L3 (stake + payout + refund sums to zero) is asserted inside the transaction, so a violation rolls
// everything back. Allowed from resolution_proposed (subject confirmed), disputed (admin), and open
// or locked (void only).
// `approvalId` (the subject's confirm_resolution) is consumed inside the settlement transaction.
export async function resolveMarket(
  ctx: PlatformContext,
  input: {
    marketId: string;
    outcome: "yes" | "no" | "void";
    by: string;
    approvalId?: string;
  },
): Promise<MarketRow> {
  const settled = await ctx.runExclusive(`market:${input.marketId}`, async () => {
    const m = requireMarket(ctx, input.marketId);
    if (m.status === "resolved" || m.status === "void")
      throw new DennisError("conflict", "market already settled", 409);
    if (input.outcome !== "void" && m.status !== "resolution_proposed" && m.status !== "disputed") {
      throw new DennisError("invalid_state", `cannot resolve while ${m.status}`, 409);
    }
    const positions = positionsFor(ctx.db as never, m.id);
    const payout =
      input.outcome === "void"
        ? ({ void: true } as const)
        : computePayouts(
            positions.map((p) => ({ ...p, side: p.side as "back" | "fade" })),
            input.outcome,
          );
    const finalStatus = "void" in payout ? "void" : "resolved";
    assertTransition(m.status, finalStatus);
    const now = ctx.clock.nowIso();
    const res = latestResolution(ctx, m.id);
    const posted: PostedEntry[] = ctx.db.transaction((tx) => {
      if (input.approvalId) ctx.approvals.consumeInTransaction(input.approvalId, tx);
      const entries =
        "void" in payout
          ? positions.map((p) => ({
              userId: p.userId,
              marketId: m.id,
              kind: "refund" as const,
              delta: p.points,
              refId: p.id,
              idempotencyKey: `refund:${p.id}`,
            }))
          : payout.payouts.map((p) => ({
              userId: p.userId,
              marketId: m.id,
              kind: "payout" as const,
              delta: p.payout,
              refId: res?.id ?? null,
              idempotencyKey: `payout:${m.id}:${p.userId}`,
            }));
      const out = postLedgerTx(ctx, tx as never, entries);
      const sum = marketStakeSum(tx as never, m.id);
      if (sum !== 0)
        throw new DennisError("internal", `L3 violated for ${m.id}: market sum ${sum}`, 500);
      tx.update(markets)
        .set({
          status: finalStatus,
          outcome: "void" in payout ? "void" : input.outcome,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(and(eq(markets.id, m.id), eq(markets.status, m.status)))
        .run();
      if (res && (res.status === "proposed" || res.status === "disputed")) {
        const confirmed = input.by === m.subjectUserId;
        tx.update(marketResolutions)
          .set({
            status: finalStatus === "void" ? "voided" : "confirmed",
            subjectConfirmState: confirmed ? "confirmed" : res.subjectConfirmState,
            decidedAt: now,
          })
          .where(eq(marketResolutions.id, res.id))
          .run();
      }
      return out;
    });
    const next: MarketRow = {
      ...m,
      status: finalStatus,
      outcome: "void" in payout ? "void" : input.outcome,
      resolvedAt: now,
      updatedAt: now,
    };
    const agentOf = new Map<string, string>();
    for (const p of positions)
      agentOf.set(p.userId, (await ctx.users.getAgentByUserId(p.userId))?.id ?? "unknown");
    const inv = await checkLedgerInvariants(ctx);
    emitLedgerPosted(ctx, {
      opportunityId: m.opportunityId,
      marketId: m.id,
      entries: posted.map((e) => ({
        agentId: agentOf.get(e.userId) ?? "unknown",
        kind: e.kind,
        delta: e.delta,
        balanceAfter: e.balanceAfter,
      })),
      invariantOk: inv.every((c) => c.ok),
    });
    emitResolutionUpdated(ctx, {
      opportunityId: m.opportunityId,
      marketId: m.id,
      status: finalStatus === "void" ? "voided" : "confirmed",
      ...(res ? { proposedOutcome: res.proposedOutcome } : {}),
      subjectConfirmState:
        input.by === m.subjectUserId ? "confirmed" : (res?.subjectConfirmState ?? "pending"),
    });
    emitMarketUpdated(ctx, next);
    await syncOpportunity(ctx, next);
    return { market: next, positions, posted };
  });
  await sendResults(ctx, settled.market, settled.positions, settled.posted);
  return settled.market;
}

async function sendResults(
  ctx: PlatformContext,
  m: MarketRow,
  positions: { userId: string; side: string; points: number }[],
  posted: PostedEntry[],
): Promise<void> {
  const subject = await ctx.users.get(m.subjectUserId);
  const subjectFirst = subject?.firstName ?? "the subject";
  const names = new Map<string, string>();
  for (const p of positions)
    names.set(p.userId, (await ctx.users.get(p.userId))?.firstName ?? "someone");
  // Subject first, then friends alphabetically, so every recipient reads the same deterministic line.
  const rows = [...positions]
    .sort(
      (a, b) =>
        Number(b.userId === m.subjectUserId) - Number(a.userId === m.subjectUserId) ||
        names.get(a.userId)!.localeCompare(names.get(b.userId)!),
    )
    .map((p) => ({
      firstName: names.get(p.userId)!,
      net: posted.filter((e) => e.userId === p.userId).reduce((s, e) => s + e.delta, 0) - p.points,
    }));
  const otherNames = [...names.values()].filter((n) => n !== subjectFirst);
  const selfShort = positions.some((p) => p.userId === m.subjectUserId && p.side === "fade");
  const outcome = (m.outcome ?? "void") as "yes" | "no" | "void";
  const quip = await generateQuip(ctx, {
    outcome,
    selfShort,
    subjectFirst,
    otherNames,
  });
  const text = buildResultText({
    outcomeSentence: outcomeSentence({ subjectFirst, outcome }),
    deltaLine: rows.length > 0 ? deltaLine(rows) : "no positions",
    quip,
    subjectFirst,
    otherNames,
  });
  const recipients = new Set<string>([m.subjectUserId, ...positions.map((p) => p.userId)]);
  for (const userId of recipients) {
    await ctx.notifier.send({
      userId,
      kind: "result",
      text,
      opportunityId: m.opportunityId,
      idempotencyKey: `shortme_result:${m.id}:${userId}`,
    });
  }
}

// Admin route (ADMIN token): only from disputed. yes or no resolves with payouts, void refunds.
export async function adminResolve(
  ctx: PlatformContext,
  input: { marketId: string; outcome: "yes" | "no" | "void" },
): Promise<MarketRow> {
  const m = requireMarket(ctx, input.marketId);
  if (m.status !== "disputed")
    throw new DennisError(
      "invalid_state",
      "admin resolution is only allowed for disputed markets",
      409,
    );
  return resolveMarket(ctx, {
    marketId: m.id,
    outcome: input.outcome,
    by: "admin",
  });
}

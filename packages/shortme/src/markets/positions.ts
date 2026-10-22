import { and, eq, inArray } from "drizzle-orm";
import { DennisError, type DecisionChannelT } from "@dennis/contracts";
import { marketInvites, marketParticipants, marketPositions, markets } from "@dennis/db";
import type { CommandInput } from "@dennis/contracts";
import type { PlatformContext } from "@dennis/platform";
import {
  checkLedgerInvariants,
  ensureStarterGrant,
  getBalance,
  postLedgerTx,
} from "../ledger/ledger";
import { GATES } from "../rules";
import { dollars, dollarsToPoints, marketCreatedText, stakeRecordedText } from "../templates";
import { emitLedgerPosted, emitPositionPlaced } from "./events";
import { stakingOnPublish } from "./publish-state";
import { marketSpace, onStakeMessage } from "../native-moments";
import { marketByOpportunity, passInvite, requireMarket } from "./service";

export type PositionRow = typeof marketPositions.$inferSelect;

export interface PlacePositionInput {
  marketId: string;
  userId: string;
  side: "back" | "fade";
  points: number;
  idempotencyKey: string;
  via: DecisionChannelT;
}

// Validations (Section 8.7 row "position placed", invariants L2, L4, L5):
// market open; user holds shortme_free_play; user is the subject or an invited, not-declined friend;
// one position per user; 1 <= points <= min(maxStake, balance). Stake posting and position insert
// happen in one transaction. A replay with the same idempotency key returns the original position.
export async function placePosition(
  ctx: PlatformContext,
  input: PlacePositionInput,
): Promise<PositionRow> {
  return ctx.runExclusive(`market:${input.marketId}`, async () => {
    const replay = ctx.db
      .select()
      .from(marketPositions)
      .where(eq(marketPositions.idempotencyKey, input.idempotencyKey))
      .get();
    if (replay) {
      if (
        replay.marketId !== input.marketId ||
        replay.userId !== input.userId ||
        replay.side !== input.side ||
        replay.points !== input.points
      ) {
        throw new DennisError(
          "idempotency_conflict",
          "idempotency key reused with different content",
          409,
        );
      }
      return replay;
    }
    const m = requireMarket(ctx, input.marketId);
    if (m.status !== "open")
      throw new DennisError("invalid_state", `market is ${m.status}, positions are closed`, 409);
    if (input.side !== "back" && input.side !== "fade")
      throw new DennisError("validation_error", "side must be back or fade", 400);
    await ctx.consent.require(input.userId, "shortme_free_play");
    const part = ctx.db
      .select()
      .from(marketParticipants)
      .where(
        and(eq(marketParticipants.marketId, m.id), eq(marketParticipants.userId, input.userId)),
      )
      .get();
    const isSubject = m.subjectUserId === input.userId;
    if (!part || (!isSubject && !["invited", "accepted"].includes(part.inviteState))) {
      throw new DennisError(
        "forbidden",
        "only the subject and invited friends may take a position",
        403,
      );
    }
    const existing = ctx.db
      .select()
      .from(marketPositions)
      .where(and(eq(marketPositions.marketId, m.id), eq(marketPositions.userId, input.userId)))
      .get();
    if (existing) throw new DennisError("conflict", "one position per user per market", 409);
    ensureStarterGrant(ctx, input.userId);
    const balance = getBalance(ctx, input.userId);
    const cap = Math.min(GATES.maxStake, balance);
    if (!Number.isInteger(input.points) || input.points < 1 || input.points > cap) {
      throw new DennisError(
        "validation_error",
        `points must be a whole number from 1 to ${cap}`,
        400,
        { maxStake: GATES.maxStake, balance },
      );
    }
    const id = ctx.ids.next("position");
    const createdAt = ctx.clock.nowIso();
    const posted = ctx.db.transaction((tx) => {
      tx.insert(marketPositions)
        .values({
          id,
          marketId: m.id,
          userId: input.userId,
          side: input.side,
          points: input.points,
          idempotencyKey: input.idempotencyKey,
          createdAt,
        })
        .run();
      if (!isSubject)
        tx.update(marketParticipants)
          .set({ inviteState: "accepted" })
          .where(
            and(eq(marketParticipants.marketId, m.id), eq(marketParticipants.userId, input.userId)),
          )
          .run();
      return postLedgerTx(ctx, tx as never, [
        {
          userId: input.userId,
          marketId: m.id,
          kind: "stake",
          delta: -input.points,
          refId: id,
          idempotencyKey: `stake:${id}`,
        },
      ]);
    });
    const agent = await ctx.users.getAgentByUserId(input.userId);
    const agentId = agent?.id ?? "unknown";
    emitPositionPlaced(ctx, {
      opportunityId: m.opportunityId,
      marketId: m.id,
      agentId,
      side: input.side,
      points: input.points,
      selfShort: isSubject && input.side === "fade",
    });
    const inv = await checkLedgerInvariants(ctx);
    emitLedgerPosted(ctx, {
      opportunityId: m.opportunityId,
      marketId: m.id,
      entries: posted.map((p) => ({
        agentId,
        kind: p.kind,
        delta: p.delta,
        balanceAfter: p.balanceAfter,
      })),
      invariantOk: inv.every((c) => c.ok),
    });
    if (!isSubject && agent) {
      await ctx.a2a.send({
        type: "market.invite_response",
        fromAgentId: agent.id,
        toAgentId: m.subjectAgentId,
        conversationId: `cnv_${m.sourceIntentId ?? m.id}`,
        opportunityId: m.opportunityId,
        payload: { marketId: m.id, response: "accepted" },
        idempotencyKey: `market.invite_response:${m.id}:${input.userId}:accepted`,
      });
    }
    ctx.log.info("shortme.position", {
      marketId: m.id,
      side: input.side,
      points: input.points,
      via: input.via,
    });
    return {
      id,
      marketId: m.id,
      userId: input.userId,
      side: input.side,
      points: input.points,
      idempotencyKey: input.idempotencyKey,
      createdAt,
    };
  });
}

interface Candidate {
  marketId: string;
  code: string | null;
  isSubject: boolean;
}

// Markets where the user can act right now: open, no position yet, and either the subject or a friend
// whose invitation is still open.
function openCandidates(ctx: PlatformContext, userId: string): Candidate[] {
  const rows = ctx.db
    .select({
      marketId: marketParticipants.marketId,
      code: marketInvites.code,
      role: marketParticipants.role,
      state: marketParticipants.inviteState,
    })
    .from(marketParticipants)
    .innerJoin(markets, eq(markets.id, marketParticipants.marketId))
    .leftJoin(
      marketInvites,
      and(
        eq(marketInvites.marketId, marketParticipants.marketId),
        eq(marketInvites.userId, marketParticipants.userId),
      ),
    )
    .where(and(eq(marketParticipants.userId, userId), eq(markets.status, "open")))
    .all();
  const positioned = new Set(
    ctx.db
      .select({ m: marketPositions.marketId })
      .from(marketPositions)
      .where(
        and(
          eq(marketPositions.userId, userId),
          inArray(marketPositions.marketId, rows.map((r) => r.marketId).concat("")),
        ),
      )
      .all()
      .map((r) => r.m),
  );
  return rows
    .filter(
      (r) =>
        !positioned.has(r.marketId) &&
        (r.role === "subject" || r.state === "invited" || r.state === "accepted"),
    )
    .map((r) => ({
      marketId: r.marketId,
      code: r.code,
      isSubject: r.role === "subject",
    }));
}

function resolveCandidate(
  ctx: PlatformContext,
  userId: string,
  code: string | null,
  verb: string,
): { candidate?: Candidate; reply?: string } {
  const all = openCandidates(ctx, userId);
  if (code) {
    const hit = all.find((c) => c.code !== null && c.code.toLowerCase() === code.toLowerCase());
    return hit ? { candidate: hit } : { reply: `no open market with code ${code.toLowerCase()}.` };
  }
  if (all.length === 1) return { candidate: all[0] };
  if (all.length === 0) return { reply: "no open market for you rn." };
  return { reply: `which one? ${verb} plus the 4-letter code.` };
}

function friendlyError(err: unknown): string {
  if (err instanceof DennisError) {
    if (err.code === "consent_required")
      return "you're not in on ShortMe yet. reply AGREE SHORTME to confirm you're 18+.";
    if (err.code === "validation_error")
      return `can't do that amount. $${GATES.dollarsPerPoint} steps, up to ${dollars(GATES.maxStake)} and only what you've got.`;
    return `can't do that: ${err.message}.`;
  }
  return "something broke, nothing was recorded.";
}

async function placeAndDescribe(
  ctx: PlatformContext,
  input: {
    marketId: string;
    userId: string;
    side: "back" | "fade";
    points: number;
    messageId: string;
    isSubject: boolean;
  },
): Promise<string> {
  const m = requireMarket(ctx, input.marketId);
  const p = await placePosition(ctx, {
    marketId: input.marketId,
    userId: input.userId,
    side: input.side,
    points: input.points,
    idempotencyKey: `cmd:${input.messageId}`,
    via: "imessage",
  });
  onStakeMessage(ctx, {
    inboundMessageId: input.messageId,
    isSubject: input.isSubject,
    side: input.side,
    userId: input.userId,
  });
  const [me, subject] = await Promise.all([
    ctx.users.get(input.userId),
    ctx.users.get(m.subjectUserId),
  ]);
  return stakeRecordedText({
    first: me?.firstName ?? "you",
    subjectFirst: subject?.firstName ?? "them",
    side: input.side,
    points: p.points,
    isSubject: input.isSubject,
  });
}

// BACK $N and FADE $N: amounts are sim dollars (1 ledger point = GATES.dollarsPerPoint).
export function backFadeHandler(ctx: PlatformContext, side: "back" | "fade") {
  return async (input: CommandInput): Promise<{ reply?: string }> => {
    const cmd = input.command as { kind: string; points?: number; code: string | null };
    const verb = side === "back" ? "BACK $amt" : "FADE $amt";
    const { candidate, reply } = resolveCandidate(ctx, input.userId, cmd.code ?? null, verb);
    if (!candidate) return { reply };
    const points = dollarsToPoints(cmd.points ?? 0);
    if (points === null)
      return { reply: friendlyError(new DennisError("validation_error", "amount", 400)) };
    try {
      return {
        reply: await placeAndDescribe(ctx, {
          marketId: candidate.marketId,
          userId: input.userId,
          side,
          points,
          messageId: input.messageId,
          isSubject: candidate.isSubject,
        }),
      };
    } catch (err) {
      return { reply: friendlyError(err) };
    }
  };
}

export function passHandler(ctx: PlatformContext) {
  return async (input: CommandInput): Promise<{ reply?: string }> => {
    const cmd = input.command as { code: string | null };
    const { candidate, reply } = resolveCandidate(ctx, input.userId, cmd.code ?? null, "PASS");
    if (!candidate) return { reply };
    if (candidate.isSubject)
      return { reply: "it's your market lol. you can still short yourself." };
    try {
      await passInvite(ctx, { marketId: candidate.marketId, userId: input.userId });
      return { reply: "passed. no money moved." };
    } catch (err) {
      return { reply: friendlyError(err) };
    }
  };
}

// Proposed command shape for "i'll put $500", "run it. i'll put $500", "lowk sure. $20 tho"
// (CR-A3-007). Parsing stays deterministic in the platform; this handler only applies rules.
export interface PutCommand {
  kind: "put";
  dollars: number;
  approve: boolean;
  code: string | null;
}

// "i'll put $X": the side comes from the speaker's role. The subject shorts themself (buys insurance
// on their own outcome); a friend backs the subject. When the speaker has a pending publish_market
// approval, putting money in approves it first, then stakes.
export function putHandler(ctx: PlatformContext) {
  return async (input: CommandInput): Promise<{ reply?: string }> => {
    const cmd = input.command as unknown as PutCommand;
    const points = dollarsToPoints(cmd.dollars);
    if (points === null)
      return { reply: friendlyError(new DennisError("validation_error", "amount", 400)) };
    const pending = (await ctx.approvals.findPending(input.userId, cmd.code ?? null)).filter(
      (a) => a.kind === "publish_market",
    );
    const open = openCandidates(ctx, input.userId);
    if (pending.length === 1 && (cmd.approve || open.length === 0)) {
      const approval = pending[0]!;
      const m = marketByOpportunity(ctx, approval.opportunityId);
      if (!m) return { reply: "that market's gone." };
      stakingOnPublish.add(m.id);
      try {
        await ctx.approvals.decide({
          approvalId: approval.id,
          userId: input.userId,
          decision: "approve",
          via: "imessage",
        });
        await placeAndDescribe(ctx, {
          marketId: m.id,
          userId: input.userId,
          side: "fade",
          points,
          messageId: input.messageId,
          isSubject: true,
        });
      } catch (err) {
        return { reply: friendlyError(err) };
      } finally {
        stakingOnPublish.delete(m.id);
      }
      const live = requireMarket(ctx, m.id);
      // Dennis already said its piece on dating markets; recruiting gets the "Market created" line,
      // sent with a slam, into the market's group when it has one.
      if (live.category !== "dating") {
        const { spaceId, isGroup } = marketSpace(ctx, live);
        await ctx.notifier.send({
          userId: input.userId,
          kind: "info",
          text: marketCreatedText({
            question: live.question,
            subjectStakePoints: points,
            category: live.category,
            mode: ctx.config.conversationMode,
          }),
          effect: "slam",
          ...(isGroup && spaceId ? { spaceId } : {}),
          opportunityId: live.opportunityId,
          idempotencyKey: `market_created:${live.id}`,
        });
      }
      return {};
    }
    const { candidate, reply } = resolveCandidate(
      ctx,
      input.userId,
      cmd.code ?? null,
      "i'll put $amt",
    );
    if (!candidate) return { reply };
    try {
      return {
        reply: await placeAndDescribe(ctx, {
          marketId: candidate.marketId,
          userId: input.userId,
          side: candidate.isSubject ? "fade" : "back",
          points,
          messageId: input.messageId,
          isSubject: candidate.isSubject,
        }),
      };
    } catch (err) {
      return { reply: friendlyError(err) };
    }
  };
}

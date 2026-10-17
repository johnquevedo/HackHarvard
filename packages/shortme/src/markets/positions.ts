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
import { emitLedgerPosted, emitPositionPlaced } from "./events";
import { passInvite, requireMarket } from "./service";

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
    return hit
      ? { candidate: hit }
      : {
          reply: `No open ShortMe invitation with code ${code.toUpperCase()}.`,
        };
  }
  if (all.length === 1) return { candidate: all[0] };
  if (all.length === 0) return { reply: "No open ShortMe market for you right now." };
  return {
    reply: `Which one? Reply ${verb} followed by the 4-character code.`,
  };
}

function friendlyError(err: unknown): string {
  if (err instanceof DennisError) {
    if (err.code === "consent_required")
      return "ShortMe is off for you. Reply AGREE SHORTME to confirm you are 18+ and turn it on.";
    return `Could not do that: ${err.message}.`;
  }
  return "Something went wrong, nothing was recorded.";
}

export function backFadeHandler(ctx: PlatformContext, side: "back" | "fade") {
  return async (input: CommandInput): Promise<{ reply?: string }> => {
    const cmd = input.command as {
      kind: string;
      points?: number;
      code: string | null;
    };
    const verb = side === "back" ? "BACK <pts>" : "FADE <pts>";
    const { candidate, reply } = resolveCandidate(ctx, input.userId, cmd.code ?? null, verb);
    if (!candidate) return { reply };
    try {
      const p = await placePosition(ctx, {
        marketId: candidate.marketId,
        userId: input.userId,
        side,
        points: cmd.points ?? 0,
        idempotencyKey: `cmd:${input.messageId}`,
        via: "imessage",
      });
      const self = candidate.isSubject && side === "fade" ? " You shorted yourself, bold." : "";
      return {
        reply: `Recorded: ${side.toUpperCase()} ${p.points} points (fictional, no value). Balance ${getBalance(ctx, input.userId)}.${self}`,
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
      return {
        reply: "It's your market, so there is nothing to pass. You can FADE yourself if you like.",
      };
    try {
      await passInvite(ctx, {
        marketId: candidate.marketId,
        userId: input.userId,
      });
      return { reply: "Passed. No points moved." };
    } catch (err) {
      return { reply: friendlyError(err) };
    }
  };
}

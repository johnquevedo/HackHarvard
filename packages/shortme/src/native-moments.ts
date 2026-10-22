import { DennisError, type NativeEffectT } from "@dennis/contracts";
import type { PlatformContext } from "@dennis/platform";
import {
  isGroupSpace,
  queueNative,
  registerPollVoteHandler,
  spaceForUser,
  spaceOfInbound,
} from "@dennis/platform";
import { placePosition } from "./markets/positions";
import { requireMarket, type MarketRow } from "./markets/service";
import { stakeRecordedText, voiceName, dollars } from "./templates";

// The iMessage-native side of ShortMe: what Dennis does in the chat besides texting.
//   proposed   -> 💀 tapback on the message that started it
//   opened     -> group renamed to a ticker ("📉 $JOHN short squeeze"), the market as a native poll
//   staked     -> ‼️ tapback on the stake message (😂 when someone shorts themself)
//   poll vote  -> a real position at the poll stake
//   settled    -> the result line with a send effect, ticker renamed again, a "closing bell" voice note
// Everything is best effort: providers without native features skip, the market flow never waits.

export const POLL_TAG_PREFIX = "shortme.poll:";
/** Sim dollars a poll vote stakes. */
export const POLL_STAKE_DOLLARS = 100;

function ticker(first: string): string {
  return (
    "$" +
    first
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 8)
  );
}

/** The conversation a market lives in: the space its source message came from, else the subject's. */
export function marketSpace(
  ctx: PlatformContext,
  m: MarketRow,
): { spaceId: string | null; isGroup: boolean } {
  const fromSource = m.sourceIntentId
    ? (ctx.db.$client
        .prepare(
          "SELECT i.provider_space_id AS spaceId FROM intents t JOIN inbound_messages i ON i.id = t.source_message_id WHERE t.id = ?",
        )
        .get(m.sourceIntentId) as { spaceId: string | null } | undefined)
    : undefined;
  const spaceId = fromSource?.spaceId ?? spaceForUser(ctx, m.subjectUserId);
  return { spaceId, isGroup: isGroupSpace(ctx, spaceId) };
}

/** True when `userId` currently reads the market's group chat, so a per-person message would repeat. */
export function readsMarketGroup(ctx: PlatformContext, m: MarketRow, userId: string): boolean {
  const { spaceId, isGroup } = marketSpace(ctx, m);
  return isGroup && spaceId !== null && spaceForUser(ctx, userId) === spaceId;
}

function sourceMessageId(ctx: PlatformContext, m: MarketRow): string | null {
  if (!m.sourceIntentId) return null;
  const r = ctx.db.$client
    .prepare("SELECT source_message_id AS id FROM intents WHERE id = ?")
    .get(m.sourceIntentId) as { id: string | null } | undefined;
  return r?.id ?? null;
}

export function pollOptions(m: MarketRow, subjectFirst: string): [string, string] {
  const name = voiceName(subjectFirst);
  const stake = dollars(POLL_STAKE_DOLLARS / 10);
  if (m.category === "dating") return [`👻 ghosted · ${stake}`, `💘 not ghosted · ${stake}`];
  return [`📈 long ${name} · ${stake}`, `📉 short ${name} · ${stake}`];
}

export function onMarketProposed(ctx: PlatformContext, m: MarketRow): void {
  const source = sourceMessageId(ctx, m);
  if (!source || !spaceOfInbound(ctx, source)) return;
  queueNative(ctx, {
    userId: m.subjectUserId,
    payload: { kind: "react", targetMessageId: source, emoji: "💀" },
    idempotencyKey: `shortme.native:proposed:${m.id}`,
  });
}

export async function onMarketOpened(ctx: PlatformContext, m: MarketRow): Promise<void> {
  const { spaceId, isGroup } = marketSpace(ctx, m);
  if (!spaceId) return;
  const subject = await ctx.users.get(m.subjectUserId);
  const first = subject?.firstName ?? "them";
  if (isGroup)
    queueNative(ctx, {
      userId: m.subjectUserId,
      spaceId,
      payload: { kind: "rename", name: `📉 ${ticker(first)} short squeeze` },
      idempotencyKey: `shortme.native:rename-open:${m.id}`,
    });
  queueNative(ctx, {
    userId: m.subjectUserId,
    spaceId,
    tag: POLL_TAG_PREFIX + m.id,
    payload: { kind: "poll", title: m.question, options: pollOptions(m, first) },
    idempotencyKey: `shortme.native:poll:${m.id}`,
  });
}

/** ‼️ on a stake message; 😂 when the subject shorts themself. */
export function onStakeMessage(
  ctx: PlatformContext,
  input: { inboundMessageId: string; isSubject: boolean; side: "back" | "fade"; userId: string },
): void {
  if (!spaceOfInbound(ctx, input.inboundMessageId)) return;
  queueNative(ctx, {
    userId: input.userId,
    payload: {
      kind: "react",
      targetMessageId: input.inboundMessageId,
      emoji: input.isSubject && input.side === "fade" ? "😂" : "‼️",
    },
    idempotencyKey: `shortme.native:stake:${input.inboundMessageId}`,
  });
}

/** Send effect for the settlement line: fireworks when they did it, loud when they took the L. */
export function resultEffect(outcome: "yes" | "no" | "void"): NativeEffectT | undefined {
  return outcome === "yes" ? "fireworks" : outcome === "no" ? "loud" : undefined;
}

export async function onMarketSettled(
  ctx: PlatformContext,
  m: MarketRow,
  rows: { firstName: string; net: number }[],
): Promise<void> {
  const { spaceId, isGroup } = marketSpace(ctx, m);
  if (!spaceId) return;
  const subject = await ctx.users.get(m.subjectUserId);
  const first = subject?.firstName ?? "them";
  const outcome = (m.outcome ?? "void") as "yes" | "no" | "void";
  if (isGroup)
    queueNative(ctx, {
      userId: m.subjectUserId,
      spaceId,
      payload: {
        kind: "rename",
        name:
          outcome === "yes"
            ? `📈 ${ticker(first)} to the moon`
            : outcome === "no"
              ? `💀 ${ticker(first)} delisted`
              : `🤝 ${ticker(first)} void`,
      },
      idempotencyKey: `shortme.native:rename-settled:${m.id}`,
    });
  queueNative(ctx, {
    userId: m.subjectUserId,
    spaceId,
    payload: { kind: "voice", text: closingBell(m, first, rows) },
    idempotencyKey: `shortme.native:voice:${m.id}`,
  });
}

/** The voice note script: deadpan market-close read, amounts spelled for speech. */
export function closingBell(
  m: MarketRow,
  first: string,
  rows: { firstName: string; net: number }[],
): string {
  const name = voiceName(first);
  const outcome = m.outcome ?? "void";
  const head =
    outcome === "yes"
      ? `${name} did it. longs get paid.`
      : outcome === "no"
        ? `${name} took the L. insurance paid out.`
        : `market on ${name} is void. everyone got their money back.`;
  const moves = rows
    .filter((r) => r.net !== 0)
    .map(
      (r) =>
        `${voiceName(r.firstName)} ${r.net > 0 ? "up" : "down"} ${Math.abs(r.net) * 10} dollars`,
    )
    .join(". ");
  return `closing bell. ${head}${moves ? ` ${moves}.` : ""} sim money only. this has been dennis.`;
}

/** Poll votes become positions at POLL_STAKE_DOLLARS: first option backs, second fades. */
export function registerShortmePollVotes(ctx: PlatformContext): void {
  registerPollVoteHandler(ctx, POLL_TAG_PREFIX, async (vote) => {
    const marketId = vote.tag.slice(POLL_TAG_PREFIX.length);
    if (!vote.selected)
      return { note: "unvote_ignored", reply: "positions are final lol. no take backs." };
    const side = vote.optionIndex === 0 ? "back" : "fade";
    let m: MarketRow;
    try {
      m = requireMarket(ctx, marketId);
    } catch {
      return { note: "market_missing" };
    }
    try {
      const p = await placePosition(ctx, {
        marketId,
        userId: vote.userId,
        side,
        points: POLL_STAKE_DOLLARS / 10,
        idempotencyKey: `poll:${vote.actionId}:${vote.userId}`,
        via: "imessage",
      });
      const [me, subject] = await Promise.all([
        ctx.users.get(vote.userId),
        ctx.users.get(m.subjectUserId),
      ]);
      return {
        note: "placed",
        reply: stakeRecordedText({
          first: me?.firstName ?? "you",
          subjectFirst: subject?.firstName ?? "them",
          side,
          points: p.points,
          isSubject: vote.userId === m.subjectUserId,
        }),
      };
    } catch (err) {
      // A second vote, even on the other option, is the same person trying again.
      if (
        err instanceof DennisError &&
        (err.code === "conflict" || err.code === "idempotency_conflict")
      )
        return { note: "already_in", reply: "you're already in on this one." };
      if (err instanceof DennisError && err.code === "invalid_state")
        return { note: "closed", reply: "market's closed, too late." };
      if (err instanceof DennisError && err.code === "consent_required")
        return {
          note: "no_consent",
          reply: "you're not in on ShortMe yet. reply AGREE SHORTME to confirm you're 18+.",
        };
      return { note: err instanceof DennisError ? err.code : "error" };
    }
  });
}

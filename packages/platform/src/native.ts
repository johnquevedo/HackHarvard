import { DennisError, type InboundMessageT } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { insert, row, rows, update } from "./storage.ts";
import { createSpeechSynth, type SpeechSynth } from "./tts.ts";

// Native iMessage actions: tapbacks, polls, group renames, voice notes, contact cards. Features queue
// them; dispatchNative sends them right after the outbox so they land in conversation order. Every
// action is idempotent, audited in native_actions, visible as a `native.action` event, and never
// blocks the product flow: providers without the capability record `unsupported` and move on.

export type NativeKind = "react" | "poll" | "rename" | "voice" | "contact_card";

export type NativePayload =
  | { kind: "react"; targetMessageId: string; emoji: string }
  | { kind: "poll"; title: string; options: string[] }
  | { kind: "rename"; name: string }
  | { kind: "voice"; text: string }
  | { kind: "contact_card" };

export interface QueueNativeInput {
  userId: string;
  /** Provider space; defaults to the user's current conversation (group when they are in one). */
  spaceId?: string | null;
  /** Lets features find their own actions again, for example `shortme.poll:mkt_x`. */
  tag?: string;
  payload: NativePayload;
  idempotencyKey: string;
}

interface StoredAction {
  id: string;
  kind: NativeKind;
  userId: string;
  spaceId: string | null;
  tag: string | null;
  payload: NativePayload;
  status: string;
  providerMessageId: string | null;
}

export interface PollVoteInput {
  actionId: string;
  tag: string;
  userId: string;
  agentId: string;
  option: string;
  optionIndex: number;
  selected: boolean;
  spaceId: string | null;
  inboundMessageId: string;
}
export interface PollVoteHandler {
  (vote: PollVoteInput): Promise<{ reply?: string; note: string }>;
}

const voteHandlers = new WeakMap<PlatformContext, { prefix: string; handler: PollVoteHandler }[]>();
const synths = new WeakMap<PlatformContext, SpeechSynth>();

export function registerPollVoteHandler(
  ctx: PlatformContext,
  tagPrefix: string,
  handler: PollVoteHandler,
): void {
  voteHandlers.set(ctx, [...(voteHandlers.get(ctx) ?? []), { prefix: tagPrefix, handler }]);
}

/** Tests and other runtimes can swap the voice engine (defaults to macOS `say`). */
export function setSpeechSynth(ctx: PlatformContext, synth: SpeechSynth): void {
  synths.set(ctx, synth);
}

function synthFor(ctx: PlatformContext): SpeechSynth {
  let synth = synths.get(ctx);
  if (!synth) {
    synth = createSpeechSynth({ voice: process.env.DENNIS_VOICE || undefined });
    synths.set(ctx, synth);
  }
  return synth;
}

function emitAction(
  ctx: PlatformContext,
  a: { id: string; kind: NativeKind; status: string; detail: string },
) {
  ctx.events.emit({
    type: "native.action",
    actor: { kind: "system" },
    visibility: "shared",
    payload: {
      actionId: a.id,
      kind: a.kind,
      status: a.status as never,
      detail: a.detail.slice(0, 120),
    },
  });
}

function detailOf(p: NativePayload): string {
  switch (p.kind) {
    case "react":
      return p.emoji;
    case "poll":
      return p.title;
    case "rename":
      return p.name;
    case "voice":
      return p.text;
    case "contact_card":
      return "contact card";
  }
}

// ---------- spaces ----------

/** The space a user's messages currently go to: their group when one was seen, else their DM. */
export function spaceForUser(ctx: PlatformContext, userId: string): string | null {
  return (
    row<{ photonSpaceId: string }>(
      ctx.db,
      "SELECT photon_space_id FROM photon_spaces WHERE user_id=?",
      userId,
    )?.photonSpaceId ?? null
  );
}

export function rememberSpaceKind(
  ctx: PlatformContext,
  spaceId: string,
  kind: "group" | "direct",
): void {
  ctx.db.$client
    .prepare(
      "INSERT INTO kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run("space-kind:" + spaceId, JSON.stringify(kind));
}

export function isGroupSpace(ctx: PlatformContext, spaceId: string | null): boolean {
  if (!spaceId) return false;
  return (
    row<{ value: string }>(ctx.db, "SELECT value FROM kv WHERE key=?", "space-kind:" + spaceId)
      ?.value === "group"
  );
}

/** The provider space an inbound message arrived in (null for unknown or provider-less messages). */
export function spaceOfInbound(ctx: PlatformContext, inboundMessageId: string): string | null {
  return (
    row<{ providerSpaceId: string | null }>(
      ctx.db,
      "SELECT provider_space_id FROM inbound_messages WHERE id=?",
      inboundMessageId,
    )?.providerSpaceId ?? null
  );
}

// ---------- queue ----------

export function queueNative(ctx: PlatformContext, input: QueueNativeInput): string {
  const existing = row<{ id: string }>(
    ctx.db,
    "SELECT id FROM native_actions WHERE idempotency_key=?",
    input.idempotencyKey,
  );
  if (existing) return existing.id;
  const id = ctx.ids.next("native");
  const spaceId = input.spaceId === undefined ? spaceForUser(ctx, input.userId) : input.spaceId;
  insert(ctx.db, "native_actions", {
    id,
    kind: input.payload.kind,
    userId: input.userId,
    spaceId,
    tag: input.tag ?? null,
    payload: input.payload,
    status: "queued",
    providerMessageId: null,
    error: null,
    idempotencyKey: input.idempotencyKey,
    createdAt: ctx.clock.nowIso(),
    sentAt: null,
  });
  emitAction(ctx, {
    id,
    kind: input.payload.kind,
    status: "queued",
    detail: detailOf(input.payload),
  });
  return id;
}

function finish(
  ctx: PlatformContext,
  a: StoredAction,
  status: "sent" | "failed" | "unsupported" | "skipped",
  extra: { providerMessageId?: string; error?: string } = {},
) {
  update(
    ctx.db,
    "native_actions",
    {
      status,
      providerMessageId: extra.providerMessageId ?? null,
      error: extra.error ?? null,
      sentAt: ctx.clock.nowIso(),
    },
    "id=?",
    a.id,
  );
  emitAction(ctx, { id: a.id, kind: a.kind, status, detail: extra.error ?? detailOf(a.payload) });
}

async function sendOne(ctx: PlatformContext, a: StoredAction): Promise<void> {
  const native = ctx.messaging.native;
  if (!native)
    return finish(ctx, a, "unsupported", { error: "provider has no native iMessage features" });
  const p = a.payload;
  if (p.kind === "react") {
    const target = row<{ providerMessageId: string; providerSpaceId: string | null }>(
      ctx.db,
      "SELECT provider_message_id,provider_space_id FROM inbound_messages WHERE id=?",
      p.targetMessageId,
    );
    if (!target?.providerSpaceId)
      return finish(ctx, a, "skipped", { error: "target message has no space" });
    await native.react(
      { spaceId: target.providerSpaceId, providerMessageId: target.providerMessageId },
      p.emoji,
    );
    return finish(ctx, a, "sent");
  }
  if (!a.spaceId) return finish(ctx, a, "skipped", { error: "no conversation for this user yet" });
  switch (p.kind) {
    case "poll": {
      const sent = await native.sendPoll(a.spaceId, p.title, p.options);
      return finish(ctx, a, "sent", { providerMessageId: sent.providerMessageId });
    }
    case "rename":
      if (!isGroupSpace(ctx, a.spaceId))
        return finish(ctx, a, "skipped", { error: "only group chats can be renamed" });
      await native.renameGroup(a.spaceId, p.name);
      return finish(ctx, a, "sent");
    case "voice": {
      const speech = await synthFor(ctx)(p.text);
      if (!speech) return finish(ctx, a, "skipped", { error: "no local speech engine" });
      const sent = await native.sendVoice(
        a.spaceId,
        speech.audio,
        speech.mimeType,
        speech.durationSeconds,
      );
      return finish(ctx, a, "sent", { providerMessageId: sent.providerMessageId });
    }
    case "contact_card":
      await native.shareContactCard(a.spaceId);
      return finish(ctx, a, "sent");
  }
}

/** Sends queued native actions in creation order. Called by the runtime right after the outbox. */
export async function dispatchNative(ctx: PlatformContext): Promise<number> {
  // Serialized so overlapping runtime ticks never send the same action twice.
  return ctx.runExclusive("native:dispatch", async () => {
    const queued = rows<StoredAction>(
      ctx.db,
      "SELECT * FROM native_actions WHERE status='queued' ORDER BY created_at, rowid LIMIT 25",
    );
    for (const a of queued) {
      try {
        await sendOne(ctx, a);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.log.warn("Native iMessage action failed", {
          kind: a.kind,
          error: message.slice(0, 200),
        });
        finish(ctx, a, "failed", { error: message.slice(0, 200) });
      }
    }
    return queued.length;
  });
}

export function nativeActions(
  ctx: PlatformContext,
  filter: { tag?: string; userId?: string } = {},
): StoredAction[] {
  return rows<StoredAction>(
    ctx.db,
    "SELECT * FROM native_actions WHERE (? IS NULL OR tag=?) AND (? IS NULL OR user_id=?) ORDER BY created_at, rowid",
    filter.tag ?? null,
    filter.tag ?? null,
    filter.userId ?? null,
    filter.userId ?? null,
  );
}

// ---------- poll votes ----------

/**
 * Routes a vote on one of Dennis's polls to the feature that sent it. Called by ingestInbound after
 * identity, group membership, and consent checks passed.
 */
export async function handlePollVote(
  ctx: PlatformContext,
  msg: InboundMessageT,
  user: { id: string },
  agent: { id: string },
  inboundMessageId: string,
): Promise<{ reply?: string; ok: boolean; note: string }> {
  const vote = msg.pollVote;
  if (!vote) throw new DennisError("validation_error", "not a poll vote", 400);
  const poll = row<StoredAction>(
    ctx.db,
    "SELECT * FROM native_actions WHERE kind='poll' AND provider_message_id=?",
    vote.pollMessageId,
  );
  const emit = (ok: boolean, note: string) =>
    ctx.events.emit({
      type: "poll.vote",
      actor: { kind: "user", agentId: agent.id, userId: user.id },
      visibility: "shared",
      payload: {
        actionId: poll?.id ?? "unknown",
        option: vote.option,
        selected: vote.selected,
        ok,
        note,
      },
    });
  if (!poll || poll.payload.kind !== "poll" || !poll.tag) {
    emit(false, "not_a_dennis_poll");
    return { ok: false, note: "not_a_dennis_poll" };
  }
  const optionIndex = poll.payload.options.findIndex((o) => o === vote.option);
  const route = (voteHandlers.get(ctx) ?? []).find((h) => poll.tag!.startsWith(h.prefix));
  if (optionIndex < 0 || !route) {
    emit(false, optionIndex < 0 ? "unknown_option" : "no_handler");
    return { ok: false, note: optionIndex < 0 ? "unknown_option" : "no_handler" };
  }
  const result = await route.handler({
    actionId: poll.id,
    tag: poll.tag,
    userId: user.id,
    agentId: agent.id,
    option: vote.option,
    optionIndex,
    selected: vote.selected,
    spaceId: msg.providerSpaceId ?? poll.spaceId,
    inboundMessageId,
  });
  emit(true, result.note);
  return { ok: true, ...result };
}

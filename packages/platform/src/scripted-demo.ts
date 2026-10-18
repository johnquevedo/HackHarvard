import type { InboundMessageT } from "@dennis/contracts";
import { normalizeHandle } from "@dennis/messaging";
import type { PlatformContext } from "./context.ts";
import { insert, row } from "./storage.ts";
import { DEMO_SCRIPTS, type DemoScript } from "./demo-scripts.ts";

// TEMPORARY video-recording mode (DEMO_SCRIPT=video). When a group-chat message matches one of the
// scripted lines below, Dennis posts the scripted replies word for word and nothing else. No detector,
// market, purchase, or payment runs; every other message is ignored so the recording stays clean.
// Remove this file and its hook in pipeline.ts once the video is recorded.

export interface ScriptedTurn {
  from: "john" | "steven" | "isaac";
  text: string;
  replies: string[];
}

export const VIDEO_SCRIPT: ScriptedTurn[] = [
  {
    from: "john",
    text: "i’m so cooked im failing my meta technical tmr",
    replies: [
      "yo michael why don’t you short yourself, i’ll set up a market. anyone wanna get in on this?",
    ],
  },
  {
    from: "john",
    text: "LMAO run it. I’ll put $500",
    replies: ['market created: "will michael pass his meta final round?" $500 insurance for sale'],
  },
  {
    from: "steven",
    text: "nah you got that. I’ll put $200 on it. bro ima ask this girl out tn am i chopped?",
    replies: [
      "ur chopped, thats a high risk asset. wanna open a market on whether or not she ghosts you?",
    ],
  },
  {
    from: "steven",
    text: "💀💀lowk sure. $20 tho. i think she likes me.",
    replies: [],
  },
  {
    from: "isaac",
    text: "also anyone tryna buy a monitor? mine's cooked",
    replies: [
      "wait. found a match. another friend's agent has been tracking the same monitor.",
      "found a group deal that saves you both $40 each. want me to coordinate?",
    ],
  },
  {
    from: "isaac",
    text: "yeah do it",
    replies: [
      "both approved. group purchase organized. simulated nessie payment ready for confirmation.",
    ],
  },
];

// Forgiving about apostrophe style, letter case, and spacing, so a phone keyboard's smart quotes match.
export function normalizeScriptText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// A pasted line may keep the transcript's speaker label, e.g. "john: ..." or "Edward Lai:\n\t...".
const SPEAKER_LABEL = /^\s*[A-Za-z][A-Za-z .'-]{0,30}:\s+/;

export function findScriptedTurn(text: string): ScriptedTurn | null {
  for (const candidate of [text, text.replace(SPEAKER_LABEL, "")]) {
    const normalized = normalizeScriptText(candidate);
    const turn = VIDEO_SCRIPT.find((item) => normalizeScriptText(item.text) === normalized);
    if (turn) return turn;
  }
  return null;
}

async function senderUserId(ctx: PlatformContext, msg: InboundMessageT): Promise<string | null> {
  try {
    const user = await ctx.users.getByHandle(normalizeHandle(msg.senderHandle).handle);
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/** Handles the message in video mode. Always consumes it; replies only on a scripted line. */
export async function handleScriptedDemo(
  ctx: PlatformContext,
  msg: InboundMessageT,
): Promise<{ messageId: string; outcome: "command" | "ignored" }> {
  const turn = findScriptedTurn(msg.text);
  const userId = await senderUserId(ctx, msg);
  const messageId = ctx.ids.next("message");
  insert(ctx.db, "inbound_messages", {
    id: messageId,
    provider: msg.provider,
    providerMessageId: msg.providerMessageId,
    providerSpaceId: msg.providerSpaceId,
    userId,
    agentId: null,
    text: userId ? msg.text : null,
    status: turn ? "processed" : "ignored",
    ignoreReason: turn ? null : "scripted_demo_unmatched",
    receivedAt: msg.receivedAt,
    processedAt: ctx.clock.nowIso(),
  });
  if (!turn || turn.replies.length === 0)
    return { messageId, outcome: turn ? "command" : "ignored" };
  // Replies need an owning user row; a sender outside the cast falls back to the scripted speaker.
  const owner = userId ?? "usr_demo_" + turn.from;
  ctx.log.info("Scripted demo reply", { mode: "DEMO_SCRIPT=video", replies: turn.replies.length });
  void sendReplies(ctx, msg, owner, messageId, turn.replies).catch(() =>
    ctx.log.error("Scripted demo reply failed"),
  );
  return { messageId, outcome: "command" };
}

// One reply at a time. The outbox dispatcher shows the typing bubble (TYPING_MS) before each send.
async function sendReplies(
  ctx: PlatformContext,
  msg: InboundMessageT,
  owner: string,
  messageId: string,
  replies: string[],
): Promise<void> {
  const { dispatchOutbox } = await import("./runtime.ts");
  for (const [index, text] of replies.entries()) {
    await ctx.notifier.send({
      userId: owner,
      kind: "info",
      text,
      ...(msg.providerSpaceId ? { spaceId: msg.providerSpaceId } : {}),
      idempotencyKey: `scripted-demo:${messageId}:${index}`,
    });
    // Send now instead of waiting up to a second for the outbox loop.
    await dispatchOutbox(ctx);
  }
}

// ---------- DEMO_SCRIPT=hybrid ----------
// Every script in demo-scripts.ts is live alongside normal Dennis. A message that matches the next line
// of the script this conversation is in (or a distinctive line of any script) gets that script's
// replies word for word and skips normal handling; every other message is handled normally.

const SCRIPT_IDLE_MS = 30 * 60_000;
const SCRIPT_LOOKAHEAD = 4;
const DISTINCTIVE_MIN = 18;

interface ScriptPosition {
  name: string;
  index: number;
  at: string;
}

export function scriptKey(text: string): string {
  const key = text
    .replace(SPEAKER_LABEL, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['‘’ʼ`]/g, "")
    .replace(/[^a-z0-9$]+/g, " ")
    .trim();
  // Punctuation-only lines ("?") match on their exact characters.
  return key || text.replace(SPEAKER_LABEL, "").replace(/\s+/g, "");
}

function conversationOf(msg: InboundMessageT): string {
  if (msg.providerSpaceId) return msg.providerSpaceId;
  try {
    return "direct:" + normalizeHandle(msg.senderHandle).handle;
  } catch {
    return "direct:" + msg.senderHandle;
  }
}

/** Finds the script step a message plays, given where this conversation is in its script. */
// Similarity of two script keys, 0 to 1 (1 - edit distance / longer length), so a typo or a dropped
// word still plays the script.
export function keySimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
}

const NEXT_LINE_SIMILARITY = 0.8;
const ANY_LINE_SIMILARITY = 0.88;

export function matchScriptStep(
  text: string,
  position: ScriptPosition | null,
  now: Date,
): { script: DemoScript; index: number } | null {
  const key = scriptKey(text);
  if (!key) return null;
  if (position && now.getTime() - Date.parse(position.at) < SCRIPT_IDLE_MS) {
    const script = DEMO_SCRIPTS.find((s) => s.name === position.name);
    if (script)
      for (let i = position.index + 1; i <= position.index + SCRIPT_LOOKAHEAD; i++) {
        const step = script.steps[i];
        if (!step) break;
        const target = scriptKey(step.text);
        // Very short lines ("yes", "down", "?") must match exactly; longer ones may carry a typo.
        const needed = target.length < 8 ? 1 : NEXT_LINE_SIMILARITY;
        if (keySimilarity(key, target) >= needed) return { script, index: i };
      }
  }
  if (key.length < DISTINCTIVE_MIN) return null;
  let best: { script: DemoScript; index: number; score: number } | null = null;
  for (const script of DEMO_SCRIPTS)
    script.steps.forEach((step, index) => {
      const target = scriptKey(step.text);
      if (target.length < DISTINCTIVE_MIN) return;
      const score = keySimilarity(key, target);
      if (score < ANY_LINE_SIMILARITY) return;
      // Prefer the closest line; on a tie, prefer a script's first line.
      const current = best as { index: number; score: number } | null;
      if (
        !current ||
        score > current.score ||
        (score === current.score && index === 0 && current.index !== 0)
      )
        best = { script, index, score };
    });
  const winner = best as { script: DemoScript; index: number } | null;
  return winner ? { script: winner.script, index: winner.index } : null;
}

/** Plays a scripted step when the message matches one; returns null to let normal handling run. */
export async function handleHybridScript(
  ctx: PlatformContext,
  msg: InboundMessageT,
): Promise<{ messageId: string; outcome: "command" } | null> {
  const conversation = conversationOf(msg);
  const stateKey = "script-pos:" + conversation;
  const position =
    row<{ value: ScriptPosition }>(ctx.db, "SELECT value FROM kv WHERE key=?", stateKey)?.value ??
    null;
  const match = matchScriptStep(msg.text, position, ctx.clock.now());
  if (!match) return null;
  const step = match.script.steps[match.index]!;
  const userId = await senderUserId(ctx, msg);
  const messageId = ctx.ids.next("message");
  insert(ctx.db, "inbound_messages", {
    id: messageId,
    provider: msg.provider,
    providerMessageId: msg.providerMessageId,
    providerSpaceId: msg.providerSpaceId,
    userId,
    agentId: null,
    text: userId ? msg.text : null,
    status: "command",
    ignoreReason: null,
    receivedAt: msg.receivedAt,
    processedAt: ctx.clock.nowIso(),
  });
  const next: ScriptPosition = {
    name: match.script.name,
    index: match.index,
    at: ctx.clock.nowIso(),
  };
  ctx.db.$client
    .prepare(
      "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(stateKey, JSON.stringify(next));
  ctx.log.info("Scripted demo step", { script: match.script.name, step: match.index });
  const owner =
    userId ??
    row<{ id: string }>(ctx.db, "SELECT id FROM users WHERE is_demo=1 ORDER BY created_at LIMIT 1")
      ?.id;
  if (owner && step.replies.length)
    void sendReplies(ctx, msg, owner, messageId, step.replies).catch(() =>
      ctx.log.error("Scripted demo reply failed"),
    );
  return { messageId, outcome: "command" };
}

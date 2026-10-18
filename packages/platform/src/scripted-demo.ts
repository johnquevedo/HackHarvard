import type { InboundMessageT } from "@dennis/contracts";
import { normalizeHandle } from "@dennis/messaging";
import type { PlatformContext } from "./context.ts";
import { insert } from "./storage.ts";

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

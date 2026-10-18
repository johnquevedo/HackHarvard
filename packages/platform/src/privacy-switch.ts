import type { InboundMessageT } from "@dennis/contracts";
import { normalizeHandle } from "@dennis/messaging";
import type { PlatformContext } from "./context.ts";
import { insert, row } from "./storage.ts";

// "dennis off" / "dennis on", per conversation.
//
// Off: a message containing the exact characters "dennis off" turns Dennis off for that conversation.
// While off, every inbound message there is recorded only as an empty ignored row (no text, no sender)
// so a provider replay can never ingest it later, and nothing else runs: no commands, detectors,
// conversation replies, or planning. Outbound messages already queued for that conversation are held
// unsent. On: the exact message "dennis on" releases the held messages and resumes normal handling.
// Nothing Dennis knew before is deleted, and nothing said while off is ever stored as context.
// The two acknowledgements use the "privacy:" idempotency prefix so they never count as context.

export const PRIVACY_OFF_TRIGGER = "dennis off";
export const PRIVACY_ON_MESSAGE = "dennis on";
export const PRIVACY_ACK_PREFIX = "privacy:";
const OFF_ACK = 'going dark 🤐 not reading anything in here till someone says "dennis on"';
const ON_ACK = "back. picking up exactly where we left off";

function kvKey(conversation: string): string {
  return "privacy-off:" + conversation;
}

export function isPrivacyOff(ctx: PlatformContext, conversation: string): boolean {
  return row(ctx.db, "SELECT key FROM kv WHERE key=?", kvKey(conversation)) !== null;
}

function inboundConversation(msg: InboundMessageT): string {
  if (msg.providerSpaceId) return msg.providerSpaceId;
  try {
    return "direct:" + normalizeHandle(msg.senderHandle).handle;
  } catch {
    return "direct:" + msg.senderHandle;
  }
}

/** The conversation an outbox row will be delivered to, matching inboundConversation. */
export function outboxConversation(
  ctx: PlatformContext,
  item: { id: string; userId: string },
  userHandle: string,
): string {
  const explicit = row<{ value: string }>(
    ctx.db,
    "SELECT value FROM kv WHERE key=?",
    "outbox-route:" + item.id,
  )?.value;
  const space =
    explicit ??
    row<{ photonSpaceId: string }>(
      ctx.db,
      "SELECT photon_space_id FROM photon_spaces WHERE user_id=?",
      item.userId,
    )?.photonSpaceId;
  return space ?? "direct:" + userHandle;
}

async function acknowledge(
  ctx: PlatformContext,
  msg: InboundMessageT,
  messageId: string,
  text: string,
): Promise<void> {
  let userId: string | null = null;
  try {
    userId = (await ctx.users.getByHandle(normalizeHandle(msg.senderHandle).handle))?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return;
  try {
    await ctx.notifier.send({
      userId,
      kind: "info",
      text,
      ...(msg.providerSpaceId ? { spaceId: msg.providerSpaceId } : {}),
      idempotencyKey: PRIVACY_ACK_PREFIX + messageId,
    });
  } catch {
    ctx.log.warn("Privacy acknowledgement unavailable");
  }
}

function recordIgnored(ctx: PlatformContext, msg: InboundMessageT): string {
  const messageId = ctx.ids.next("message");
  insert(ctx.db, "inbound_messages", {
    id: messageId,
    provider: msg.provider,
    providerMessageId: msg.providerMessageId,
    providerSpaceId: msg.providerSpaceId,
    userId: null,
    agentId: null,
    text: null,
    status: "ignored",
    ignoreReason: "privacy_off",
    receivedAt: msg.receivedAt,
    processedAt: ctx.clock.nowIso(),
  });
  return messageId;
}

/**
 * Applies the switch before any other handling. Returns null when the message should be handled
 * normally; otherwise the message was consumed here.
 */
export async function handlePrivacySwitch(
  ctx: PlatformContext,
  msg: InboundMessageT,
): Promise<{ messageId: string; outcome: "ignored" } | null> {
  const conversation = inboundConversation(msg);
  const off = isPrivacyOff(ctx, conversation);
  if (off && msg.text.trim() === PRIVACY_ON_MESSAGE) {
    const messageId = recordIgnored(ctx, msg);
    ctx.db.$client.prepare("DELETE FROM kv WHERE key=?").run(kvKey(conversation));
    ctx.log.info("Privacy switch on");
    await acknowledge(ctx, msg, messageId, ON_ACK);
    return { messageId, outcome: "ignored" };
  }
  if (msg.text.includes(PRIVACY_OFF_TRIGGER)) {
    const messageId = recordIgnored(ctx, msg);
    if (!off) {
      ctx.db.$client
        .prepare("INSERT OR IGNORE INTO kv(key,value) VALUES(?,?)")
        .run(kvKey(conversation), JSON.stringify(ctx.clock.nowIso()));
      ctx.log.info("Privacy switch off");
      await acknowledge(ctx, msg, messageId, OFF_ACK);
    }
    return { messageId, outcome: "ignored" };
  }
  if (off) return { messageId: recordIgnored(ctx, msg), outcome: "ignored" };
  return null;
}

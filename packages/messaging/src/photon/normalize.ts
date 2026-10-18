import { z } from "zod";
import { InboundMessage } from "@dennis/contracts";
import type { InboundMessageT } from "@dennis/contracts";
const Resource = z.object({
  id: z.string().min(1),
  platform: z.literal("imessage"),
  status: z.literal("received"),
  space: z.object({
    id: z.string().min(1),
    kind: z.enum(["direct", "group"]).optional(),
    participantIds: z.array(z.string()).optional(),
  }),
  sentBy: z.object({
    id: z.string().min(1),
    handle: z.string().min(1),
    platform: z.literal("imessage"),
  }),
  receivedBy: z.object({ id: z.string() }).nullish(),
  content: z.object({
    type: z.literal("text"),
    format: z.literal("plain").optional(),
    text: z.string().max(4000),
  }),
  timestamps: z.object({ receivedAt: z.iso.datetime() }),
});
export function normalizePhotonEvent(
  raw: unknown,
  agentUserId: string,
  spaceMode: "direct" | "group" | "either" = "direct",
): InboundMessageT | null {
  // Resource shape is documented. Envelope variants remain subject to a live spike.
  const envelope = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const data =
    envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : null;
  const candidate = data?.message ?? data ?? raw;
  const parsed = Resource.safeParse(candidate);
  if (!parsed.success) return null;
  const msg = parsed.data;
  if (msg.sentBy.id === agentUserId || (msg.receivedBy && msg.receivedBy.id !== agentUserId))
    return null;
  const participants = msg.space.participantIds;
  if (!participants?.includes(agentUserId) || !participants.includes(msg.sentBy.id)) return null;
  const inferredKind = msg.space.kind ?? (participants.length > 2 ? "group" : "direct");
  if (inferredKind === "direct" && participants.length !== 2) return null;
  if (inferredKind === "group" && participants.length < 3) return null;
  if (spaceMode !== "either" && inferredKind !== spaceMode) return null;
  return InboundMessage.parse({
    provider: "photon",
    accountKey: "primary",
    providerMessageId: msg.id,
    providerSpaceId: msg.space.id,
    providerSpaceKind: inferredKind,
    providerParticipantIds: participants,
    providerSenderId: msg.sentBy.id,
    senderHandle: msg.sentBy.handle,
    text: msg.content.text,
    receivedAt: msg.timestamps.receivedAt,
    mode: "live",
  });
}

/**
 * Photon Beta 1.0 (@photon-ai/api 0.5.0) SendContent builders.
 * Shapes match pinned @photon-ai/api SendContent unions.
 * Spectrum Cloud contest surfaces (app/miniapp/contact/voice file) live in
 * spectrum-content.ts + send-spectrum.ts.
 */

export type PhotonReactionAction = "add" | "remove";

export type PhotonSendTextContent = {
  type: "text";
  format: string;
  text: string;
};

export type PhotonSendReactionContent = {
  type: "reaction";
  action: PhotonReactionAction;
  reaction: string;
};

export type PhotonSendTypingContent = {
  type: "space.typing.update";
  typing: boolean;
};

export type PhotonSendAttachmentContent = {
  type: "attachment";
  attachmentId: string;
  metadata?: { caption?: { format: string; text: string } };
};

export type PhotonSendVoiceContent = {
  type: "voice";
  attachmentId: string;
};

export type PhotonSendMessageReadContent = {
  type: "message.read";
};

export type PhotonNativeSendContent =
  | PhotonSendTextContent
  | PhotonSendReactionContent
  | PhotonSendTypingContent
  | PhotonSendAttachmentContent
  | PhotonSendVoiceContent
  | PhotonSendMessageReadContent;

export type PhotonSendMessageBody = {
  spaceId: string;
  senderId: string;
  content: PhotonNativeSendContent;
  parentMessageId?: string;
};

/** Default tapback used by PhotonBetaProvider.acknowledge today. */
export const DEFAULT_ACK_REACTION = "👍";

export function buildReactionContent(
  reaction: string = DEFAULT_ACK_REACTION,
  action: PhotonReactionAction = "add",
): PhotonSendReactionContent {
  const emoji = reaction.trim() || DEFAULT_ACK_REACTION;
  return { type: "reaction", action, reaction: emoji };
}

export function buildTypingContent(typing: boolean): PhotonSendTypingContent {
  return { type: "space.typing.update", typing };
}

export function buildAttachmentContent(
  attachmentId: string,
  caption?: { format?: string; text: string },
): PhotonSendAttachmentContent {
  const id = attachmentId.trim();
  if (!id) throw new Error("attachmentId is required");
  const content: PhotonSendAttachmentContent = { type: "attachment", attachmentId: id };
  if (caption?.text.trim()) {
    content.metadata = {
      caption: { format: caption.format?.trim() || "plain", text: caption.text.trim() },
    };
  }
  return content;
}

export function buildVoiceContent(attachmentId: string): PhotonSendVoiceContent {
  const id = attachmentId.trim();
  if (!id) throw new Error("attachmentId is required");
  return { type: "voice", attachmentId: id };
}

export function buildMessageReadContent(): PhotonSendMessageReadContent {
  return { type: "message.read" };
}

export function buildAckSendBody(input: {
  spaceId: string;
  senderId: string;
  parentMessageId: string;
  reaction?: string;
}): PhotonSendMessageBody {
  return {
    spaceId: input.spaceId,
    senderId: input.senderId,
    parentMessageId: input.parentMessageId,
    content: buildReactionContent(input.reaction),
  };
}

export function buildTypingSendBody(input: {
  spaceId: string;
  senderId: string;
  typing: boolean;
}): PhotonSendMessageBody {
  return {
    spaceId: input.spaceId,
    senderId: input.senderId,
    content: buildTypingContent(input.typing),
  };
}

export function buildAttachmentSendBody(input: {
  spaceId: string;
  senderId: string;
  attachmentId: string;
  caption?: { format?: string; text: string };
}): PhotonSendMessageBody {
  return {
    spaceId: input.spaceId,
    senderId: input.senderId,
    content: buildAttachmentContent(input.attachmentId, input.caption),
  };
}

export function buildVoiceSendBody(input: {
  spaceId: string;
  senderId: string;
  attachmentId: string;
}): PhotonSendMessageBody {
  return {
    spaceId: input.spaceId,
    senderId: input.senderId,
    content: buildVoiceContent(input.attachmentId),
  };
}

export function buildReadSendBody(input: {
  spaceId: string;
  senderId: string;
  parentMessageId: string;
}): PhotonSendMessageBody {
  return {
    spaceId: input.spaceId,
    senderId: input.senderId,
    parentMessageId: input.parentMessageId,
    content: buildMessageReadContent(),
  };
}

/** Stable idempotency keys matching PhotonBetaProvider + pipeline conventions. */
export function ackIdempotencyKey(providerMessageId: string): string {
  return "ack:" + providerMessageId;
}

export function typingIdempotencyKey(messageId: string, enabled: boolean): string {
  return "typing:" + messageId + ":" + enabled;
}

export function attachmentIdempotencyKey(spaceId: string, attachmentId: string): string {
  return "attach:" + spaceId + ":" + attachmentId;
}

export function voiceIdempotencyKey(spaceId: string, attachmentId: string): string {
  return "voice:" + spaceId + ":" + attachmentId;
}

export function readIdempotencyKey(providerMessageId: string): string {
  return "read:" + providerMessageId;
}

/**
 * Capabilities in pinned @photon-ai/api 0.5.0 vs Spectrum Cloud path.
 * Prefer Spectrum (PHOTON_PROJECT_SECRET) for Vincent contest surfaces.
 */
export const PHOTON_1_0_NATIVE_MATRIX = {
  supportedInPinnedSdk: [
    "text",
    "text.update",
    "attachment (after projects.uploadAttachment)",
    "voice (after projects.uploadAttachment)",
    "reaction (tapbacks)",
    "space.typing.update",
    "message.read",
    "message.delete",
    "poll / poll.vote / poll.update",
    "space.participants.update",
    "group (multipart)",
  ],
  useSpectrumCloudInstead: [
    "app() / customizedMiniApp() web-app cards (send via photon:send-native)",
    "nativeContactCard / contact()",
    "voice() from file path (no uploadAttachment)",
    "live location proxy via app(mapsUrl, { live }) — true live-location share is inbound-only",
  ],
  notInPinnedSdk: [
    "nativeContactCard (use Spectrum path)",
    "customizedMiniApp (use Spectrum path)",
    "Apple live-location share bubble outbound (no SDK builder; see SPECTRUM_NATIVE_MATRIX)",
  ],
} as const;

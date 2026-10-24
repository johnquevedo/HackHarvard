import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACK_REACTION,
  PHOTON_1_0_NATIVE_MATRIX,
  ackIdempotencyKey,
  attachmentIdempotencyKey,
  buildAckSendBody,
  buildAttachmentContent,
  buildAttachmentSendBody,
  buildMessageReadContent,
  buildReactionContent,
  buildReadSendBody,
  buildTypingContent,
  buildTypingSendBody,
  buildVoiceContent,
  buildVoiceSendBody,
  readIdempotencyKey,
  typingIdempotencyKey,
  voiceIdempotencyKey,
} from "./content";
import {
  anyNativeOutboundEnabled,
  parseAckMode,
  parsePhotonNativeBreadthFlags,
} from "./flags";

describe("photon 1.0 SendContent builders", () => {
  it("builds reaction tapback matching Beta provider shape", () => {
    expect(buildReactionContent()).toEqual({
      type: "reaction",
      action: "add",
      reaction: DEFAULT_ACK_REACTION,
    });
    expect(buildReactionContent("❤️", "remove")).toEqual({
      type: "reaction",
      action: "remove",
      reaction: "❤️",
    });
  });

  it("builds typing updates", () => {
    expect(buildTypingContent(true)).toEqual({ type: "space.typing.update", typing: true });
    expect(buildTypingContent(false)).toEqual({ type: "space.typing.update", typing: false });
  });

  it("builds attachment and voice content from attachment ids", () => {
    expect(buildAttachmentContent("att_1")).toEqual({
      type: "attachment",
      attachmentId: "att_1",
    });
    expect(buildAttachmentContent("att_2", { text: "receipt" })).toEqual({
      type: "attachment",
      attachmentId: "att_2",
      metadata: { caption: { format: "plain", text: "receipt" } },
    });
    expect(buildVoiceContent("att_voice")).toEqual({
      type: "voice",
      attachmentId: "att_voice",
    });
    expect(() => buildAttachmentContent("  ")).toThrow(/attachmentId/);
    expect(() => buildVoiceContent("")).toThrow(/attachmentId/);
  });

  it("builds message.read content", () => {
    expect(buildMessageReadContent()).toEqual({ type: "message.read" });
  });

  it("builds full sendMessage bodies with stable idempotency helpers", () => {
    expect(
      buildAckSendBody({
        spaceId: "spc_1",
        senderId: "usr_agent",
        parentMessageId: "msg_in",
        reaction: "😂",
      }),
    ).toEqual({
      spaceId: "spc_1",
      senderId: "usr_agent",
      parentMessageId: "msg_in",
      content: { type: "reaction", action: "add", reaction: "😂" },
    });
    expect(
      buildTypingSendBody({ spaceId: "spc_1", senderId: "usr_agent", typing: true }),
    ).toMatchObject({ content: { type: "space.typing.update", typing: true } });
    expect(
      buildAttachmentSendBody({
        spaceId: "spc_1",
        senderId: "usr_agent",
        attachmentId: "att_9",
      }),
    ).toMatchObject({ content: { type: "attachment", attachmentId: "att_9" } });
    expect(
      buildVoiceSendBody({
        spaceId: "spc_1",
        senderId: "usr_agent",
        attachmentId: "att_v",
      }),
    ).toMatchObject({ content: { type: "voice", attachmentId: "att_v" } });
    expect(
      buildReadSendBody({
        spaceId: "spc_1",
        senderId: "usr_agent",
        parentMessageId: "msg_in",
      }),
    ).toEqual({
      spaceId: "spc_1",
      senderId: "usr_agent",
      parentMessageId: "msg_in",
      content: { type: "message.read" },
    });

    expect(ackIdempotencyKey("msg_in")).toBe("ack:msg_in");
    expect(typingIdempotencyKey("msg_in", true)).toBe("typing:msg_in:true");
    expect(attachmentIdempotencyKey("spc_1", "att_9")).toBe("attach:spc_1:att_9");
    expect(voiceIdempotencyKey("spc_1", "att_v")).toBe("voice:spc_1:att_v");
    expect(readIdempotencyKey("msg_in")).toBe("read:msg_in");
  });

  it("documents 1.0 vs Spectrum paths for Vincent", () => {
    expect(PHOTON_1_0_NATIVE_MATRIX.supportedInPinnedSdk).toContain("reaction (tapbacks)");
    expect(
      PHOTON_1_0_NATIVE_MATRIX.useSpectrumCloudInstead.some((s) => s.includes("app()")),
    ).toBe(true);
    expect(PHOTON_1_0_NATIVE_MATRIX.notInPinnedSdk.some((s) => s.includes("nativeContactCard"))).toBe(
      true,
    );
  });
});

describe("photon native breadth flags", () => {
  it("defaults keep demos unchanged", () => {
    const flags = parsePhotonNativeBreadthFlags({});
    expect(flags).toEqual({
      ackMode: "none",
      ackReaction: "👍",
      attachmentEnabled: false,
      voiceEnabled: false,
      readReceiptEnabled: false,
      spectrumWebAppEnabled: false,
      spectrumContactCardEnabled: false,
      spectrumLiveLocationProxyEnabled: false,
    });
    expect(anyNativeOutboundEnabled(flags)).toBe(false);
    expect(parseAckMode(undefined)).toBe("none");
    expect(parseAckMode("reaction")).toBe("reaction");
  });

  it("parses opt-in env flags", () => {
    const flags = parsePhotonNativeBreadthFlags({
      DENNIS_ACK_MODE: "reaction",
      DENNIS_PHOTON_ACK_REACTION: "❤️",
      DENNIS_PHOTON_NATIVE_ATTACHMENT: "1",
      DENNIS_PHOTON_NATIVE_VOICE: "true",
      DENNIS_PHOTON_NATIVE_READ: "on",
    });
    expect(flags.ackMode).toBe("reaction");
    expect(flags.ackReaction).toBe("❤️");
    expect(flags.attachmentEnabled).toBe(true);
    expect(flags.voiceEnabled).toBe(true);
    expect(flags.readReceiptEnabled).toBe(true);
    expect(anyNativeOutboundEnabled(flags)).toBe(true);
  });
});

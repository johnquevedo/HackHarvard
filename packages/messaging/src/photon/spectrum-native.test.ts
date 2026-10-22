import { describe, expect, it } from "vitest";
import { AppConfigSchema, type InboundMessageT } from "@dennis/contracts";
import { createDb } from "@dennis/db";
import { PhotonSpectrumProvider } from "./provider-spectrum.ts";

// Native iMessage through Photon Spectrum, against a fake Spectrum connection: what each native
// call puts on the wire, and how inbound poll votes are normalized.

const config = AppConfigSchema.parse({
  dennisAdminToken: "test-admin-token-long",
  photonMode: "live",
  photonProjectId: "11111111-2222-3333-4444-555555555555",
  photonProjectSecret: "test-secret",
});
const deps = {
  db: createDb(),
  clock: { now: () => new Date(), nowIso: () => new Date().toISOString() },
  log: { debug() {}, info() {}, warn() {}, error() {} },
};

type Built = { type: string; [k: string]: unknown };

function fakeSpectrum(inbound: [unknown, unknown][] = []) {
  const sent: Built[] = [];
  const reactions: { messageId: string; emoji: string }[] = [];
  const space = {
    id: "chat-group-1",
    __platform: "imessage",
    type: "group",
    phone: "+15550001111",
    async send(builder: { build(): Promise<Built> }) {
      const content = await builder.build();
      sent.push(content);
      return content.type === "contactCard" || content.type === "rename"
        ? undefined
        : { id: content.type === "poll" ? "poll-guid-1" : `msg-${sent.length}` };
    },
    async getMessage(id: string) {
      return { id, react: async (emoji: string) => void reactions.push({ messageId: id, emoji }) };
    },
    async getMembers() {
      return [{ id: "alice@example.test" }, { id: "bob@example.test" }];
    },
  };
  const connection = {
    app: {
      messages: (async function* () {
        for (const item of inbound) yield item;
      })(),
      stop: async () => {},
    },
    platform: { space: { get: async () => space, create: async () => space } },
  };
  return { connection: connection as never, sent, reactions, space };
}

const SPACE_ID = "spectrum|+15550001111|chat-group-1";

describe("PhotonSpectrumProvider native iMessage", () => {
  it("sends text with an Apple send effect", async () => {
    const fake = fakeSpectrum();
    const provider = new PhotonSpectrumProvider(config, deps, async () => fake.connection);
    await provider.send({
      accountKey: "primary",
      toHandle: "alice@example.test",
      toPhotonUserId: null,
      spaceId: SPACE_ID,
      text: "Market created",
      idempotencyKey: "k1",
      effect: "slam",
    });
    expect(fake.sent).toEqual([
      {
        type: "effect",
        content: { type: "text", text: "Market created" },
        effect: "com.apple.MobileSMS.expressivesend.impact",
      },
    ]);
  });

  it("maps every native call to Spectrum content", async () => {
    const fake = fakeSpectrum();
    const provider = new PhotonSpectrumProvider(config, deps, async () => fake.connection);
    const native = provider.native;
    expect(await native.sendPoll(SPACE_ID, "Will john pass?", ["📈 long", "📉 short"])).toEqual({
      providerMessageId: "poll-guid-1",
    });
    await native.renameGroup(SPACE_ID, "📉 $JOHN short squeeze");
    const voice = await native.sendVoice(SPACE_ID, new Uint8Array([1, 2, 3]), "audio/mp4", 7);
    await native.shareContactCard(SPACE_ID);
    await native.react({ spaceId: SPACE_ID, providerMessageId: "msg-from-john" }, "💀");
    expect(voice.providerMessageId).toMatch(/^msg-/);
    expect(fake.sent.map((c) => c.type)).toEqual(["poll", "rename", "voice", "contactCard"]);
    expect(fake.sent[0]).toEqual({
      type: "poll",
      title: "Will john pass?",
      options: [{ title: "📈 long" }, { title: "📉 short" }],
    });
    expect(fake.sent[1]).toEqual({ type: "rename", displayName: "📉 $JOHN short squeeze" });
    expect(fake.sent[2]).toMatchObject({
      type: "voice",
      mimeType: "audio/mp4",
      duration: 7,
      name: "dennis.m4a",
    });
    expect(fake.reactions).toEqual([{ messageId: "msg-from-john", emoji: "💀" }]);
  });

  it("normalizes an inbound poll vote and keeps text messages working", async () => {
    const at = new Date("2026-10-21T18:00:00.000Z");
    const spaceObj = fakeSpectrum().space;
    const vote = {
      id: "poll-guid-1:bob@example.test:opt-2:voted:1761069600000",
      direction: "inbound",
      platform: "imessage",
      sender: { id: "bob@example.test" },
      timestamp: at,
      content: {
        type: "poll_option",
        option: { title: "📉 short john · $100" },
        poll: { type: "poll", title: "Will john pass?", options: [] },
        selected: true,
      },
    };
    const textMsg = {
      id: "msg-text-1",
      direction: "inbound",
      platform: "imessage",
      sender: { id: "alice@example.test" },
      timestamp: at,
      content: { type: "text", text: "LMAO run it" },
    };
    const reaction = { ...textMsg, id: "msg-reaction", content: { type: "reaction", emoji: "😂" } };
    const fake = fakeSpectrum([
      [spaceObj, vote],
      [spaceObj, reaction],
      [spaceObj, textMsg],
    ]);
    const provider = new PhotonSpectrumProvider(config, deps, async () => fake.connection);
    const received: InboundMessageT[] = [];
    await provider.start(async (m) => void received.push(m));
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({
      providerSpaceId: SPACE_ID,
      providerSpaceKind: "group",
      senderHandle: "bob@example.test",
      text: "",
      pollVote: { pollMessageId: "poll-guid-1", option: "📉 short john · $100", selected: true },
    });
    expect(received[1]).toMatchObject({ text: "LMAO run it" });
    expect(received[1]!.pollVote).toBeUndefined();
    await provider.stop();
  });
});

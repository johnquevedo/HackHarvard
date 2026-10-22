import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { InboundMessageT } from "../../packages/contracts/src/index";
import { createTestPlatform } from "../../packages/platform/src/testing";
import {
  dispatchNative,
  dispatchOutbox,
  drainPlatform,
  ingestInbound,
  mountPlatformRoutes,
  nativeActions,
  setSpeechSynth,
  type PlatformContext,
} from "../../packages/platform/src/index";
import type { SimMessagingProvider } from "../../packages/messaging/src/index";
import { MockStructuredLlm } from "../../packages/llm/src/index";
import {
  DEMO_GROUP_CHAT,
  checkLedgerInvariants,
  getBalance,
  shortmeModule,
} from "../../packages/shortme/src/index";
import { purchasingModule } from "../../packages/purchasing/src/index";

// The demo story in an iMessage group chat (simulated provider, real platform): Dennis tapbacks the
// trigger, opens the market as a native poll, renames the group to a ticker, counts poll votes as
// stakes, settles with one line and a send effect, renames again, and drops a voice note.

const GROUP = "spc_group_demo";
const CAST = { john: "usr_demo_john", steven: "usr_demo_steven", isaac: "usr_demo_isaac" } as const;
type Who = keyof typeof CAST;

const line = (i: number) => DEMO_GROUP_CHAT[i]!.text;

async function setup() {
  const ctx = await createTestPlatform({
    llm: new MockStructuredLlm(),
    config: { conversationMode: "demo", demoScenario: "group", photonSpaceMode: "group" },
  });
  setSpeechSynth(ctx, async (text) => ({
    audio: new TextEncoder().encode(text),
    mimeType: "audio/mp4",
    durationSeconds: 7,
  }));
  await shortmeModule.register(ctx);
  await shortmeModule.seed(ctx);
  return ctx;
}

const handle = (ctx: PlatformContext, who: Who) =>
  ({
    john: ctx.config.demoJohnHandle,
    steven: ctx.config.demoStevenHandle,
    isaac: ctx.config.demoIsaacHandle,
  })[who];

let n = 0;
function inbound(ctx: PlatformContext, who: Who, extra: Partial<InboundMessageT>): InboundMessageT {
  const members = (["john", "steven", "isaac"] as const).map((w) => handle(ctx, w));
  return {
    provider: "sim",
    accountKey: "primary",
    providerMessageId: `group_${++n}`,
    providerSpaceId: GROUP,
    providerSpaceKind: "group",
    providerParticipantIds: members,
    providerParticipantHandles: members,
    providerSenderId: null,
    senderHandle: handle(ctx, who),
    text: "",
    receivedAt: ctx.clock.nowIso(),
    mode: "simulated",
    ...extra,
  };
}

async function settle(ctx: PlatformContext) {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setImmediate(r));
    await drainPlatform(ctx);
  }
  await dispatchOutbox(ctx);
  await dispatchNative(ctx);
}

async function say(ctx: PlatformContext, who: Who, text: string) {
  const r = await ingestInbound(ctx, inbound(ctx, who, { text }));
  await settle(ctx);
  return r;
}

async function vote(
  ctx: PlatformContext,
  who: Who,
  pollMessageId: string,
  option: string,
  selected = true,
) {
  const r = await ingestInbound(
    ctx,
    inbound(ctx, who, { pollVote: { pollMessageId, option, selected } }),
  );
  await settle(ctx);
  return r;
}

const sim = (ctx: PlatformContext) => ctx.messaging as SimMessagingProvider;
const groupTexts = (ctx: PlatformContext) =>
  sim(ctx)
    .sent.filter((s) => s.spaceId === GROUP)
    .map((s) => s.text);

describe("Dennis in an iMessage group chat, natively", () => {
  it("tapbacks, ticker rename, native poll, poll stakes, one result line with an effect, voice note", async () => {
    const ctx = await setup();

    await say(ctx, "john", line(0));
    expect(groupTexts(ctx).at(-1)).toBe(line(1));
    // First time in the group: Dennis shares its contact card, then 💀 on john's message.
    expect(sim(ctx).nativeLog).toEqual([
      { kind: "contact_card", spaceId: GROUP },
      expect.objectContaining({ kind: "react", emoji: "💀", spaceId: GROUP }),
    ]);

    await say(ctx, "john", line(2));
    const market = ctx.db.$client.prepare("SELECT id, status FROM markets").get() as {
      id: string;
      status: string;
    };
    expect(market.status).toBe("open");
    // The "Market created" line went to the group once, with a slam.
    const created = sim(ctx).sent.filter((s) => s.text === line(3));
    expect(created).toEqual([expect.objectContaining({ spaceId: GROUP, effect: "slam" })]);
    // Native moments after it: the group becomes a ticker, the market is a native poll, and john's
    // own stake message gets 😂 (he shorted himself).
    const afterOpen = sim(ctx).nativeLog.slice(2);
    expect(afterOpen).toEqual([
      { kind: "rename", spaceId: GROUP, name: "📉 $JOHN short squeeze" },
      expect.objectContaining({
        kind: "poll",
        spaceId: GROUP,
        title: "Will john pass his Meta final round?",
        options: ["📈 long john · $100", "📉 short john · $100"],
      }),
      expect.objectContaining({ kind: "react", emoji: "😂" }),
    ]);
    // No per-friend invite texts in the group: the poll is the invite.
    expect(groupTexts(ctx).some((t) => t.includes("'s got a market"))).toBe(false);

    const poll = sim(ctx).nativeLog.find((r) => r.kind === "poll")!;
    await say(ctx, "steven", "nah you got that. I’ll put $200");
    expect(sim(ctx).nativeLog.at(-1)).toEqual(
      expect.objectContaining({ kind: "react", emoji: "‼️" }),
    );
    await vote(ctx, "isaac", poll.providerMessageId!, "📉 short john · $100");
    expect(groupTexts(ctx).at(-1)).toBe("isaac put $100 against john. cold.");
    await vote(ctx, "isaac", poll.providerMessageId!, "📈 long john · $100");
    expect(groupTexts(ctx).at(-1)).toBe("you're already in on this one.");
    await vote(ctx, "steven", poll.providerMessageId!, "📈 long john · $100", false);
    expect(groupTexts(ctx).at(-1)).toBe("positions are final lol. no take backs.");

    const positions = ctx.db.$client
      .prepare(
        "SELECT user_id AS who, side, points FROM market_positions ORDER BY created_at, rowid",
      )
      .all();
    expect(positions).toEqual([
      { who: CAST.john, side: "fade", points: 50 },
      { who: CAST.steven, side: "back", points: 20 },
      { who: CAST.isaac, side: "fade", points: 10 },
    ]);

    const res = await shortmeModule.routes(ctx).request(`/markets/${market.id}/demo-resolve`, {
      method: "POST",
      headers: {
        "x-dennis-admin": ctx.config.dennisAdminToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome: "no" }),
    });
    expect(res.status).toBe(200);
    await settle(ctx);
    const sentBefore = sim(ctx).sent.length;
    await say(ctx, "john", "CONFIRM");

    // Pool 80 points ($800) to the shorts: john 67 of it, isaac 13; steven loses his $200.
    expect([
      getBalance(ctx, CAST.john),
      getBalance(ctx, CAST.steven),
      getBalance(ctx, CAST.isaac),
    ]).toEqual([1000 + 17, 1000 - 20, 1000 + 3]);
    expect((await checkLedgerInvariants(ctx)).every((c) => c.ok)).toBe(true);

    const results = sim(ctx)
      .sent.slice(sentBefore)
      .filter((s) => s.text.startsWith("john took the L."));
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(expect.objectContaining({ spaceId: GROUP, effect: "loud" }));
    expect(results[0]!.text).toContain(
      "john +$170, isaac +$30, steven -$200. (sim $, no real money moved)",
    );

    const settled = sim(ctx).nativeLog.slice(-2);
    expect(settled[0]).toEqual({ kind: "rename", spaceId: GROUP, name: "💀 $JOHN delisted" });
    expect(settled[1]).toEqual(
      expect.objectContaining({ kind: "voice", spaceId: GROUP, durationSeconds: 7 }),
    );
    const voice = nativeActions(ctx, { userId: CAST.john }).find((a) => a.kind === "voice")!;
    expect(voice.payload).toEqual({
      kind: "voice",
      text: "closing bell. john took the L. insurance paid out. john up 170 dollars. isaac up 30 dollars. steven down 200 dollars. sim money only. this has been dennis.",
    });

    // The dashboard's simulator thread shows the native moments too.
    const app = new Hono();
    mountPlatformRoutes(app, ctx);
    const thread = (await (
      await app.request(`/api/sim/thread?userId=${CAST.steven}`, {
        headers: { "x-dennis-admin": ctx.config.dennisAdminToken },
      })
    ).json()) as { messages: { text: string }[] };
    const texts = thread.messages.map((m) => m.text);
    expect(texts).toContain('[dennis named the conversation "📉 $JOHN short squeeze"]');
    expect(texts).toContain(
      "[poll] Will john pass his Meta final round? | 📈 long john · $100 | 📉 short john · $100",
    );
    expect(texts.some((t) => t.startsWith("[voice note] closing bell."))).toBe(true);
  });

  it("ignores poll votes on polls Dennis did not send, and from people who did not consent", async () => {
    const ctx = await setup();
    await vote(ctx, "steven", "not_a_dennis_poll", "anything");
    const events = ctx.events
      .history({ judge: true, limit: 1000 })
      .filter((e) => e.type === "poll.vote");
    expect(events.map((e) => e.payload.note)).toEqual(["not_a_dennis_poll"]);

    await say(ctx, "john", line(0));
    await say(ctx, "john", line(2));
    const poll = sim(ctx).nativeLog.find((r) => r.kind === "poll")!;
    await ctx.consent.set({
      userId: CAST.isaac,
      scope: "messaging_context",
      granted: false,
      via: "dashboard",
    });
    const r = await vote(ctx, "isaac", poll.providerMessageId!, "📉 short john · $100");
    expect(r.outcome).toBe("ignored");
    expect(
      ctx.db.$client
        .prepare("SELECT count(*) AS n FROM market_positions WHERE user_id=?")
        .get(CAST.isaac),
    ).toEqual({ n: 0 });
  });

  it("purchase leg: 👀 on isaac's monitor line, the deal in Dennis's voice, confetti when both approve", async () => {
    const ctx = await setup();
    await purchasingModule.register(ctx);
    await purchasingModule.seed(ctx);
    const r = await say(ctx, "isaac", line(7));
    for (let i = 0; i < 3; i++) await settle(ctx);
    expect(sim(ctx).nativeLog).toContainEqual(
      expect.objectContaining({ kind: "react", emoji: "👀", spaceId: GROUP }),
    );
    expect(r.outcome).toBe("queued");
    const join = groupTexts(ctx).find((t) => t.startsWith("wait. found a match."))!;
    expect(join).toMatch(
      /^wait\. found a match\. another friend's agent has been tracking the same 27-inch 4k monitor\. found a group deal that saves you both \$45\.00 each \(\$284\.99 instead of \$329\.99, simulated offer\)\. want me to coordinate\? \([a-z0-9]{4}\)$/,
    );
    // isaac approves in the group with plain words; the outside friend approves in their own thread.
    await say(ctx, "isaac", line(11));
    const [friendJoin] = await ctx.approvals.findPending("usr_demo_friend", null);
    await ctx.approvals.decide({
      approvalId: friendJoin!.id,
      userId: "usr_demo_friend",
      decision: "approve",
      via: "sim_phone",
    });
    for (let i = 0; i < 3; i++) await settle(ctx);
    const confirmed = sim(ctx).sent.find(
      (s) => s.spaceId === GROUP && s.text.startsWith("both approved. group purchase organized."),
    );
    expect(confirmed).toEqual(expect.objectContaining({ spaceId: GROUP, effect: "confetti" }));
    expect(
      groupTexts(ctx).some((t) =>
        t.startsWith("simulated Nessie payment ready for confirmation: $284.99"),
      ),
    ).toBe(true);
  });
});

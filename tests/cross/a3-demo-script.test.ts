import { describe, expect, it } from "vitest";
import type { CommandHandler, InboundMessageT } from "../../packages/contracts/src/index";
import { createTestPlatform } from "../../packages/platform/src/testing";
import {
  drainPlatform,
  ingestInbound,
  type PlatformContext,
} from "../../packages/platform/src/index";
import { commandHandlers } from "../../packages/platform/src/foundation";
import { MockStructuredLlm } from "../../packages/llm/src/index";
import {
  DEMO_EXPECTED_COMMANDS,
  DEMO_GROUP_CHAT,
  checkLedgerInvariants,
  getBalance,
  shortmeModule,
} from "../../packages/shortme/src/index";

// Replays the ShortMe half of the demo group chat (packages/shortme/src/demo-script.ts) through the
// real platform: ingest, pipeline, scripted mock LLM, approvals, A2A, ledger. Group chats and the
// "put" grammar are Agent 1's (CR-A3-007); until they land each person talks to Dennis 1:1 and the
// test hands the put handler exactly the command the parser is asked to produce.

const PEOPLE = {
  john: { id: "usr_demo_john", agent: "agt_demo_john", handle: "+16175550101", first: "John" },
  steven: {
    id: "usr_demo_steven",
    agent: "agt_demo_steven",
    handle: "+16175550102",
    first: "Steven",
  },
} as const;
type Who = keyof typeof PEOPLE;

const line = (i: number) => DEMO_GROUP_CHAT[i]!.text;

async function settle(ctx: PlatformContext) {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setImmediate(r));
    await drainPlatform(ctx);
  }
}

async function setup() {
  const ctx = await createTestPlatform({ llm: new MockStructuredLlm() });
  const now = ctx.clock.nowIso();
  for (const p of Object.values(PEOPLE)) {
    ctx.db.$client
      .prepare(
        "INSERT INTO users (id, display_name, first_name, handle, handle_kind, photon_user_id, is_demo, region_code, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(p.id, p.first, p.first, p.handle, "phone", null, 1, "boston-cambridge", now);
    ctx.db.$client
      .prepare(
        "INSERT INTO agents (id, user_id, name, status, settings, created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        p.agent,
        p.id,
        `Dennis for ${p.first}`,
        "active",
        JSON.stringify({ matchingEnabled: true, shortmeEnabled: true, ackMode: "none" }),
        now,
      );
    for (const scope of [
      "messaging_context",
      "purchase_matching",
      "shortme_free_play",
      "sandbox_payments",
    ] as const)
      await ctx.consent.set({ userId: p.id, scope, granted: true, via: "seed_demo" });
  }
  const link = ctx.db.$client.prepare(
    "INSERT OR IGNORE INTO friend_links (user_id, friend_user_id, can_invite) VALUES (?, ?, 1)",
  );
  link.run(PEOPLE.john.id, PEOPLE.steven.id);
  link.run(PEOPLE.steven.id, PEOPLE.john.id);
  await shortmeModule.register(ctx);
  await shortmeModule.seed(ctx);
  return ctx;
}

let n = 0;
async function say(ctx: PlatformContext, who: Who, text: string) {
  const msg: InboundMessageT = {
    provider: "sim",
    accountKey: "primary",
    providerMessageId: `demo_${++n}`,
    providerSpaceId: null,
    providerSenderId: null,
    senderHandle: PEOPLE[who].handle,
    text,
    receivedAt: ctx.clock.nowIso(),
    mode: "simulated",
  };
  await ingestInbound(ctx, msg);
  await settle(ctx);
}

async function put(ctx: PlatformContext, who: Who, text: string) {
  const handler = commandHandlers.get(ctx)?.get("put") as CommandHandler | undefined;
  expect(handler, "shortme registers a put handler").toBeTruthy();
  const r = await handler!({
    userId: PEOPLE[who].id,
    agentId: PEOPLE[who].agent,
    command: DEMO_EXPECTED_COMMANDS[text] as never,
    messageId: `msg_put_${++n}`,
  });
  await settle(ctx);
  return r.reply;
}

function lastDennisTo(ctx: PlatformContext, who: Who): string {
  const rows = ctx.db.$client
    .prepare("SELECT text FROM outbox WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .all(PEOPLE[who].id) as { text: string }[];
  return rows[0]?.text ?? "";
}

const withoutCode = (t: string) => t.replace(/ \([a-z0-9]{4}\)$/, "");

function market(ctx: PlatformContext, subject: Who) {
  return ctx.db.$client
    .prepare(
      "SELECT id, status, question, category FROM markets WHERE subject_user_id=? ORDER BY created_at DESC LIMIT 1",
    )
    .get(PEOPLE[subject].id) as
    { id: string; status: string; question: string; category: string } | undefined;
}

describe("demo group chat, ShortMe part", () => {
  it("plays john's and steven's lines exactly, with real markets and money underneath", async () => {
    const ctx = await setup();

    await say(ctx, "john", line(0));
    expect(withoutCode(lastDennisTo(ctx, "john"))).toBe(line(1));
    expect(lastDennisTo(ctx, "john")).toMatch(/ \([a-z0-9]{4}\)$/);
    expect(market(ctx, "john")).toMatchObject({
      status: "proposed",
      question: "Will john pass his Meta final round?",
    });

    expect(await put(ctx, "john", line(2))).toBe(line(3));
    expect(market(ctx, "john")?.status).toBe("open");
    expect(getBalance(ctx, PEOPLE.john.id)).toBe(1000 - 50);

    const stevenFirst = line(4);
    expect(await put(ctx, "steven", stevenFirst)).toBe("steven's in for $200 backing john.");
    await say(ctx, "steven", stevenFirst);
    expect(withoutCode(lastDennisTo(ctx, "steven"))).toBe(line(5));
    expect(market(ctx, "steven")).toMatchObject({
      status: "proposed",
      category: "dating",
      question: "Will she ghost steven?",
    });

    expect(await put(ctx, "steven", line(6))).toBeUndefined();
    expect(market(ctx, "steven")?.status).toBe("open");
    expect(getBalance(ctx, PEOPLE.steven.id)).toBe(1000 - 20 - 2);

    const positions = ctx.db.$client
      .prepare(
        "SELECT u.first_name AS who, p.side, p.points, m.category FROM market_positions p JOIN users u ON u.id = p.user_id JOIN markets m ON m.id = p.market_id ORDER BY p.created_at, p.rowid",
      )
      .all();
    expect(positions).toEqual([
      { who: "John", side: "fade", points: 50, category: "recruiting" },
      { who: "Steven", side: "back", points: 20, category: "recruiting" },
      { who: "Steven", side: "fade", points: 2, category: "dating" },
    ]);
    expect((await checkLedgerInvariants(ctx)).every((c) => c.ok)).toBe(true);

    // Isaac's monitor line is a purchase, never a market.
    await say(ctx, "john", line(7));
    expect(ctx.db.$client.prepare("SELECT count(*) AS n FROM markets").get()).toEqual({ n: 2 });
  });

  it("settles john's market in dollars and in voice", async () => {
    const ctx = await setup();
    await say(ctx, "john", line(0));
    await put(ctx, "john", line(2));
    await put(ctx, "steven", line(4));
    const m = market(ctx, "john")!;
    const res = await shortmeModule.routes(ctx).request(`/markets/${m.id}/demo-resolve`, {
      method: "POST",
      headers: {
        "x-dennis-admin": ctx.config.dennisAdminToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome: "no" }),
    });
    expect(res.status).toBe(200);
    expect(lastDennisTo(ctx, "john")).toMatch(
      /^results are in for "Will john pass his Meta final round\?": NO\. CONFIRM ([a-z0-9]{4}) to settle or DISPUTE \1 if that's cap\.$/,
    );
    const [confirm] = await ctx.approvals.findPending(PEOPLE.john.id, null);
    await ctx.approvals.decide({
      approvalId: confirm!.id,
      userId: PEOPLE.john.id,
      decision: "approve",
      via: "sim_phone",
    });
    await settle(ctx);
    // john shorted himself for $500, steven backed him for $200, john did not pass: insurance pays out.
    expect(lastDennisTo(ctx, "steven")).toBe(
      "john took the L. hedge fund behavior, respect the risk management. john +$200, steven -$200. (sim $, no real money moved)",
    );
    expect((await checkLedgerInvariants(ctx)).every((c) => c.ok)).toBe(true);
  });
});

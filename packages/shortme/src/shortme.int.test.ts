import { describe, expect, it } from "vitest";
import { createTestPlatform } from "@dennis/platform/testing";
import { drainPlatform, type PlatformContext } from "@dennis/platform";
import { MockStructuredLlm } from "@dennis/llm";
import { milestoneDetector } from "./detector/index";
import { checkLedgerInvariants, getBalance } from "./ledger/ledger";
import { backFadeHandler, passHandler, placePosition } from "./markets/positions";
import { getMarket, handleMilestoneDetection, listMarketsFor } from "./markets/service";
import { canTransition, MARKET_STATUSES, TRANSITIONS } from "./markets/state";
import { shortmeModule } from "./module";
import { proposeResolution, resolveMarket } from "./resolution/service";

// Integration tests for A3-05 to A3-08 against the real createTestPlatform (in-memory SQLite,
// seeded demo users Alice and Bob with all consents and a friend link, Section 7.5).

const ALICE = "usr_demo_alice";
const BOB = "usr_demo_bob";
const ALICE_AGENT = "agt_demo_alice";
const BOB_AGENT = "agt_demo_bob";
const INTERVIEW =
  "just finished my final round interview at a quant firm. i either get the offer or im cooked";

type Ctx = PlatformContext;

async function setup(llm = new MockStructuredLlm()): Promise<Ctx> {
  const ctx = await createTestPlatform({ llm });
  await shortmeModule.register(ctx);
  await shortmeModule.seed(ctx);
  return ctx;
}

// A2A delivery is scheduled on a microtask; drain until every per-key queue is idle.
async function settle(ctx: Ctx): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setImmediate(r));
    await drainPlatform(ctx);
  }
}

function events(ctx: Ctx) {
  return ctx.events.history({ judge: true, limit: 100_000 }) as {
    type: string;
    visibility: string;
    payload: Record<string, unknown>;
  }[];
}

function outbox(ctx: Ctx, userId: string) {
  return ctx.db.$client
    .prepare(
      "SELECT user_id AS userId, kind, text FROM outbox WHERE user_id=? ORDER BY created_at, id",
    )
    .all(userId) as { userId: string; kind: string; text: string }[];
}

function addUser(ctx: Ctx, id: string, first: string, agentId: string): void {
  const now = ctx.clock.nowIso();
  ctx.db.$client
    .prepare(
      "INSERT INTO users (id, display_name, first_name, handle, handle_kind, photon_user_id, is_demo, region_code, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(id, first, first, "+16175550199", "phone", null, 1, "boston-cambridge", now);
  ctx.db.$client
    .prepare(
      "INSERT INTO agents (id, user_id, name, status, settings, created_at) VALUES (?,?,?,?,?,?)",
    )
    .run(
      agentId,
      id,
      `Dennis for ${first}`,
      "active",
      JSON.stringify({
        matchingEnabled: true,
        shortmeEnabled: true,
        ackMode: "none",
      }),
      now,
    );
}

async function detectAndPropose(ctx: Ctx, text = INTERVIEW) {
  const agent = (await ctx.users.getAgent(ALICE_AGENT))!;
  const out = await milestoneDetector.detect(
    {
      agentId: ALICE_AGENT,
      userId: ALICE,
      messageId: "msg_test_000001",
      text,
      receivedAt: ctx.clock.nowIso(),
      recentContext: [],
      regionCode: "boston-cambridge",
      enabledCategories: [],
    },
    { llm: ctx.llm, clock: ctx.clock, log: ctx.log },
  );
  if (out.detections.length === 0) return { out, market: null };
  const d = out.detections[0]!;
  const intent = await ctx.intents.create({
    agentId: ALICE_AGENT,
    userId: ALICE,
    kind: "milestone",
    sourceMessageId: null,
    privatePayload: d.privatePayload,
    publicPayload: null,
    confidence: d.confidence,
    rationale: d.rationale,
  });
  const market = await handleMilestoneDetection(ctx, { intent, agent });
  return { out, market };
}

async function pendingFor(ctx: Ctx, userId: string, kind: string) {
  return (await ctx.approvals.findPending(userId, null)).filter((a) => a.kind === kind);
}

async function approve(
  ctx: Ctx,
  userId: string,
  kind: string,
  decision: "approve" | "decline" = "approve",
) {
  const [a] = await pendingFor(ctx, userId, kind);
  expect(a, `pending ${kind} for ${userId}`).toBeTruthy();
  await ctx.approvals.decide({
    approvalId: a!.id,
    userId,
    decision,
    via: "sim_phone",
  });
  await settle(ctx);
  return a!;
}

async function cmd(
  ctx: Ctx,
  userId: string,
  agentId: string,
  command: Record<string, unknown>,
  n: number,
) {
  const h =
    command.kind === "pass"
      ? passHandler(ctx)
      : backFadeHandler(ctx, command.kind as "back" | "fade");
  const r = await h({
    userId,
    agentId,
    command: command as never,
    messageId: `msg_cmd_${n.toString().padStart(6, "0")}`,
  });
  await settle(ctx);
  return r.reply ?? "";
}

describe("E6 ShortMe happy path", () => {
  it("interview text to resolved market with Alice net +50 and Bob net -50", async () => {
    const ctx = await setup();
    const { market } = await detectAndPropose(ctx);
    expect(market?.status).toBe("proposed");
    expect(market?.question).toBe("Will Alice get the offer after the final round?");

    // proposed is private to the subject
    expect(listMarketsFor(ctx, { viewerAgentId: BOB_AGENT })).toHaveLength(0);
    expect(listMarketsFor(ctx, { viewerAgentId: ALICE_AGENT })).toHaveLength(1);
    const marketEvents = events(ctx).filter((e) => e.type === "shortme.market.updated");
    expect(marketEvents.every((e) => e.visibility === "private")).toBe(true);
    expect(JSON.stringify(events(ctx).filter((e) => e.visibility === "shared"))).not.toContain(
      "offer after the final round",
    );

    const publish = await approve(ctx, ALICE, "publish_market");
    expect(publish.payload).toEqual({
      question: market!.question,
      invitees: [{ userId: BOB, firstName: "Bob" }],
      pointsOnly: true,
    });
    expect(publish.promptText).toContain("Points only, no money, no prizes");
    expect(getMarket(ctx, market!.id)!.status).toBe("open");

    // invite reaches Bob only, carries only the approved question
    const invites = events(ctx).filter(
      (e) => e.type === "a2a.sent" && (e.payload as { type?: string }).type === "market.invite",
    );
    expect(invites).toHaveLength(1);
    expect(JSON.stringify(invites[0]!.payload)).not.toContain("quant firm");
    const bobInvite = outbox(ctx, BOB).find((o) => o.kind === "invite");
    expect(bobInvite?.text).toMatch(
      /^ShortMe from Alice's agent: "Will Alice get the offer after the final round\?" Fictional points only, you have 1000\. Reply BACK <pts> [a-z2-9]{4} \(Alice gets it\)/,
    );

    expect(await cmd(ctx, BOB, BOB_AGENT, { kind: "back", points: 50, code: null }, 1)).toContain(
      "Recorded: BACK 50",
    );
    expect(
      await cmd(ctx, ALICE, ALICE_AGENT, { kind: "fade", points: 50, code: null }, 2),
    ).toContain("shorted yourself");
    const placed = events(ctx).filter((e) => e.type === "shortme.position.placed");
    expect(placed.map((e) => e.payload.selfShort)).toEqual([false, true]);

    await proposeResolution(ctx, {
      marketId: market!.id,
      outcome: "no",
      proposedBy: "demo_resolver",
      evidenceNote: "STAND-IN FOR OFFICIAL SOURCE",
    });
    expect(getMarket(ctx, market!.id)!.status).toBe("resolution_proposed");
    const confirm = await approve(ctx, ALICE, "confirm_resolution");
    expect(confirm.promptText).toMatch(/is NO\. Reply CONFIRM ([a-z0-9]{4}) or DISPUTE \1\.$/);

    const m = getMarket(ctx, market!.id)!;
    expect(m.status).toBe("resolved");
    expect(m.outcome).toBe("no");
    expect(getBalance(ctx, ALICE)).toBe(1050);
    expect(getBalance(ctx, BOB)).toBe(950);
    const inv = await checkLedgerInvariants(ctx);
    expect(inv.filter((c) => !c.ok)).toEqual([]);
    expect(inv.map((c) => c.id)).toEqual(["L1", "L2", "L3", "L4", "L5", "L6"]);
    {
      const result = outbox(ctx, BOB).find((o) => o.kind === "result")!.text;
      expect(result).toMatch(
        /^ShortMe result: Alice did not get it this time\. .+ Points: Alice \+50, Bob -50\. \(Fictional points, no value\.\)$/,
      );
      expect(outbox(ctx, ALICE).some((o) => o.kind === "result")).toBe(true);
    }
  });
});

describe("E7 dispute and admin void", () => {
  it("DISPUTE freezes payouts and an admin void refunds both", async () => {
    const ctx = await setup();
    const { market } = await detectAndPropose(ctx);
    await approve(ctx, ALICE, "publish_market");
    await cmd(ctx, BOB, BOB_AGENT, { kind: "back", points: 40, code: null }, 1);
    await cmd(ctx, ALICE, ALICE_AGENT, { kind: "fade", points: 60, code: null }, 2);
    await proposeResolution(ctx, {
      marketId: market!.id,
      outcome: "yes",
      proposedBy: "demo_resolver",
      evidenceNote: "stand-in",
    });
    await approve(ctx, ALICE, "confirm_resolution", "decline");
    expect(getMarket(ctx, market!.id)!.status).toBe("disputed");
    expect(getBalance(ctx, ALICE) + getBalance(ctx, BOB)).toBe(1900);
    await expect(
      resolveMarket(ctx, {
        marketId: market!.id,
        outcome: "void",
        by: "admin",
      }),
    ).resolves.toMatchObject({ status: "void" });
    expect([getBalance(ctx, ALICE), getBalance(ctx, BOB)]).toEqual([1000, 1000]);
    await expect(
      resolveMarket(ctx, { marketId: market!.id, outcome: "yes", by: "admin" }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await checkLedgerInvariants(ctx)).every((c) => c.ok)).toBe(true);
  });
});

describe("publication and privacy gates", () => {
  it("declining publish keeps everything in the subject's lane", async () => {
    const ctx = await setup();
    const { market } = await detectAndPropose(ctx);
    await approve(ctx, ALICE, "publish_market", "decline");
    expect(getMarket(ctx, market!.id)!.status).toBe("declined");
    expect(events(ctx).filter((e) => e.type === "a2a.sent")).toHaveLength(0);
    expect(
      events(ctx).filter((e) => e.type.startsWith("shortme.") && e.visibility === "shared"),
    ).toHaveLength(0);
    expect(outbox(ctx, BOB)).toHaveLength(0);
  });

  it("no invite to a friend without shortme_free_play, and the prompt names nobody", async () => {
    const ctx = await setup();
    await ctx.consent.set({
      userId: BOB,
      scope: "shortme_free_play",
      granted: false,
      via: "dashboard",
    });
    await detectAndPropose(ctx);
    const pub = await approve(ctx, ALICE, "publish_market");
    expect(pub.payload.invitees).toEqual([]);
    expect(events(ctx).filter((e) => e.type === "a2a.sent")).toHaveLength(0);
  });

  it("no market without the subject's own shortme consent", async () => {
    const ctx = await setup();
    await ctx.consent.set({
      userId: ALICE,
      scope: "shortme_free_play",
      granted: false,
      via: "dashboard",
    });
    const { market } = await detectAndPropose(ctx);
    expect(market).toBeNull();
  });

  it("detector rejects non-milestones and the mock never invents one", async () => {
    const ctx = await setup();
    const { out, market } = await detectAndPropose(ctx, "I'm so cooked for tomorrow's meeting lol");
    expect(market).toBeNull();
    expect(out.rejected[0]?.reason).toBe("not_an_intent");
  });

  it("a payload change after approval breaks the hash and the market stays proposed", async () => {
    const ctx = await setup();
    const { market } = await detectAndPropose(ctx);
    ctx.db.$client
      .prepare("update markets set question = ? where id = ?")
      .run("Will Alice get fired?", market!.id);
    const [a] = await pendingFor(ctx, ALICE, "publish_market");
    await expect(
      ctx.approvals.decide({
        approvalId: a!.id,
        userId: ALICE,
        decision: "approve",
        via: "sim_phone",
      }),
    ).rejects.toMatchObject({ code: "approval_invalid" });
    expect(getMarket(ctx, market!.id)!.status).toBe("proposed");
  });

  it("revoking shortme consent declines the subject's proposed market", async () => {
    const ctx = await setup();
    const { market } = await detectAndPropose(ctx);
    await ctx.consent.set({
      userId: ALICE,
      scope: "shortme_free_play",
      granted: false,
      via: "dashboard",
    });
    expect(getMarket(ctx, market!.id)!.status).toBe("declined");
  });
});

describe("positions", () => {
  async function openMarket() {
    const ctx = await setup();
    const { market } = await detectAndPropose(ctx);
    await approve(ctx, ALICE, "publish_market");
    return { ctx, id: market!.id };
  }

  it.each([
    [0, "validation_error"],
    [101, "validation_error"],
    [2.5, "validation_error"],
  ])("rejects %s points", async (points, code) => {
    const { ctx, id } = await openMarket();
    await expect(
      placePosition(ctx, {
        marketId: id,
        userId: BOB,
        side: "back",
        points,
        idempotencyKey: `k${points}`,
        via: "dashboard_fallback",
      }),
    ).rejects.toMatchObject({ code });
    expect(getBalance(ctx, BOB)).toBe(1000);
  });

  it("one position per user, idempotent replay, consent required, outsiders refused", async () => {
    const { ctx, id } = await openMarket();
    const p1 = await placePosition(ctx, {
      marketId: id,
      userId: BOB,
      side: "back",
      points: 30,
      idempotencyKey: "same",
      via: "dashboard_fallback",
    });
    const p2 = await placePosition(ctx, {
      marketId: id,
      userId: BOB,
      side: "back",
      points: 30,
      idempotencyKey: "same",
      via: "dashboard_fallback",
    });
    expect(p2.id).toBe(p1.id);
    expect(getBalance(ctx, BOB)).toBe(970);
    await expect(
      placePosition(ctx, {
        marketId: id,
        userId: BOB,
        side: "fade",
        points: 10,
        idempotencyKey: "other",
        via: "dashboard_fallback",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await ctx.consent.set({
      userId: ALICE,
      scope: "shortme_free_play",
      granted: false,
      via: "dashboard",
    });
    await expect(
      placePosition(ctx, {
        marketId: id,
        userId: ALICE,
        side: "fade",
        points: 10,
        idempotencyKey: "a",
        via: "dashboard_fallback",
      }),
    ).rejects.toMatchObject({ code: "consent_required" });
    {
      addUser(ctx, "usr_demo_carol", "Carol", "agt_demo_carol");
      await ctx.consent.set({
        userId: "usr_demo_carol",
        scope: "shortme_free_play",
        granted: true,
        via: "dashboard",
      });
      await expect(
        placePosition(ctx, {
          marketId: id,
          userId: "usr_demo_carol",
          side: "back",
          points: 10,
          idempotencyKey: "c",
          via: "dashboard_fallback",
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("PASS declines the invitation and closes betting for that friend", async () => {
    const { ctx, id } = await openMarket();
    expect(await cmd(ctx, BOB, BOB_AGENT, { kind: "pass", code: null }, 1)).toContain("Passed");
    await expect(
      placePosition(ctx, {
        marketId: id,
        userId: BOB,
        side: "back",
        points: 5,
        idempotencyKey: "after-pass",
        via: "dashboard_fallback",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("a wrong code is reported, not guessed", async () => {
    const { ctx } = await openMarket();
    expect(await cmd(ctx, BOB, BOB_AGENT, { kind: "back", points: 5, code: "zzzz" }, 1)).toContain(
      "No open ShortMe invitation with code ZZZZ",
    );
  });

  it("no counterparty at resolution voids and refunds", async () => {
    const { ctx, id } = await openMarket();
    await placePosition(ctx, {
      marketId: id,
      userId: BOB,
      side: "back",
      points: 25,
      idempotencyKey: "solo",
      via: "dashboard_fallback",
    });
    await proposeResolution(ctx, {
      marketId: id,
      outcome: "yes",
      proposedBy: "demo_resolver",
      evidenceNote: "stand-in",
    });
    expect(getMarket(ctx, id)!.status).toBe("void");
    expect(getBalance(ctx, BOB)).toBe(1000);
    expect((await checkLedgerInvariants(ctx)).every((c) => c.ok)).toBe(true);
  });
});

describe("state machine table", () => {
  it("allows exactly the Section 8.7 transitions", () => {
    const legal = new Set(
      Object.entries(TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`)),
    );
    expect([...legal].sort()).toEqual(
      [
        "proposed>open",
        "proposed>declined",
        "proposed>expired",
        "open>locked",
        "open>resolution_proposed",
        "open>void",
        "locked>resolution_proposed",
        "locked>void",
        "resolution_proposed>resolved",
        "resolution_proposed>disputed",
        "resolution_proposed>locked",
        "disputed>resolved",
        "disputed>void",
      ].sort(),
    );
    for (const from of MARKET_STATUSES)
      for (const to of MARKET_STATUSES)
        expect(canTransition(from, to)).toBe(legal.has(`${from}>${to}`));
  });

  it("illegal service calls are 409 with no ledger change", async () => {
    const ctx = await setup();
    const { market } = await detectAndPropose(ctx);
    await expect(
      placePosition(ctx, {
        marketId: market!.id,
        userId: ALICE,
        side: "fade",
        points: 5,
        idempotencyKey: "x",
        via: "dashboard_fallback",
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    await expect(
      proposeResolution(ctx, {
        marketId: market!.id,
        outcome: "no",
        proposedBy: "demo_resolver",
        evidenceNote: "",
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    await expect(
      resolveMarket(ctx, { marketId: market!.id, outcome: "yes", by: "admin" }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(getBalance(ctx, ALICE)).toBe(1000);
  });
});

describe("ledger properties through the database", () => {
  it("200 random markets: zero-sum, never negative, replays are no-ops", async () => {
    let s = 7;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ctx = await setup();
    let checkedMarkets = 0;
    for (let i = 0; i < 200; i++) {
      const { market } = await detectAndPropose(ctx, `${INTERVIEW} ${i}`);
      if (!market) throw new Error("no market");
      await approve(ctx, ALICE, "publish_market");
      const sides = [rnd() < 0.5 ? "back" : "fade", rnd() < 0.5 ? "back" : "fade"] as const;
      const balA = getBalance(ctx, ALICE);
      const balB = getBalance(ctx, BOB);
      const pts = [
        1 + Math.floor(rnd() * Math.min(100, balA)),
        1 + Math.floor(rnd() * Math.min(100, balB)),
      ];
      const pA = await placePosition(ctx, {
        marketId: market.id,
        userId: ALICE,
        side: sides[0],
        points: pts[0]!,
        idempotencyKey: `a${i}`,
        via: "dashboard_fallback",
      });
      await placePosition(ctx, {
        marketId: market.id,
        userId: BOB,
        side: sides[1],
        points: pts[1]!,
        idempotencyKey: `b${i}`,
        via: "dashboard_fallback",
      });
      // replay is a no-op
      await placePosition(ctx, {
        marketId: market.id,
        userId: ALICE,
        side: sides[0],
        points: pts[0]!,
        idempotencyKey: `a${i}`,
        via: "dashboard_fallback",
      });
      expect(pA.points).toBe(pts[0]);
      await proposeResolution(ctx, {
        marketId: market.id,
        outcome: rnd() < 0.5 ? "yes" : "no",
        proposedBy: "demo_resolver",
        evidenceNote: "prop",
      });
      if (getMarket(ctx, market.id)!.status === "resolution_proposed")
        await approve(ctx, ALICE, "confirm_resolution");
      expect(["resolved", "void"]).toContain(getMarket(ctx, market.id)!.status);
      expect(getBalance(ctx, ALICE) + getBalance(ctx, BOB)).toBe(2000);
      expect(getBalance(ctx, ALICE)).toBeGreaterThanOrEqual(0);
      checkedMarkets++;
    }
    expect(checkedMarkets).toBe(200);
    const inv = await checkLedgerInvariants(ctx);
    expect(inv.filter((c) => !c.ok)).toEqual([]);
  }, 60_000);
});

// Route bodies are checked field by field below; this reads them as loose JSON objects.
async function body(res: Response): Promise<Record<string, any>> {
  return (await res.json()) as Record<string, any>;
}

describe("routes", () => {
  it("schema errors, admin auth, privacy lens, ApiErrorBody shape", async () => {
    const ctx = await setup();
    const app = shortmeModule.routes(ctx);
    const { market } = await detectAndPropose(ctx);
    const asBob = await (await app.request(`/markets?viewerAgentId=${BOB_AGENT}`)).json();
    expect(asBob).toEqual([]);
    expect((await app.request(`/markets/${market!.id}?viewerAgentId=${BOB_AGENT}`)).status).toBe(
      404,
    );
    const asAlice = await body(
      await app.request(`/markets/${market!.id}?viewerAgentId=${ALICE_AGENT}`),
    );
    expect(asAlice.market.status).toBe("proposed");
    expect(asAlice.participants.every((p: Record<string, unknown>) => !("inviteCode" in p))).toBe(
      true,
    );

    const bad = await app.request(`/markets/${market!.id}/positions`, {
      method: "POST",
      body: JSON.stringify({ userId: BOB, side: "long", points: 5 }),
      headers: { "content-type": "application/json" },
    });
    expect(bad.status).toBe(400);
    expect((await body(bad)).error.code).toBe("validation_error");

    expect((await app.request("/invariants")).status).toBe(401);
    const ok = await body(
      await app.request("/invariants", {
        headers: { "x-dennis-admin": ctx.config.dennisAdminToken },
      }),
    );
    expect(ok.ok).toBe(true);

    const dr = await app.request(`/markets/${market!.id}/demo-resolve`, {
      method: "POST",
      body: JSON.stringify({ outcome: "no" }),
      headers: {
        "x-dennis-admin": ctx.config.dennisAdminToken,
        "content-type": "application/json",
      },
    });
    expect(dr.status).toBe(409);

    await approve(ctx, ALICE, "publish_market");
    const pos = await app.request(`/markets/${market!.id}/positions`, {
      method: "POST",
      body: JSON.stringify({ userId: BOB, side: "back", points: 50 }),
      headers: { "content-type": "application/json" },
    });
    expect(pos.status).toBe(201);
    const board = await (await app.request("/leaderboard")).json();
    expect(board).toContainEqual({
      firstName: "Bob",
      balance: 950,
      delta: -50,
    });
    const ledger = await body(await app.request(`/ledger?userId=${BOB}`));
    expect(ledger.balance).toBe(950);
    expect((await app.request("/ledger?userId=usr_nobody_x")).status).toBe(404);
  });
});

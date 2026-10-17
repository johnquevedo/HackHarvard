import { afterEach, expect, it } from "vitest";
import { Hono } from "hono";
import { MockStructuredLlm } from "@dennis/llm";
import { shortmeModule } from "@dennis/shortme";
import { SimMessagingProvider } from "@dennis/messaging";
import { createTestPlatform } from "@dennis/platform/testing";
import {
  drainPlatform,
  ingestInbound,
  mountPlatformRoutes,
  forgetUser,
  dispatchOutbox,
  type PlatformContext,
} from "@dennis/platform";
const contexts: PlatformContext[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    await drainPlatform(ctx);
    ctx.db.$client.close();
  }
});
async function setup() {
  const ctx = await createTestPlatform({ llm: new MockStructuredLlm() });
  contexts.push(ctx);
  return ctx;
}
let n = 0;
async function say(ctx: PlatformContext, text: string) {
  await ingestInbound(ctx, {
    provider: "sim",
    accountKey: "primary",
    providerMessageId: "trust-" + ++n,
    providerSenderId: null,
    providerSpaceId: null,
    senderHandle: ctx.config.demoAliceHandle,
    text,
    receivedAt: ctx.clock.nowIso(),
    mode: "simulated",
  });
  await drainPlatform(ctx);
}
it("erases private prose on FORGET while leaving audit event rows byte-for-byte unchanged", async () => {
  const ctx = await setup();
  const secret = "my private transcript 7319";
  await say(ctx, secret);
  const a = await ctx.approvals.request({
    userId: "usr_demo_alice",
    agentId: "agt_demo_alice",
    kind: "join_group_purchase",
    payload: { secret },
    promptText: secret + " YES {code}",
    ttlMinutes: 30,
    idempotencyKey: "forget-approval",
  });
  expect(
    JSON.stringify(ctx.events.history({ viewerAgentId: "agt_demo_alice", limit: 200 })),
  ).toContain(secret);
  const before = ctx.db.$client.prepare("SELECT * FROM events ORDER BY seq").all() as {
    seq: number;
  }[];
  expect(JSON.stringify(before)).not.toContain(secret);
  const result = await forgetUser(ctx, "usr_demo_alice");
  expect(result.deleted.messages).toBe(1);
  expect(
    ctx.db.$client
      .prepare("SELECT * FROM events WHERE seq<=? ORDER BY seq")
      .all(before.at(-1)!.seq),
  ).toEqual(before);
  expect(
    JSON.stringify(ctx.events.history({ viewerAgentId: "agt_demo_alice", limit: 200 })),
  ).not.toContain(secret);
  expect((await ctx.approvals.get(a.id))?.promptText).toBe("");
  expect(ctx.db.$client.prepare("SELECT * FROM kv WHERE key LIKE 'private-event:%'").all()).toEqual(
    [],
  );
  await dispatchOutbox(ctx);
  expect((ctx.messaging as SimMessagingProvider).sent).toHaveLength(0);
});
it("enforces the explicit viewer lens for intents, approvals, outbox and message threads", async () => {
  const ctx = await setup();
  await say(ctx, "private message");
  const app = new Hono();
  mountPlatformRoutes(app, ctx);
  for (const route of [
    "/api/approvals?userId=usr_demo_alice",
    "/api/outbox?userId=usr_demo_alice",
    "/api/sim/thread?userId=usr_demo_alice",
    "/api/intents?agentId=agt_demo_alice",
  ]) {
    expect((await app.request(route + "&viewerAgentId=agt_demo_bob")).status).toBe(403);
    expect((await app.request(route + "&viewerAgentId=agt_demo_alice")).status).toBe(200);
  }
  expect(
    JSON.stringify(ctx.events.history({ viewerAgentId: "agt_demo_bob", limit: 200 })),
  ).not.toContain("private message");
});
it("scans a complete ShortMe publish and revoke flow for raw text and forbidden shared fields", async () => {
  const ctx = await setup();
  await shortmeModule.register(ctx);
  await shortmeModule.seed(ctx);
  const raw =
    "just finished my final round interview at a quant firm. i either get the offer or im cooked";
  await say(ctx, raw);
  const pending = ctx.db.$client.prepare("SELECT * FROM markets").get() as {
    id: string;
    status: string;
  };
  expect(pending.status).toBe("proposed");
  const app = new Hono();
  mountPlatformRoutes(app, ctx);
  expect(await (await app.request("/api/opportunities?viewerAgentId=agt_demo_bob")).json()).toEqual(
    [],
  );
  const opportunity = ctx.db.$client
    .prepare("SELECT id FROM opportunities WHERE domain_ref_id=?")
    .get(pending.id) as { id: string };
  expect(
    (
      await app.request(
        "/api/opportunities/" + opportunity.id + "/explain?viewerAgentId=agt_demo_bob",
      )
    ).status,
  ).toBe(404);
  await say(ctx, "YES");
  expect(
    (
      ctx.db.$client.prepare("SELECT status FROM markets WHERE id=?").get(pending.id) as {
        status: string;
      }
    ).status,
  ).toBe("open");
  await ctx.consent.set({
    userId: "usr_demo_bob",
    scope: "shortme_free_play",
    granted: false,
    via: "dashboard",
  });
  const shared = ctx.events
    .history({ judge: true, limit: 200 })
    .filter((e) => e.visibility === "shared");
  expect(shared.length).toBeGreaterThan(0);
  const encoded = JSON.stringify(shared);
  for (const forbidden of [
    raw,
    "quant firm",
    ctx.config.demoAliceHandle,
    ctx.config.demoBobHandle,
    '"sourceExcerpt"',
    '"privatePayload"',
    '"senderHandle"',
    '"productText"',
  ])
    expect(encoded).not.toContain(forbidden);
  expect(
    (
      ctx.db.$client
        .prepare("SELECT invite_state FROM market_participants WHERE market_id=? AND user_id=?")
        .get(pending.id, "usr_demo_bob") as { invite_state: string }
    ).invite_state,
  ).toBe("declined");
});
it("refuses legacy private event erasure without falsely claiming a successful purge", async () => {
  const ctx = await setup();
  ctx.db.$client
    .prepare(
      "INSERT INTO events(id,ts,type,actor_kind,actor_agent_id,visibility,trace_id,payload) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      "evt_legacy",
      ctx.clock.nowIso(),
      "message.received",
      "agent",
      "agt_demo_alice",
      "private",
      "trace_legacy",
      JSON.stringify({ messageId: "legacy", provider: "sim", text: "legacy raw text" }),
    );
  await expect(forgetUser(ctx, "usr_demo_alice")).rejects.toMatchObject({ code: "invalid_state" });
});

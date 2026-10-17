import { afterEach, expect, it } from "vitest";
import { Hono } from "hono";
import type { Detection, DetectorInput } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { createTestPlatform } from "./testing.ts";
import { drainPlatform } from "./foundation.ts";
import { ingestInbound } from "./pipeline.ts";
import { recoverA2A } from "./a2a.ts";
import { agentScope } from "./stores.ts";
import { mountPlatformRoutes } from "./routes.ts";
import { update, row } from "./storage.ts";
const contexts: PlatformContext[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    await drainPlatform(ctx);
    ctx.db.$client.close();
  }
});
async function setup() {
  const ctx = await createTestPlatform();
  contexts.push(ctx);
  return ctx;
}
function detection(input: DetectorInput): Detection {
  return {
    kind: "purchase",
    confidence: 0.95,
    rationale: "Explicit plan",
    summary: "Monitor plan",
    privatePayload: {
      productText: "monitor",
      category: "monitor",
      quantity: 1,
      budgetMaxCents: 35000,
      timeframe: { kind: "this_month", from: null, to: null },
      statedCertainty: "considering",
      sourceExcerpt: input.text,
    },
    publicPayload: {
      category: "monitor",
      productKey: "monitor_27in_4k",
      quantity: 1,
      budgetBandMaxCents: 35000,
      window: { from: "2026-10-17", to: "2026-10-31" },
      regionCode: input.regionCode,
    },
  };
}
async function send(ctx: PlatformContext, name: "alice" | "bob", id = name) {
  return ingestInbound(ctx, {
    provider: "sim",
    accountKey: "primary",
    providerMessageId: id,
    providerSpaceId: null,
    providerSenderId: null,
    senderHandle: name === "alice" ? ctx.config.demoAliceHandle : ctx.config.demoBobHandle,
    text: "Private monitor plan from " + name,
    receivedAt: ctx.clock.nowIso(),
    mode: "simulated",
  });
}
it("rehearses two agents through detection, anonymous sharing, A2A and the conversation API", async () => {
  const ctx = await setup();
  ctx.detectors.register({
    id: "purchase",
    intentKind: "purchase",
    async detect(input) {
      return { detections: [detection(input)], rejected: [], llm: null };
    },
  });
  ctx.detectors.onDetection("purchase", async ({ intent }) => {
    await ctx.intents.markShared(intent.id);
    const peers = await ctx.intents.listShared({
      kind: "purchase",
      excludeAgentId: intent.agentId,
    });
    for (const peer of peers)
      await ctx.a2a.send({
        type: "purchase.probe",
        fromAgentId: intent.agentId,
        toAgentId: peer.agentId,
        conversationId: "cnv_acceptance",
        idempotencyKey: "probe:" + intent.id,
        payload: {
          intentRef: intent.id,
          publicIntent: intent.publicPayload!,
          leadAgentId: intent.agentId,
        },
      });
  });
  ctx.a2a.on("purchase.probe", async (message) => {
    await ctx.a2a.send({
      type: "purchase.probe_result",
      fromAgentId: message.toAgentId,
      toAgentId: message.fromAgentId,
      conversationId: message.conversationId,
      idempotencyKey: "response:" + message.id,
      payload: {
        intentRef: message.payload.intentRef,
        compatible: true,
        reasons: ["product_match"],
      },
    });
  });
  ctx.a2a.on("purchase.probe_result", async () => {});
  await send(ctx, "alice");
  await drainPlatform(ctx);
  await send(ctx, "bob");
  await drainPlatform(ctx);
  const alice = (await ctx.intents.listByAgent("agt_demo_alice"))[0]!;
  expect(await agentScope(ctx, "agt_demo_bob").intents.get(alice.id)).toBeNull();
  const shared = await agentScope(ctx, "agt_demo_bob").intents.listShared("purchase");
  expect(shared).toHaveLength(1);
  expect(JSON.stringify(shared)).not.toMatch(/privatePayload|sourceExcerpt|userId|Private monitor/);
  const app = new Hono();
  mountPlatformRoutes(app, ctx);
  const response = await app.request("/api/a2a?conversationId=cnv_acceptance", {
    headers: { "x-dennis-admin": ctx.config.dennisAdminToken },
  });
  expect(response.status).toBe(200);
  expect((await response.json()).map((m: { type: string }) => m.type)).toEqual([
    "purchase.probe",
    "purchase.probe_result",
  ]);
});
it.each(["pause", "disable", "revoke"])(
  "blocks inference results after %s during an external call",
  async (change) => {
    const ctx = await setup();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    ctx.detectors.register({
      id: "purchase",
      intentKind: "purchase",
      async detect(input) {
        entered();
        await gate;
        return { detections: [detection(input)], rejected: [], llm: null };
      },
    });
    let laterCalls = 0;
    ctx.detectors.register({
      id: "milestone",
      intentKind: "milestone",
      async detect() {
        laterCalls++;
        return { detections: [], rejected: [], llm: null };
      },
    });
    await send(ctx, "alice");
    await started;
    if (change === "pause")
      update(ctx.db, "agents", { status: "paused" }, "id=?", "agt_demo_alice");
    if (change === "disable")
      update(
        ctx.db,
        "agents",
        {
          settings: {
            matchingEnabled: false,
            shortmeEnabled: false,
            ackMode: "none",
          },
        },
        "id=?",
        "agt_demo_alice",
      );
    if (change === "revoke")
      await ctx.consent.set({
        userId: "usr_demo_alice",
        scope: "messaging_context",
        granted: false,
        via: "dashboard",
      });
    release();
    await drainPlatform(ctx);
    expect(await ctx.intents.listByAgent("agt_demo_alice")).toEqual([]);
    expect(laterCalls).toBe(0);
  },
);
it("recovers queued A2A after handler registration and binds retries to the opportunity", async () => {
  const ctx = await setup();
  const input = {
    type: "market.invite_response" as const,
    fromAgentId: "agt_demo_alice",
    toAgentId: "agt_demo_bob",
    conversationId: "cnv_recovery",
    idempotencyKey: "queued",
    payload: { marketId: "mkt_test", response: "accepted" },
  };
  const message = await ctx.a2a.send(input);
  await drainPlatform(ctx);
  expect(row(ctx.db, "SELECT status FROM a2a_messages WHERE id=?", message.id)).toEqual({
    status: "queued",
  });
  let handled = 0;
  ctx.a2a.on(input.type, async () => {
    handled++;
  });
  await recoverA2A(ctx);
  await recoverA2A(ctx);
  expect(handled).toBe(1);
  await expect(ctx.a2a.send({ ...input, opportunityId: "opp_changed" })).rejects.toMatchObject({
    code: "idempotency_conflict",
  });
});

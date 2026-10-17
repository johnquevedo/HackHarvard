import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createTestPlatform } from "./testing.ts";
import { mountPlatformRoutes } from "./routes.ts";
import { ingestInbound, runPipeline } from "./pipeline.ts";
import { dispatchOutbox, recoverPending, confirmOutbox } from "./runtime.ts";
import { row, rows, update } from "./storage.ts";
import { kv } from "@dennis/db";
import { DennisError, hashPayload } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import type { InboundMessageT, NewIntent } from "@dennis/contracts";
const contexts: PlatformContext[] = [];
async function setup(overrides: Parameters<typeof createTestPlatform>[0] = {}) {
  const ctx = await createTestPlatform(overrides);
  contexts.push(ctx);
  return ctx;
}
afterEach(() => {
  for (const ctx of contexts.splice(0)) ctx.db.$client.close();
});
function inbound(
  ctx: PlatformContext,
  id = "provider_1",
  text = "I want a monitor",
): InboundMessageT {
  return {
    provider: "sim",
    accountKey: "primary",
    providerMessageId: id,
    providerSpaceId: null,
    providerSenderId: null,
    senderHandle: ctx.config.demoAliceHandle,
    text,
    receivedAt: ctx.clock.nowIso(),
    mode: "simulated",
  };
}
const privatePayload = {
  productText: "monitor",
  category: "monitor",
  quantity: 1,
  budgetMaxCents: 35000,
  timeframe: { kind: "this_month", from: null, to: null },
  statedCertainty: "considering",
  sourceExcerpt: "I want a monitor",
};
const publicPayload = {
  category: "monitor",
  productKey: "monitor_27in_4k",
  quantity: 1,
  budgetBandMaxCents: 35000,
  window: { from: "2026-10-17", to: "2026-10-31" },
  regionCode: "boston-cambridge",
};
function intent(): NewIntent {
  return {
    agentId: "agt_demo_alice",
    userId: "usr_demo_alice",
    kind: "purchase",
    sourceMessageId: null,
    privatePayload,
    publicPayload,
    confidence: 0.95,
    rationale: "Explicit plan",
  };
}
const approvalInput = {
  kind: "authorize_payment" as const,
  userId: "usr_demo_alice",
  agentId: "agt_demo_alice",
  payload: { amountCents: 100 },
  promptText: "Approve sandbox transfer? YES {code}",
  ttlMinutes: 30,
  idempotencyKey: "approval-key",
};
describe("platform foundation", () => {
  it("opens SQLite with foreign keys and all initial tables", async () => {
    const ctx = await setup();
    expect(ctx.db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(
      rows(ctx.db, "SELECT name FROM sqlite_master WHERE type='table'").length,
    ).toBeGreaterThan(25);
    expect(await ctx.users.get("usr_demo_bob")).toBeTruthy();
  });
  it("replays inbound exactly once under concurrent delivery", async () => {
    const ctx = await setup();
    const result = await Promise.all([
      ingestInbound(ctx, inbound(ctx)),
      ingestInbound(ctx, inbound(ctx)),
    ]);
    expect(result.map((r) => r.outcome)).toEqual(["queued", "replay"]);
    await runPipeline(ctx, result[0]!.messageId!);
    expect(
      ctx.events
        .history({ judge: true, limit: 200 })
        .filter((e) => e.type === "message.received"),
    ).toHaveLength(1);
  });
  it("stores no unconsented text and still accepts AGREE", async () => {
    const ctx = await setup();
    await ctx.consent.set({
      userId: "usr_demo_alice",
      scope: "messaging_context",
      granted: false,
      via: "dashboard",
    });
    expect((await ingestInbound(ctx, inbound(ctx))).outcome).toBe("ignored");
    expect(
      row<{ text: null }>(ctx.db, "SELECT text FROM inbound_messages")?.text,
    ).toBeNull();
    expect(
      (await ingestInbound(ctx, inbound(ctx, "agree_1", "AGREE"))).outcome,
    ).toBe("command");
    expect(await ctx.consent.has("usr_demo_alice", "messaging_context")).toBe(
      true,
    );
  });
  it("drops unknown handles without storing their text", async () => {
    const ctx = await setup();
    expect(
      (
        await ingestInbound(ctx, {
          ...inbound(ctx),
          senderHandle: "stranger@example.test",
        })
      ).outcome,
    ).toBe("ignored");
    expect(rows(ctx.db, "SELECT text FROM inbound_messages")).toEqual([
      { text: null },
    ]);
  });
  it("STOP revokes every scope, pauses, and removes shared intents", async () => {
    const ctx = await setup();
    const i = await ctx.intents.create(intent());
    await ctx.intents.markShared(i.id);
    await ingestInbound(ctx, inbound(ctx, "stop_1", "STOP"));
    for (const scope of [
      "messaging_context",
      "purchase_matching",
      "shortme_free_play",
      "sandbox_payments",
    ] as const)
      expect(await ctx.consent.has("usr_demo_alice", scope)).toBe(false);
    expect((await ctx.users.getAgent("agt_demo_alice"))?.status).toBe("paused");
    expect(
      await ctx.intents.listShared({
        kind: "purchase",
        excludeAgentId: "agt_demo_bob",
      }),
    ).toEqual([]);
  });
  it("filters private events in history and live subscriptions", async () => {
    const ctx = await setup();
    const seen: string[] = [];
    const unsubscribe = ctx.events.subscribe(
      { viewerAgentId: "agt_demo_bob" },
      (e) => seen.push(e.type),
    );
    const result = await ingestInbound(ctx, inbound(ctx));
    await runPipeline(ctx, result.messageId!);
    unsubscribe();
    expect(seen).not.toContain("message.received");
    expect(
      ctx.events
        .history({ viewerAgentId: "agt_demo_bob", limit: 200 })
        .some((e) => e.payload.text),
    ).toBe(false);
    expect(
      ctx.events
        .history({ viewerAgentId: "agt_demo_alice", limit: 200 })
        .some((e) => e.type === "message.received"),
    ).toBe(true);
  });
  it("rejects private event leakage and extra shared fields", async () => {
    const ctx = await setup();
    expect(() =>
      ctx.events.emit({
        type: "message.received",
        actor: { kind: "agent", agentId: "agt_demo_alice" },
        visibility: "shared",
        payload: { messageId: "x", provider: "sim", text: "secret" },
      }),
    ).toThrow();
    expect(() =>
      ctx.events.emit({
        type: "intent.revoked",
        actor: { kind: "system" },
        visibility: "shared",
        payload: {
          intentId: "x",
          agentId: "y",
          reason: "revoked",
          text: "secret",
        },
      }),
    ).toThrow();
  });
  it("validates public payloads and exposes only anonymous shared views", async () => {
    const ctx = await setup();
    await expect(
      ctx.intents.create({
        ...intent(),
        publicPayload: { ...publicPayload, sourceExcerpt: "secret" },
      }),
    ).rejects.toThrow();
    const i = await ctx.intents.create(intent());
    await ctx.intents.markShared(i.id);
    const values = await ctx.intents.listShared({
      kind: "purchase",
      excludeAgentId: "agt_demo_bob",
    });
    expect(values).toHaveLength(1);
    expect(values[0]).not.toHaveProperty("userId");
    expect(values[0]).not.toHaveProperty("privatePayload");
    await expect(
      ctx.intents.revoke(i.id, { userId: "usr_demo_bob" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("enforces approval user, kind, hash, single consumption, and one hook", async () => {
    const ctx = await setup();
    const a = await ctx.approvals.request(approvalInput);
    let calls = 0;
    ctx.approvals.onDecided("authorize_payment", async () => {
      calls++;
    });
    await expect(
      ctx.approvals.decide({
        approvalId: a.id,
        userId: "usr_demo_bob",
        decision: "approve",
        via: "sim_phone",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await ctx.approvals.decide({
      approvalId: a.id,
      userId: a.userId,
      decision: "approve",
      via: "sim_phone",
    });
    await ctx.approvals.decide({
      approvalId: a.id,
      userId: a.userId,
      decision: "approve",
      via: "sim_phone",
    });
    expect(calls).toBe(1);
    const binding = {
      approvalId: a.id,
      userId: a.userId,
      kind: a.kind,
      payloadHash: hashPayload(a.payload),
    };
    await expect(
      ctx.approvals.assertApproved({ ...binding, payloadHash: "0".repeat(64) }),
    ).rejects.toThrow();
    await expect(
      ctx.approvals.assertApproved({ ...binding, kind: "publish_market" }),
    ).rejects.toThrow();
    await expect(ctx.approvals.assertApproved(binding)).resolves.toMatchObject({
      id: a.id,
    });
    await ctx.approvals.consume(a.id);
    await expect(ctx.approvals.consume(a.id)).rejects.toThrow();
    await expect(ctx.approvals.assertApproved(binding)).rejects.toThrow();
  });
  it("expires approvals deterministically and rejects payload tampering", async () => {
    let now = new Date("2026-10-17T12:00:00Z");
    const ctx = await setup({
      clock: { now: () => now, nowIso: () => now.toISOString() },
    });
    const a = await ctx.approvals.request(approvalInput);
    now = new Date(now.getTime() + 31 * 60000);
    expect(await ctx.approvals.expireDue()).toBe(1);
    await expect(
      ctx.approvals.decide({
        approvalId: a.id,
        userId: a.userId,
        decision: "approve",
        via: "sim_phone",
      }),
    ).rejects.toThrow();
    const b = await ctx.approvals.request({
      ...approvalInput,
      idempotencyKey: "second",
    });
    await ctx.approvals.decide({
      approvalId: b.id,
      userId: b.userId,
      decision: "approve",
      via: "sim_phone",
    });
    update(
      ctx.db,
      "approvals",
      { payload: { amountCents: 900 } },
      "id=?",
      b.id,
    );
    await expect(
      ctx.approvals.assertApproved({
        approvalId: b.id,
        userId: b.userId,
        kind: b.kind,
        payloadHash: b.payloadHash,
      }),
    ).rejects.toThrow();
  });
  it("deduplicates approval and outbox writes and refuses changed inputs", async () => {
    const ctx = await setup();
    const a = await ctx.approvals.request(approvalInput);
    expect((await ctx.approvals.request(approvalInput)).id).toBe(a.id);
    expect(rows(ctx.db, "SELECT * FROM outbox")).toHaveLength(1);
    await expect(
      ctx.approvals.request({
        ...approvalInput,
        payload: { amountCents: 200 },
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    await dispatchOutbox(ctx);
    await dispatchOutbox(ctx);
    expect(
      rows<{ status: string }>(ctx.db, "SELECT status FROM outbox"),
    ).toEqual([{ status: "delivered" }]);
  });
  it("routes YES with the exact code and never guesses ambiguous approvals", async () => {
    const ctx = await setup();
    const a = await ctx.approvals.request(approvalInput);
    await ctx.approvals.request({ ...approvalInput, idempotencyKey: "other" });
    await ingestInbound(ctx, inbound(ctx, "yes_1", "YES"));
    expect((await ctx.approvals.get(a.id))?.status).toBe("pending");
    await ingestInbound(ctx, inbound(ctx, "yes_2", "YES " + a.shortCode));
    expect((await ctx.approvals.get(a.id))?.status).toBe("approved");
  });
  it("serializes A2A per recipient and records handler failure", async () => {
    const ctx = await setup();
    let active = 0,
      max = 0;
    ctx.a2a.on("market.invite_response", async (msg) => {
      active++;
      max = Math.max(max, active);
      await Promise.resolve();
      active--;
      if (msg.payload.response === "declined")
        throw new Error("private failure text");
    });
    const input = {
      type: "market.invite_response" as const,
      fromAgentId: "agt_demo_alice",
      toAgentId: "agt_demo_bob",
      conversationId: "cnv_1",
      payload: { marketId: "mkt_demo_test", response: "accepted" },
      idempotencyKey: "one",
    };
    await ctx.a2a.send(input);
    await ctx.a2a.send({
      ...input,
      payload: { ...input.payload, response: "declined" },
      idempotencyKey: "two",
    });
    await recoverPending(ctx);
    expect(max).toBe(1);
    expect(
      rows<{ status: string }>(
        ctx.db,
        "SELECT status FROM a2a_messages ORDER BY id",
      )
        .map((r) => r.status)
        .sort(),
    ).toEqual(["failed", "handled"]);
    await expect(
      ctx.a2a.send({
        ...input,
        payload: { ...input.payload, text: "secret" },
        idempotencyKey: "bad",
      }),
    ).rejects.toThrow();
  });
  it("runs a registered detector and never invokes disabled detection", async () => {
    const ctx = await setup();
    let calls = 0;
    ctx.detectors.register({
      id: "purchase",
      intentKind: "purchase",
      async detect() {
        calls++;
        return {
          detections: [
            {
              kind: "purchase",
              confidence: 0.95,
              rationale: "Explicit",
              privatePayload,
              publicPayload,
              summary: "Monitor plan",
            },
          ],
          rejected: [],
          llm: null,
        };
      },
    });
    const result = await ingestInbound(ctx, inbound(ctx));
    await runPipeline(ctx, result.messageId!);
    expect(calls).toBe(1);
    expect(await ctx.intents.listByAgent("agt_demo_alice")).toHaveLength(1);
    await ctx.consent.set({
      userId: "usr_demo_alice",
      scope: "purchase_matching",
      granted: false,
      via: "dashboard",
    });
    const next = await ingestInbound(ctx, inbound(ctx, "next"));
    await runPipeline(ctx, next.messageId!);
    expect(calls).toBe(1);
  });
  it("protects admin routes, validates requests, masks handles, and supports sim ingest", async () => {
    const ctx = await setup();
    const app = new Hono();
    mountPlatformRoutes(app, ctx);
    expect((await app.request("/api/health")).status).toBe(200);
    expect((await app.request("/api/events")).status).toBe(401);
    expect(
      (
        await app.request("/api/events?limit=-1", {
          headers: { "x-dennis-admin": ctx.config.dennisAdminToken },
        })
      ).status,
    ).toBe(400);
    const users = await (await app.request("/api/users")).json();
    expect(users[0].user.handle.startsWith("***")).toBe(true);
    const response = await app.request("/api/sim/inbound", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dennis-admin": ctx.config.dennisAdminToken,
      },
      body: JSON.stringify({
        fromUserId: "usr_demo_alice",
        text: "Monitor please",
        clientMessageId: "api-one",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: true });
    const bobEvents = await (
      await app.request("/api/events?viewerAgentId=agt_demo_bob")
    ).json();
    expect(
      bobEvents.events.some(
        (e: { type: string }) => e.type === "message.received",
      ),
    ).toBe(false);
  });
  it("replays SSE history in sequence with event ids", async () => {
    const ctx = await setup();
    await ingestInbound(ctx, inbound(ctx));
    const app = new Hono();
    mountPlatformRoutes(app, ctx);
    const controller = new AbortController();
    const response = await app.request(
      "/api/events/stream?viewerAgentId=agt_demo_alice",
      { signal: controller.signal },
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    let text = "";
    while (!text.includes("message.received")) {
      const result = await reader.read();
      if (result.done) break;
      text += new TextDecoder().decode(result.value);
    }
    expect(text).toContain("event: domain");
    expect(text).toMatch(/id: \d+/);
    controller.abort();
    await reader.cancel();
  });
});

it("consumes an approval in the same Drizzle transaction as the domain write", async () => {
  const ctx = await setup();
  const a = await ctx.approvals.request(approvalInput);
  await ctx.approvals.decide({
    approvalId: a.id,
    userId: a.userId,
    decision: "approve",
    via: "sim_phone",
  });
  expect(() => ctx.approvals.consumeInTransaction(a.id, ctx.db)).toThrow();
  expect(() =>
    ctx.db.transaction((tx) => {
      ctx.approvals.consumeInTransaction(a.id, tx);
      tx.insert(kv).values({ key: "guarded-action", value: true }).run();
      throw new Error("Domain write failed");
    }),
  ).toThrow("Domain write failed");
  expect((await ctx.approvals.get(a.id))?.consumedAt).toBeNull();
  expect(row(ctx.db, "SELECT * FROM kv WHERE key='guarded-action'")).toBeNull();
  ctx.db.transaction((tx) => {
    ctx.approvals.consumeInTransaction(a.id, tx);
    tx.insert(kv).values({ key: "guarded-action", value: true }).run();
  });
  expect((await ctx.approvals.get(a.id))?.consumedAt).not.toBeNull();
  expect(
    row(ctx.db, "SELECT * FROM kv WHERE key='guarded-action'"),
  ).toMatchObject({ value: true });
});
it("deduplicates concurrent notifications", async () => {
  const ctx = await setup();
  const input = {
    userId: "usr_demo_alice",
    kind: "info" as const,
    text: "Ready",
    idempotencyKey: "concurrent",
  };
  const values = await Promise.all([
    ctx.notifier.send(input),
    ctx.notifier.send(input),
  ]);
  expect(values[0]!.id).toBe(values[1]!.id);
  expect(rows(ctx.db, "SELECT * FROM outbox")).toHaveLength(1);
});
it("retries transient outbox failures at the specified backoff", async () => {
  let now = new Date("2026-10-17T12:00:00Z");
  const ctx = await setup({
    clock: { now: () => now, nowIso: () => now.toISOString() },
  });
  let calls = 0;
  const original = ctx.messaging.send.bind(ctx.messaging);
  ctx.messaging.send = async (req) => {
    calls++;
    if (calls === 1) throw new Error("network");
    return original(req);
  };
  await ctx.notifier.send({
    userId: "usr_demo_alice",
    kind: "info",
    text: "hello",
    idempotencyKey: "retry",
  });
  await dispatchOutbox(ctx);
  expect(calls).toBe(1);
  now = new Date(now.getTime() + 4000);
  await dispatchOutbox(ctx);
  expect(calls).toBe(1);
  now = new Date(now.getTime() + 1000);
  await dispatchOutbox(ctx);
  expect(calls).toBe(2);
  expect(row(ctx.db, "SELECT * FROM outbox")).toMatchObject({
    status: "delivered",
    attempts: 2,
  });
});
it("does not retry a permanent provider rejection", async () => {
  const ctx = await setup();
  let calls = 0;
  ctx.messaging.send = async () => {
    calls++;
    throw new DennisError("upstream_error", "Rejected", 502, {
      retryable: false,
    });
  };
  await ctx.notifier.send({
    userId: "usr_demo_alice",
    kind: "info",
    text: "hello",
    idempotencyKey: "permanent",
  });
  await dispatchOutbox(ctx);
  await dispatchOutbox(ctx);
  expect(calls).toBe(1);
  expect(row(ctx.db, "SELECT * FROM outbox")).toMatchObject({
    status: "failed",
    attempts: 4,
  });
});
it("sets delivered only after a provider read-back", async () => {
  let now = new Date("2026-10-17T12:00:00Z");
  const ctx = await setup({
    clock: { now: () => now, nowIso: () => now.toISOString() },
  });
  const o = await ctx.notifier.send({
    userId: "usr_demo_alice",
    kind: "info",
    text: "hello",
    idempotencyKey: "delivery",
  });
  update(
    ctx.db,
    "outbox",
    {
      status: "dispatched",
      providerMessageId: "provider_msg",
      providerStatus: "accepted",
      sentAt: now.toISOString(),
    },
    "id=?",
    o.id,
  );
  let calls = 0;
  const read = async () => {
    calls++;
    return calls === 1 ? ("accepted" as const) : ("delivered" as const);
  };
  await confirmOutbox(ctx, read);
  expect(calls).toBe(0);
  now = new Date(now.getTime() + 2000);
  await confirmOutbox(ctx, read);
  expect(row(ctx.db, "SELECT * FROM outbox")).toMatchObject({
    status: "dispatched",
    deliveredAt: null,
  });
  now = new Date(now.getTime() + 3000);
  await confirmOutbox(ctx, read);
  expect(row(ctx.db, "SELECT * FROM outbox")).toMatchObject({
    status: "delivered",
    deliveredAt: now.toISOString(),
  });
});
it("keeps proposed and declined market opportunities private", async () => {
  const ctx = await setup();
  const value = await ctx.opportunities.upsert({
    type: "shortme_market",
    domainRefId: "mkt_demo_private",
    status: "proposed",
    headline: "Private question",
    participantAgentIds: ["agt_demo_alice", "agt_demo_bob"],
  });
  expect(
    await ctx.opportunities.list({ viewerAgentId: "agt_demo_bob" }),
  ).toEqual([]);
  await ctx.opportunities.upsert({
    type: value.type,
    domainRefId: value.domainRefId,
    status: "declined",
    headline: value.headline,
    participantAgentIds: value.participantAgentIds,
  });
  expect(
    ctx.events
      .history({ viewerAgentId: "agt_demo_bob", limit: 200 })
      .filter((e) => e.type === "opportunity.updated"),
  ).toHaveLength(0);
  const app = new Hono();
  mountPlatformRoutes(app, ctx);
  expect(await (await app.request("/api/opportunities")).json()).toEqual([]);
  expect(
    (
      await app.request(
        "/api/opportunities/" + value.id + "?viewerAgentId=agt_demo_bob",
      )
    ).status,
  ).toBe(404);
});
it("throttles unknown-handle onboarding for a rolling hour without storing text", async () => {
  let now = new Date("2026-10-17T12:59:59Z");
  const ctx = await setup({
    clock: { now: () => now, nowIso: () => now.toISOString() },
  });
  let calls = 0;
  const original = ctx.messaging.send.bind(ctx.messaging);
  ctx.messaging.send = async (req) => {
    calls++;
    return original(req);
  };
  const unknown = {
    ...inbound(ctx, "unknown-1", "private unknown message"),
    senderHandle: "stranger@example.test",
  };
  await ingestInbound(ctx, unknown);
  now = new Date(now.getTime() + 2000);
  await ingestInbound(ctx, { ...unknown, providerMessageId: "unknown-2" });
  expect(calls).toBe(1);
  expect(rows(ctx.db, "SELECT text FROM inbound_messages")).toEqual([
    { text: null },
    { text: null },
  ]);
  expect(
    JSON.stringify(
      ctx.db.$client.prepare("SELECT * FROM photon_cursors").all(),
    ),
  ).not.toContain("stranger@example.test");
});
it("blocks handles in free-form shared event fields", async () => {
  const ctx = await setup();
  expect(() =>
    ctx.events.emit({
      type: "purchase.match.evaluated",
      actor: { kind: "system" },
      visibility: "shared",
      payload: {
        conversationId: "c",
        aAgentId: "agt_demo_alice",
        bAgentId: "agt_demo_bob",
        compatible: true,
        checks: [
          { rule: "region", passed: true, detail: "alice@example.test" },
        ],
      },
    }),
  ).toThrow();
});

it("verifies and deduplicates signed Photon webhook deliveries", async () => {
  const key = Buffer.from("synthetic-test-secret");
  const secret = "whsec_" + key.toString("base64");
  const ctx = await setup({
    config: { photonWebhookSecret: secret, photonAgentUserId: "pho_usr_agent" },
  });
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../../../fixtures/photon/inbound-text.synthetic.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const raw = JSON.stringify({ data: fixture });
  const id = "webhook_test";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    "v1," +
    createHmac("sha256", key)
      .update(id + "." + timestamp + "." + raw)
      .digest("base64");
  const headers = {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": signature,
  };
  const app = new Hono();
  mountPlatformRoutes(app, ctx);
  for (let count = 0; count < 2; count++)
    expect(
      (
        await app.request("/webhooks/photon", {
          method: "POST",
          headers,
          body: raw,
        })
      ).status,
    ).toBe(200);
  expect(rows(ctx.db, "SELECT * FROM inbound_messages")).toHaveLength(1);
  expect(
    rows(
      ctx.db,
      "SELECT * FROM photon_cursors WHERE key='webhook:webhook_test'",
    ),
  ).toHaveLength(1);
  expect(
    (
      await app.request("/webhooks/photon", {
        method: "POST",
        headers,
        body: raw + " ",
      })
    ).status,
  ).toBe(401);
});

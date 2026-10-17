import { afterEach, expect, it } from "vitest";
import { SimMessagingProvider } from "@dennis/messaging";
import type { PlatformContext } from "./context.ts";
import { createTestPlatform } from "./testing.ts";
import { drainPlatform } from "./foundation.ts";
import { ingestInbound } from "./pipeline.ts";
import { dispatchOutbox } from "./runtime.ts";
import { update } from "./storage.ts";
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
const request = {
  userId: "usr_demo_alice",
  agentId: "agt_demo_alice",
  kind: "join_group_purchase" as const,
  payload: { groupId: "grp_acceptance", shareCents: 28499 },
  promptText: "Join the simulated offer? YES {code}",
  ttlMinutes: 30,
  idempotencyKey: "acceptance",
};
it("delivers an approval prompt and applies repeated YES once", async () => {
  const ctx = await setup();
  const approval = await ctx.approvals.request(request);
  let hooks = 0;
  ctx.approvals.onDecided(approval.kind, async () => {
    hooks++;
  });
  await dispatchOutbox(ctx);
  const sent = (ctx.messaging as SimMessagingProvider).sent;
  expect(sent).toHaveLength(1);
  expect(sent[0]!.text).toContain("YES " + approval.shortCode);
  for (const id of ["yes-one", "yes-two"])
    await ingestInbound(ctx, {
      provider: "sim",
      accountKey: "primary",
      providerMessageId: id,
      providerSenderId: null,
      providerSpaceId: null,
      senderHandle: ctx.config.demoAliceHandle,
      text: "YES " + approval.shortCode,
      receivedAt: ctx.clock.nowIso(),
      mode: "simulated",
    });
  expect((await ctx.approvals.get(approval.id))?.status).toBe("approved");
  expect(hooks).toBe(1);
  expect(
    ctx.events.history({ judge: true, limit: 200 }).filter((e) => e.type === "approval.decided"),
  ).toHaveLength(1);
});
it("rejects tampered payloads through the legacy consumer as well as the transactional consumer", async () => {
  const ctx = await setup();
  const a = await ctx.approvals.request(request);
  await ctx.approvals.decide({
    approvalId: a.id,
    userId: a.userId,
    decision: "approve",
    via: "sim_phone",
  });
  update(ctx.db, "approvals", { payload: { shareCents: 1 } }, "id=?", a.id);
  await expect(ctx.approvals.consume(a.id)).rejects.toMatchObject({ code: "approval_invalid" });
  expect((await ctx.approvals.get(a.id))?.consumedAt).toBeNull();
});
it("uses all three retry intervals and stops after four transient send attempts", async () => {
  let now = new Date("2026-10-17T12:00:00Z");
  const ctx = await createTestPlatform({
    clock: { now: () => now, nowIso: () => now.toISOString() },
  });
  contexts.push(ctx);
  let calls = 0;
  ctx.messaging.send = async () => {
    calls++;
    throw new Error("temporary");
  };
  await ctx.notifier.send({
    userId: request.userId,
    kind: "info",
    text: "Retry",
    idempotencyKey: "all-retries",
  });
  await dispatchOutbox(ctx);
  expect(calls).toBe(1);
  for (const delay of [5000, 15000, 45000]) {
    now = new Date(now.getTime() + delay - 1);
    await dispatchOutbox(ctx);
    const before = calls;
    now = new Date(now.getTime() + 1);
    await dispatchOutbox(ctx);
    expect(calls).toBe(before + 1);
  }
  now = new Date(now.getTime() + 60000);
  await dispatchOutbox(ctx);
  expect(calls).toBe(4);
});

it("reports delivery latency once with an explicit measured span and simulated mode", async () => {
  const ctx = await setup();
  await ctx.notifier.send({
    userId: "usr_demo_alice",
    kind: "info",
    text: "Measured",
    idempotencyKey: "latency",
  });
  await dispatchOutbox(ctx);
  await dispatchOutbox(ctx);
  const metrics = ctx.events
    .history({ judge: true, limit: 200 })
    .filter((e) => e.type === "messaging.latency");
  expect(metrics).toHaveLength(1);
  expect(metrics[0]).toMatchObject({
    visibility: "private",
    mode: "simulated",
    payload: { span: "outbox_send_to_delivered", provider: "sim" },
  });
  expect(metrics[0]!.payload.latencyMs).toBeGreaterThanOrEqual(0);
});

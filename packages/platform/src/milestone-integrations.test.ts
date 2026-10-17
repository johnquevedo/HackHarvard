import { afterEach, expect, it, vi } from "vitest";
import type { IntegrationStatusT } from "@dennis/contracts";
import { Hono } from "hono";
import type { PlatformContext } from "./context.ts";
import { createTestPlatform } from "./testing.ts";
import { drainPlatform } from "./foundation.ts";
import { registerIntegrationHealth } from "./integrations.ts";
import { startRuntime } from "./runtime.ts";
import { mountPlatformRoutes } from "./routes.ts";
const contexts: PlatformContext[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const ctx of contexts.splice(0)) {
    await drainPlatform(ctx);
    ctx.db.$client.close();
  }
});
it("polls every registered provider every 15 seconds and exposes failures as unhealthy", async () => {
  const ctx = await createTestPlatform();
  contexts.push(ctx);
  vi.useFakeTimers();
  let bankingCalls = 0,
    chalkCalls = 0;
  const bankStatus: IntegrationStatusT = {
    name: "nessie",
    mode: "simulated",
    healthy: true,
    detail: "SIMULATED BANK",
    lastCheckedAt: ctx.clock.nowIso(),
    lastSuccessAt: ctx.clock.nowIso(),
  };
  registerIntegrationHealth(ctx, "nessie", async () => {
    bankingCalls++;
    if (bankingCalls > 1) throw new Error("secret provider response");
    return bankStatus;
  });
  registerIntegrationHealth(ctx, "chalk", async () => {
    chalkCalls++;
    return {
      ...bankStatus,
      name: "chalk",
      mode: "fallback",
      healthy: false,
      detail: "LOCAL RUN (NOT CHALK)",
    };
  });
  const runtime = await startRuntime(ctx);
  try {
    expect(bankingCalls).toBe(1);
    expect(chalkCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(15000);
    expect(bankingCalls).toBe(2);
    expect(chalkCalls).toBe(2);
    const app = new Hono();
    mountPlatformRoutes(app, ctx);
    const statuses = (await (
      await app.request("/api/integrations")
    ).json()) as IntegrationStatusT[];
    expect(statuses.find((s) => s.name === "nessie")).toMatchObject({
      healthy: false,
      lastSuccessAt: bankStatus.lastSuccessAt,
    });
    expect(JSON.stringify(statuses)).not.toContain("secret provider response");
    const transitions = ctx.events
      .history({ judge: true, limit: 200 })
      .filter((e) => e.type === "integration.status" && e.payload.name === "nessie");
    expect(transitions.map((e) => e.payload.healthy)).toEqual([false, true, false]);
    await vi.advanceTimersByTimeAsync(15000);
    expect(
      ctx.events
        .history({ judge: true, limit: 200 })
        .filter((e) => e.type === "integration.status" && e.payload.name === "nessie"),
    ).toHaveLength(3);
  } finally {
    await runtime.stop();
  }
});
it("times out a hung health check and continues to the next registered provider", async () => {
  const ctx = await createTestPlatform();
  contexts.push(ctx);
  vi.useFakeTimers();
  registerIntegrationHealth(ctx, "nessie", () => new Promise(() => {}));
  let checked = false;
  registerIntegrationHealth(ctx, "chalk", async () => {
    checked = true;
    return {
      name: "chalk",
      mode: "fallback",
      healthy: false,
      detail: "LOCAL RUN (NOT CHALK)",
      lastCheckedAt: ctx.clock.nowIso(),
      lastSuccessAt: null,
    };
  });
  const starting = startRuntime(ctx);
  await vi.advanceTimersByTimeAsync(10000);
  const runtime = await starting;
  try {
    expect(checked).toBe(true);
    expect(ctx.integrations.list().find((s) => s.name === "nessie")?.healthy).toBe(false);
  } finally {
    await runtime.stop();
  }
});

it("gates optional acknowledgements on consent and settings, dedupes them and always stops typing", async () => {
  const ctx = await createTestPlatform();
  contexts.push(ctx);
  const { ingestInbound } = await import("./pipeline.ts");
  const { update } = await import("./storage.ts");
  const calls: string[] = [];
  ctx.messaging.acknowledge = async () => {
    calls.push("ack");
  };
  ctx.messaging.setTyping = async (_space, enabled) => {
    calls.push("typing:" + enabled);
  };
  update(
    ctx.db,
    "agents",
    { settings: { matchingEnabled: true, shortmeEnabled: true, ackMode: "reaction" } },
    "id=?",
    "agt_demo_alice",
  );
  const message = {
    provider: "photon" as const,
    accountKey: "primary",
    providerMessageId: "ack-one",
    providerSpaceId: "pho_spc_test",
    providerSenderId: "pho_usr_sender",
    senderHandle: ctx.config.demoAliceHandle,
    text: "I want a monitor",
    receivedAt: ctx.clock.nowIso(),
    mode: "live" as const,
  };
  await ingestInbound(ctx, message);
  await drainPlatform(ctx);
  expect(calls).toEqual(["ack", "typing:true", "typing:false"]);
  await ingestInbound(ctx, message);
  await drainPlatform(ctx);
  expect(calls).toHaveLength(3);
  await ctx.consent.set({
    userId: "usr_demo_alice",
    scope: "messaging_context",
    granted: false,
    via: "dashboard",
  });
  await ingestInbound(ctx, { ...message, providerMessageId: "ack-without-consent" });
  await drainPlatform(ctx);
  expect(calls).toHaveLength(3);
});

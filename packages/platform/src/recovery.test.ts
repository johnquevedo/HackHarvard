import { afterEach, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppConfigSchema } from "@dennis/contracts";
import { SimMessagingProvider } from "@dennis/messaging";
import type { PlatformContext } from "./context.ts";
import { createPlatform, seedCore, drainPlatform } from "./foundation.ts";
import { createTestPlatform } from "./testing.ts";
import { recoverPending, startRuntime } from "./runtime.ts";
import { row, rows, update } from "./storage.ts";
const contexts: PlatformContext[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    await drainPlatform(ctx);
    if (ctx.db.$client.open) ctx.db.$client.close();
  }
  for (const path of dirs.splice(0))
    rmSync(path, { recursive: true, force: true });
});
async function setup() {
  const ctx = await createTestPlatform();
  contexts.push(ctx);
  return ctx;
}
const request = {
  kind: "authorize_payment" as const,
  userId: "usr_demo_alice",
  agentId: "agt_demo_alice",
  payload: { amountCents: 100 },
  promptText: "Sandbox transfer? YES {code}",
  ttlMinutes: 30,
  idempotencyKey: "race-one",
};
it("does not emit an approval decision after a concurrent revocation wins", async () => {
  const ctx = await setup();
  const a = await ctx.approvals.request(request);
  let hooks = 0;
  ctx.approvals.onDecided(a.kind, async () => {
    hooks++;
  });
  const deciding = ctx.approvals.decide({
    approvalId: a.id,
    userId: a.userId,
    decision: "approve",
    via: "sim_phone",
  });
  await Promise.resolve();
  await Promise.resolve();
  update(ctx.db, "approvals", { status: "revoked" }, "id=?", a.id);
  await expect(deciding).rejects.toMatchObject({ code: "approval_invalid" });
  expect(hooks).toBe(0);
  expect(
    ctx.events
      .history({ judge: true, limit: 200 })
      .filter((e) => e.type === "approval.decided"),
  ).toHaveLength(0);
});
it("expires each approval and invokes its hook once under concurrent sweepers", async () => {
  const ctx = await setup();
  const a = await ctx.approvals.request(request);
  const b = await ctx.approvals.request({
    ...request,
    idempotencyKey: "race-two",
  });
  update(
    ctx.db,
    "approvals",
    { expiresAt: "2000-01-01T00:00:00.000Z" },
    "id IN (?,?)",
    a.id,
    b.id,
  );
  let hooks = 0;
  ctx.approvals.onDecided(a.kind, async () => {
    hooks++;
  });
  const counts = await Promise.all([
    ctx.approvals.expireDue(),
    ctx.approvals.expireDue(),
  ]);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
  expect(hooks).toBe(2);
  expect(
    ctx.events
      .history({ judge: true, limit: 200 })
      .filter((e) => e.type === "approval.expired"),
  ).toHaveLength(2);
});
it("stops the messaging listener if startup recovery fails", async () => {
  const ctx = await setup();
  let stopped = false;
  ctx.messaging.stop = async () => {
    stopped = true;
  };
  ctx.approvals.expireDue = async () => {
    throw new Error("Recovery failed");
  };
  await expect(startRuntime(ctx)).rejects.toThrow("Recovery failed");
  expect(stopped).toBe(true);
});
it("reconciles an interrupted final outbox send after a database restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dennis-recovery-"));
  dirs.push(directory);
  const config = AppConfigSchema.parse({
    databaseUrl: "file:" + join(directory, "state.db"),
    dennisAdminToken: "test-recovery-admin-token",
    dennisMode: "sim",
    photonMode: "sim",
    nessieMode: "sim",
    llmProvider: "mock",
    nodeEnv: "test",
  });
  const messaging = new SimMessagingProvider();
  const first = await createPlatform({ config, messaging });
  contexts.push(first);
  await seedCore(first);
  const queued = await first.notifier.send({
    userId: "usr_demo_alice",
    kind: "info",
    text: "Recovered result",
    idempotencyKey: "durable-send",
  });
  update(
    first.db,
    "outbox",
    { status: "sending", attempts: 4, sentAt: first.clock.nowIso() },
    "id=?",
    queued.id,
  );
  const user = await first.users.get("usr_demo_alice");
  await messaging.send({
    accountKey: config.photonAccountKey,
    toHandle: user!.handle,
    toPhotonUserId: null,
    spaceId: null,
    text: queued.text,
    idempotencyKey: "durable-send",
  });
  await drainPlatform(first);
  first.db.$client.close();
  const second = await createPlatform({ config, messaging });
  contexts.push(second);
  await recoverPending(second);
  expect(
    row(second.db, "SELECT * FROM outbox WHERE id=?", queued.id),
  ).toMatchObject({ status: "delivered", attempts: 5 });
  expect(messaging.sent).toHaveLength(1);
  expect(rows(second.db, "SELECT id FROM outbox")).toHaveLength(1);
});
it("bootstraps ShortMe invitation codes before a feature module registers", async () => {
  const ctx = await setup();
  expect(
    ctx.db.$client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='market_invites'",
      )
      .get(),
  ).toBeTruthy();
});
it("notifies the feature hook when a reply discovers an expired approval", async () => {
  const ctx = await setup();
  const a = await ctx.approvals.request(request);
  update(
    ctx.db,
    "approvals",
    { expiresAt: "2000-01-01T00:00:00.000Z" },
    "id=?",
    a.id,
  );
  const statuses: string[] = [];
  ctx.approvals.onDecided(a.kind, async (approval) => {
    statuses.push(approval.status);
  });
  await expect(
    ctx.approvals.decide({
      approvalId: a.id,
      userId: a.userId,
      decision: "approve",
      via: "sim_phone",
    }),
  ).rejects.toMatchObject({ code: "approval_invalid" });
  expect(statuses).toEqual(["expired"]);
  expect(await ctx.approvals.expireDue()).toBe(0);
  expect(statuses).toHaveLength(1);
});

it("waits for an in-flight health check and makes shutdown idempotent", async () => {
  const ctx = await setup();
  vi.useFakeTimers();
  let release: () => void = () => {};
  let runtime: Awaited<ReturnType<typeof startRuntime>> | undefined;
  try {
    runtime = await startRuntime(ctx);
    const previous = await ctx.messaging.health();
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    ctx.messaging.health = async () => {
      entered = true;
      await gate;
      return { ...previous, mode: "fallback", healthy: false };
    };
    await vi.advanceTimersByTimeAsync(15000);
    expect(entered).toBe(true);
    const before = ctx.events.history({ judge: true, limit: 200 }).length;
    let stopped = false;
    const stopping = runtime.stop();
    expect(runtime.stop()).toBe(stopping);
    void stopping.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
    expect(ctx.events.history({ judge: true, limit: 200 })).toHaveLength(
      before,
    );
  } finally {
    release();
    await runtime?.stop();
    vi.useRealTimers();
  }
});

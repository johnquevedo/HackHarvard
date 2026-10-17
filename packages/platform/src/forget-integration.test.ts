import { expect, it } from "vitest";
import { MockStructuredLlm } from "../../llm/src/index.ts";
import { shortmeModule } from "../../shortme/src/index.ts";
import { rehearsePurchasing } from "../rehearse-purchasing.ts";
import { createTestPlatform } from "./testing.ts";
import { forgetUser } from "./commands.ts";
import { ingestInbound } from "./pipeline.ts";
import { drainPlatform } from "./foundation.ts";
import type { PlatformContext } from "./context.ts";
async function say(ctx: PlatformContext, id: string, text: string) {
  await ingestInbound(ctx, {
    provider: "sim",
    accountKey: "primary",
    providerMessageId: id,
    providerSpaceId: null,
    providerSenderId: null,
    senderHandle: ctx.config.demoAliceHandle,
    text,
    receivedAt: ctx.clock.nowIso(),
    mode: "simulated",
  });
  await new Promise((resolve) => setImmediate(resolve));
  await drainPlatform(ctx);
}
it("forgets a settled purchaser's private intents while retaining every payment and points audit row", async () => {
  await rehearsePurchasing(async (ctx) => {
    const payments = ctx.db.$client.prepare("SELECT * FROM payment_attempts ORDER BY id").all();
    const ledger = ctx.db.$client.prepare("SELECT * FROM points_ledger ORDER BY id").all();
    const result = await forgetUser(ctx, "usr_demo_alice");
    expect(result.deleted.intents).toBe(1);
    expect(
      ctx.db.$client.prepare("SELECT * FROM intents WHERE user_id='usr_demo_alice'").all(),
    ).toEqual([]);
    expect(
      ctx.db.$client
        .prepare("SELECT intent_id FROM group_purchase_members WHERE user_id='usr_demo_alice'")
        .get(),
    ).toEqual({ intent_id: null });
    expect(ctx.db.$client.prepare("SELECT * FROM payment_attempts ORDER BY id").all()).toEqual(
      payments,
    );
    expect(ctx.db.$client.prepare("SELECT * FROM points_ledger ORDER BY id").all()).toEqual(ledger);
    expect(ctx.db.$client.pragma("foreign_key_check")).toEqual([]);
  });
});
it("detaches a declined ShortMe draft source without deleting the market or points history", async () => {
  const ctx = await createTestPlatform({ llm: new MockStructuredLlm() });
  try {
    await shortmeModule.register(ctx);
    await shortmeModule.seed(ctx);
    await say(
      ctx,
      "draft",
      "just finished my final round interview at a quant firm. i either get the offer or im cooked",
    );
    const before = ctx.db.$client.prepare("SELECT * FROM points_ledger ORDER BY id").all();
    expect((await forgetUser(ctx, "usr_demo_alice")).deleted.intents).toBe(1);
    expect(ctx.db.$client.prepare("SELECT status,source_intent_id FROM markets").get()).toEqual({
      status: "declined",
      source_intent_id: null,
    });
    expect(ctx.db.$client.prepare("SELECT * FROM points_ledger ORDER BY id").all()).toEqual(before);
    expect(ctx.db.$client.pragma("foreign_key_check")).toEqual([]);
  } finally {
    await drainPlatform(ctx);
    ctx.db.$client.close();
  }
});
it("refuses FORGET while the user holds an open market position and preserves consent and stakes", async () => {
  const ctx = await createTestPlatform({ llm: new MockStructuredLlm() });
  try {
    await shortmeModule.register(ctx);
    await shortmeModule.seed(ctx);
    await say(
      ctx,
      "draft",
      "just finished my final round interview at a quant firm. i either get the offer or im cooked",
    );
    await say(ctx, "publish", "YES");
    await say(ctx, "position", "FADE 50");
    const positions = ctx.db.$client.prepare("SELECT * FROM market_positions").all();
    expect(positions).toHaveLength(1);
    await expect(forgetUser(ctx, "usr_demo_alice")).rejects.toMatchObject({
      code: "invalid_state",
    });
    expect(await ctx.consent.has("usr_demo_alice", "messaging_context")).toBe(true);
    expect(ctx.db.$client.prepare("SELECT * FROM market_positions").all()).toEqual(positions);
  } finally {
    await drainPlatform(ctx);
    ctx.db.$client.close();
  }
});

it("rolls back all private-reference cleanup if a later feature cleanup fails", async () => {
  const ctx = await createTestPlatform();
  const { registerPrivacyCleanup } = await import("./privacy.ts");
  try {
    await say(ctx, "before-forget", "private retained on cleanup failure");
    registerPrivacyCleanup(ctx, () => {
      ctx.db.$client.prepare("INSERT INTO kv(key,value) VALUES('cleanup-marker','true')").run();
    });
    registerPrivacyCleanup(ctx, () => {
      throw new Error("Feature cleanup failed");
    });
    await expect(forgetUser(ctx, "usr_demo_alice")).rejects.toThrow("Feature cleanup failed");
    expect(
      ctx.db.$client.prepare("SELECT * FROM kv WHERE key='cleanup-marker'").get(),
    ).toBeUndefined();
    expect(
      ctx.db.$client
        .prepare("SELECT text FROM inbound_messages WHERE provider_message_id='before-forget'")
        .get(),
    ).toEqual({ text: "private retained on cleanup failure" });
  } finally {
    await drainPlatform(ctx);
    ctx.db.$client.close();
  }
});

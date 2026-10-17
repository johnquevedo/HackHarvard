import { afterEach, expect, it } from "vitest";
import { ConsentScope } from "@dennis/contracts";
import { SimMessagingProvider } from "@dennis/messaging";
import type { PlatformContext } from "./context.ts";
import { createTestPlatform } from "./testing.ts";
import { drainPlatform } from "./foundation.ts";
import { ingestInbound } from "./pipeline.ts";
import { dispatchOutbox } from "./runtime.ts";
import { rows } from "./storage.ts";
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
async function text(ctx: PlatformContext, id: string, body: string) {
  const result = await ingestInbound(ctx, {
    provider: "sim",
    accountKey: "primary",
    providerMessageId: id,
    providerSpaceId: null,
    providerSenderId: null,
    senderHandle: ctx.config.demoAliceHandle,
    text: body,
    receivedAt: ctx.clock.nowIso(),
    mode: "simulated",
  });
  await drainPlatform(ctx);
  await dispatchOutbox(ctx);
  return result;
}
it("walks STOP, hi, onboarding, AGREE and optional scopes without storing unconsented text", async () => {
  const ctx = await setup();
  await text(ctx, "stop", "STOP");
  expect((await text(ctx, "hi", "hi")).outcome).toBe("ignored");
  const sent = (ctx.messaging as SimMessagingProvider).sent;
  expect(sent.at(-1)?.text).toContain("Reply AGREE");
  const count = sent.length;
  await text(ctx, "hi-again", "private unconsented message");
  expect(sent).toHaveLength(count);
  expect((await text(ctx, "agree", "AGREE")).outcome).toBe("command");
  expect(await ctx.consent.has("usr_demo_alice", "messaging_context")).toBe(true);
  expect(await ctx.consent.has("usr_demo_alice", "purchase_matching")).toBe(true);
  expect(await ctx.consent.has("usr_demo_alice", "shortme_free_play")).toBe(false);
  expect(await ctx.consent.has("usr_demo_alice", "sandbox_payments")).toBe(false);
  await text(ctx, "shortme", "AGREE SHORTME");
  expect(sent.at(-1)?.text).toContain("18 or older");
  await text(ctx, "payments", "AGREE PAYMENTS");
  for (const scope of ConsentScope.options)
    expect(await ctx.consent.has("usr_demo_alice", scope)).toBe(true);
  const stored = rows<{ providerMessageId: string; text: string | null }>(
    ctx.db,
    "SELECT provider_message_id,text FROM inbound_messages",
  );
  expect(
    stored
      .filter((m) => ["hi", "hi-again", "agree"].includes(m.providerMessageId))
      .every((m) => m.text === null),
  ).toBe(true);
  const before = rows(ctx.db, "SELECT * FROM consents");
  expect((await text(ctx, "payments", "AGREE PAYMENTS")).outcome).toBe("replay");
  expect(rows(ctx.db, "SELECT * FROM consents")).toEqual(before);
});
it("keeps consent history append-only and PAUSE/RESUME separate from STOP", async () => {
  const ctx = await setup();
  const before = rows<{ id: number }>(ctx.db, "SELECT * FROM consents ORDER BY id");
  await text(ctx, "pause", "PAUSE");
  expect((await ctx.users.getAgent("agt_demo_alice"))?.status).toBe("paused");
  for (const scope of ConsentScope.options)
    expect(await ctx.consent.has("usr_demo_alice", scope)).toBe(true);
  expect((await text(ctx, "paused-plan", "I want a monitor")).outcome).toBe("ignored");
  await text(ctx, "resume", "RESUME");
  expect((await ctx.users.getAgent("agt_demo_alice"))?.status).toBe("active");
  await text(ctx, "stop", "STOP");
  await text(ctx, "resume-without-consent", "RESUME");
  for (const scope of ConsentScope.options)
    expect(await ctx.consent.has("usr_demo_alice", scope)).toBe(false);
  expect((await text(ctx, "still-blocked", "I want a monitor")).outcome).toBe("ignored");
  const after = rows(ctx.db, "SELECT * FROM consents ORDER BY id");
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after.length).toBe(before.length + ConsentScope.options.length);
});

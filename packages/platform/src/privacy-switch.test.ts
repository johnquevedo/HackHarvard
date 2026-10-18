import { afterEach, expect, it } from "vitest";
import type { InboundMessageT } from "@dennis/contracts";
import type { SimMessagingProvider } from "@dennis/messaging";
import type { PlatformContext } from "./context.ts";
import { ingestInbound, runPipeline } from "./pipeline.ts";
import { dispatchOutbox } from "./runtime.ts";
import { rows } from "./storage.ts";
import { createTestPlatform } from "./testing.ts";

const contexts: PlatformContext[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) ctx.db.$client.close();
});

async function setup() {
  const ctx = await createTestPlatform({
    config: { photonAgentUserId: "pho_usr_agent", photonSpaceMode: "group" },
  });
  contexts.push(ctx);
  return ctx;
}

let seq = 0;
function direct(ctx: PlatformContext, who: "alice" | "bob", text: string, id?: string) {
  return {
    provider: "sim",
    accountKey: "primary",
    providerMessageId: id ?? "pv_" + seq++,
    providerSpaceId: null,
    providerSenderId: null,
    senderHandle: who === "alice" ? ctx.config.demoAliceHandle : ctx.config.demoBobHandle,
    text,
    receivedAt: ctx.clock.nowIso(),
    mode: "simulated",
  } satisfies InboundMessageT;
}

function group(ctx: PlatformContext, who: "alice" | "bob", text: string): InboundMessageT {
  return {
    provider: "photon",
    accountKey: "primary",
    providerMessageId: "pg_" + seq++,
    providerSpaceId: "pho_spc_privacy",
    providerSpaceKind: "group",
    providerParticipantIds: ["pho_usr_agent", "pho_usr_alice", "pho_usr_bob"],
    providerParticipantHandles: [ctx.config.demoAliceHandle, ctx.config.demoBobHandle],
    providerSenderId: "pho_usr_" + who,
    senderHandle: who === "alice" ? ctx.config.demoAliceHandle : ctx.config.demoBobHandle,
    text,
    receivedAt: ctx.clock.nowIso(),
    mode: "live",
  };
}

async function send(ctx: PlatformContext, msg: InboundMessageT) {
  const result = await ingestInbound(ctx, msg);
  if (result.outcome === "queued" && result.messageId) await runPipeline(ctx, result.messageId);
  return result;
}

const MONITOR =
  "I'm thinking about getting a new 27 inch 4K monitor for my setup, maybe $350 or under.";

function snapshot(ctx: PlatformContext) {
  return {
    texts: rows<{ text: string }>(
      ctx.db,
      "SELECT text FROM inbound_messages WHERE text IS NOT NULL ORDER BY received_at,id",
    ).map((r) => r.text),
    intents: rows(ctx.db, "SELECT id FROM intents").length,
    approvals: rows(ctx.db, "SELECT id FROM approvals").length,
    markets: rows(ctx.db, "SELECT id FROM markets").length,
  };
}

function sentTexts(ctx: PlatformContext): string[] {
  return (ctx.messaging as SimMessagingProvider).sent.map((s) => s.text);
}

it("stores and processes nothing while off, then resumes exactly where it left off", async () => {
  const ctx = await setup();
  await send(ctx, direct(ctx, "alice", "hi there"));
  const before = snapshot(ctx);

  expect((await send(ctx, direct(ctx, "alice", "ok dennis off for a bit"))).outcome).toBe(
    "ignored",
  );
  for (const text of [MONITOR, "my ssn is secret", "yes", "dennis are you there"]) {
    expect((await send(ctx, direct(ctx, "alice", text))).outcome).toBe("ignored");
  }
  const off = rows<{ text: string | null; userId: string | null; ignoreReason: string }>(
    ctx.db,
    "SELECT text,user_id,ignore_reason FROM inbound_messages WHERE ignore_reason='privacy_off'",
  );
  expect(off.length).toBe(5);
  expect(off.every((r) => r.text === null && r.userId === null)).toBe(true);
  expect(snapshot(ctx)).toEqual(before);

  expect((await send(ctx, direct(ctx, "alice", "dennis on"))).outcome).toBe("ignored");
  expect(snapshot(ctx)).toEqual(before); // nothing lost, nothing gained

  await send(ctx, direct(ctx, "alice", MONITOR));
  expect(snapshot(ctx).texts).toEqual([...before.texts, MONITOR]);
});

it("holds outbound messages for that conversation while off and releases them on", async () => {
  const ctx = await setup();
  await send(ctx, direct(ctx, "alice", "dennis off"));
  await dispatchOutbox(ctx);
  const acked = sentTexts(ctx).length; // the off acknowledgement still goes out
  await ctx.notifier.send({
    userId: "usr_demo_alice",
    kind: "info",
    text: "a reply that was already on its way",
    idempotencyKey: "held-1",
  });
  await dispatchOutbox(ctx);
  expect(sentTexts(ctx)).toHaveLength(acked);
  expect(
    rows<{ status: string; attempts: number }>(
      ctx.db,
      "SELECT status,attempts FROM outbox WHERE idempotency_key='held-1'",
    ),
  ).toEqual([{ status: "queued", attempts: 0 }]);

  await send(ctx, direct(ctx, "alice", "dennis on"));
  await dispatchOutbox(ctx);
  expect(sentTexts(ctx)).toContain("a reply that was already on its way");
});

it("matches the exact characters only and leaves other conversations alone", async () => {
  const ctx = await setup();
  expect((await send(ctx, direct(ctx, "alice", "Dennis off"))).outcome).not.toBe("ignored");
  expect((await send(ctx, direct(ctx, "alice", "dennis on"))).outcome).not.toBe("ignored");

  await send(ctx, direct(ctx, "alice", "dennis off"));
  expect((await send(ctx, direct(ctx, "bob", "still here"))).outcome).not.toBe("ignored");
  expect((await send(ctx, direct(ctx, "alice", " Dennis on"))).outcome).toBe("ignored");
  expect((await send(ctx, direct(ctx, "alice", "dennis on pls"))).outcome).toBe("ignored");
  await send(ctx, direct(ctx, "alice", "dennis on"));
  expect((await send(ctx, direct(ctx, "alice", "back to normal"))).outcome).not.toBe("ignored");
});

it("never ingests a message from the off period, even if it is delivered again later", async () => {
  const ctx = await setup();
  await send(ctx, direct(ctx, "alice", "dennis off"));
  await send(ctx, direct(ctx, "alice", "private thing", "replayed_1"));
  await send(ctx, direct(ctx, "alice", "dennis on"));
  expect((await send(ctx, direct(ctx, "alice", "private thing", "replayed_1"))).outcome).toBe(
    "replay",
  );
  expect(snapshot(ctx).texts).not.toContain("private thing");
});

it("in a group, anyone's 'dennis off' covers every member until 'dennis on'", async () => {
  const ctx = await setup();
  await send(ctx, group(ctx, "alice", "planning stuff, dennis off"));
  expect((await send(ctx, group(ctx, "bob", MONITOR))).outcome).toBe("ignored");
  expect(snapshot(ctx).texts).toEqual([]);
  await send(ctx, group(ctx, "bob", "dennis on"));
  expect((await send(ctx, group(ctx, "bob", "ok normal again"))).outcome).not.toBe("ignored");
});

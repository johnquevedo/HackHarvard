import { afterEach, expect, it } from "vitest";
import type { InboundMessageT } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { ingestInbound, runPipeline } from "./pipeline.ts";
import { flushConversationalReplies } from "./conversation.ts";
import { row } from "./storage.ts";
import { createTestPlatform } from "./testing.ts";
import type { StructuredLlm, StructuredRequest } from "@dennis/contracts";

const contexts: PlatformContext[] = [];

afterEach(() => {
  for (const ctx of contexts.splice(0)) ctx.db.$client.close();
});

async function setup() {
  const ctx = await createTestPlatform({
    config: {
      photonAgentUserId: "pho_usr_agent",
      photonSpaceMode: "group",
    },
  });
  contexts.push(ctx);
  return ctx;
}

function groupInbound(
  ctx: PlatformContext,
  id: string,
  text = "I want a monitor",
): InboundMessageT {
  return {
    provider: "photon",
    accountKey: "primary",
    providerMessageId: id,
    providerSpaceId: "pho_spc_group",
    providerSpaceKind: "group",
    providerParticipantIds: ["pho_usr_agent", "pho_usr_alice", "pho_usr_bob"],
    providerParticipantHandles: [ctx.config.demoAliceHandle, ctx.config.demoBobHandle],
    providerSenderId: "pho_usr_alice",
    senderHandle: ctx.config.demoAliceHandle,
    text,
    receivedAt: ctx.clock.nowIso(),
    mode: "live",
  };
}

it("accepts a group message only when every human participant is known and consented", async () => {
  const ctx = await setup();
  expect((await ingestInbound(ctx, groupInbound(ctx, "group_ok"))).outcome).toBe("queued");

  await ctx.consent.set({
    userId: "usr_demo_bob",
    scope: "messaging_context",
    granted: false,
    via: "dashboard",
  });
  expect((await ingestInbound(ctx, groupInbound(ctx, "group_denied"))).outcome).toBe("ignored");
  expect(
    row<{ text: string | null; ignoreReason: string }>(
      ctx.db,
      "SELECT text,ignore_reason FROM inbound_messages WHERE provider_message_id=?",
      "group_denied",
    ),
  ).toEqual({ text: null, ignoreReason: "group_member_without_consent" });
});

it("handles consent commands in an authorized shared group", async () => {
  const ctx = await setup();
  expect((await ingestInbound(ctx, groupInbound(ctx, "group_command", "STOP"))).outcome).toBe(
    "command",
  );
  expect(
    row<{ text: string | null; status: string }>(
      ctx.db,
      "SELECT text,status FROM inbound_messages WHERE provider_message_id=?",
      "group_command",
    ),
  ).toEqual({ text: "STOP", status: "command" });
  expect(await ctx.consent.has("usr_demo_alice", "messaging_context")).toBe(false);
});

it("does not answer or retain messages from an unknown group member", async () => {
  const ctx = await setup();
  const sentBefore = "sent" in ctx.messaging ? (ctx.messaging.sent as unknown[]).length : 0;
  expect(
    (
      await ingestInbound(ctx, {
        ...groupInbound(ctx, "group_unknown"),
        senderHandle: "stranger@example.test",
        providerSenderId: "pho_usr_stranger",
        providerParticipantIds: ["pho_usr_agent", "pho_usr_stranger", "pho_usr_bob"],
        providerParticipantHandles: ["stranger@example.test", ctx.config.demoBobHandle],
      })
    ).outcome,
  ).toBe("ignored");
  expect(
    row<{ text: string | null }>(ctx.db, "SELECT text FROM inbound_messages")?.text,
  ).toBeNull();
  const sentAfter = "sent" in ctx.messaging ? (ctx.messaging.sent as unknown[]).length : 0;
  expect(sentAfter).toBe(sentBefore);
});

function planner(reply = "i'm here. what's up?") {
  const calls: StructuredRequest<unknown>[] = [];
  const llm: StructuredLlm = {
    name: "anthropic",
    async generate<T>(request: StructuredRequest<T>) {
      calls.push(request as StructuredRequest<unknown>);
      const value = {
        behavior: "reply",
        reason: "addressed",
        reply,
        addressedMessageIds: [],
      };
      return {
        value: request.schema.parse(value),
        usage: { inputTokens: 1, outputTokens: 1 },
        model: "test",
        provider: "anthropic",
        latencyMs: 1,
        attempts: 1,
      };
    },
    async health() {
      return {
        name: "llm",
        mode: "live",
        healthy: true,
        detail: "test",
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
      } as const;
    },
  };
  return { llm, calls };
}

it("normal mode batches a burst into one grounded group reply with an explicit route", async () => {
  const planned = planner("yeah, i'm here");
  const ctx = await createTestPlatform({
    llm: planned.llm,
    config: {
      conversationMode: "normal",
      photonAgentUserId: "pho_usr_agent",
      photonSpaceMode: "group",
    },
  });
  contexts.push(ctx);
  const messages = [
    {
      ...groupInbound(ctx, "burst_1", "what should we eat?"),
      receivedAt: "2026-10-18T12:00:00.000Z",
    },
    { ...groupInbound(ctx, "burst_2", "tacos"), receivedAt: "2026-10-18T12:00:01.000Z" },
    {
      ...groupInbound(ctx, "burst_3", "dennis what do you think?"),
      receivedAt: "2026-10-18T12:00:02.000Z",
    },
  ];
  for (const message of messages) {
    const result = await ingestInbound(ctx, message);
    await runPipeline(ctx, result.messageId!);
  }
  await flushConversationalReplies(ctx);

  expect(planned.calls).toHaveLength(1);
  expect(planned.calls[0]!.user).toContain("what should we eat?");
  expect(planned.calls[0]!.user).toContain("dennis what do you think?");
  expect(
    row<{ text: string }>(
      ctx.db,
      "SELECT text FROM outbox WHERE idempotency_key LIKE 'conversation-reply:%'",
    )?.text,
  ).toBe("yeah, i'm here");
  const route = row<{ value: string }>(
    ctx.db,
    "SELECT value FROM kv WHERE key LIKE 'outbox-route:%'",
  );
  expect(route?.value).toBe("pho_spc_group");
});

it("normal mode treats bare yes as conversation unless an approval is pending", async () => {
  const planned = planner("yes to what?");
  const ctx = await createTestPlatform({
    llm: planned.llm,
    config: {
      conversationMode: "normal",
      photonAgentUserId: "pho_usr_agent",
      photonSpaceMode: "group",
    },
  });
  contexts.push(ctx);
  const ordinary = await ingestInbound(ctx, groupInbound(ctx, "ordinary_yes", "yes"));
  expect(ordinary.outcome).toBe("queued");
  await runPipeline(ctx, ordinary.messageId!);
  await flushConversationalReplies(ctx);
  expect(planned.calls).toHaveLength(1);

  await ctx.approvals.request({
    kind: "join_group_purchase",
    userId: "usr_demo_alice",
    agentId: "agt_demo_alice",
    payload: { groupId: "grp_test" },
    promptText: "join? {code}",
    ttlMinutes: 10,
    idempotencyKey: "normal-approval",
  });
  const approval = await ingestInbound(ctx, groupInbound(ctx, "approval_yes", "yes"));
  expect(approval.outcome).toBe("command");
  expect(
    row<{ status: string }>(
      ctx.db,
      "SELECT status FROM approvals WHERE idempotency_key=?",
      "normal-approval",
    )?.status,
  ).toBe("approved");
});

import { afterEach, expect, it, vi } from "vitest";
import type { InboundMessageT, StructuredLlm, StructuredRequest } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { ingestInbound } from "./pipeline.ts";
import { settlePlanning } from "./planning.ts";
import { rows } from "./storage.ts";
import { createTestPlatform } from "./testing.ts";

const contexts: PlatformContext[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const ctx of contexts.splice(0)) ctx.db.$client.close();
});

const PLAN = {
  isPlan: true,
  kind: "trip",
  title: "nyc weekend",
  details: "bus down friday, back sunday",
  people: ["alice", "bob"],
  when: "next weekend",
  where: "nyc",
  budget: "cheap",
  researchQuestions: ["cheapest bus boston to nyc friday"],
  confidence: 0.9,
};

function fakeLlm(opts: { isPlan: boolean; researchFails?: boolean }) {
  const calls: { task: string; user: string }[] = [];
  const llm: StructuredLlm = {
    name: "anthropic",
    async generate<T>(req: StructuredRequest<T>) {
      calls.push({ task: req.task, user: req.user });
      const values: Record<string, unknown> = {
        plan_detector_v1: { ...PLAN, isPlan: opts.isPlan },
        plan_mom_text_v1: { text: "ok team, nyc weekend is happening. • bus friday ~$25 each" },
        conversation_planner_v1: {
          behavior: "silent",
          reason: "ambient",
          reply: null,
          addressedMessageIds: [],
        },
      };
      if (!(req.task in values)) throw new Error("unexpected task " + req.task);
      return {
        value: req.schema.parse(values[req.task]),
        usage: { inputTokens: 0, outputTokens: 0 },
        model: "fake",
        provider: "anthropic" as const,
        latencyMs: 0,
        attempts: 1,
      };
    },
    async research() {
      calls.push({ task: "plan_research_v1", user: "" });
      if (opts.researchFails) throw new Error("search unavailable");
      return {
        text: "• megabus friday 5pm $25",
        sources: [{ title: "megabus", url: "https://example.test/megabus" }],
        searched: true,
        model: "fake",
        latencyMs: 1,
      };
    },
    async health() {
      const now = new Date().toISOString();
      return {
        name: "llm" as const,
        mode: "live" as const,
        healthy: true,
        detail: "fake",
        lastCheckedAt: now,
        lastSuccessAt: now,
      };
    },
  };
  return { llm, calls };
}

async function setup(llm: StructuredLlm) {
  const ctx = await createTestPlatform({
    llm,
    config: {
      planningQuietMs: 1000,
      photonAgentUserId: "pho_usr_agent",
      photonSpaceMode: "group",
    },
  });
  contexts.push(ctx);
  return ctx;
}

let seq = 0;
async function say(ctx: PlatformContext, who: "alice" | "bob", text: string) {
  const handle = who === "alice" ? ctx.config.demoAliceHandle : ctx.config.demoBobHandle;
  const msg: InboundMessageT = {
    provider: "photon",
    accountKey: "primary",
    providerMessageId: "plan_" + seq++,
    providerSpaceId: "pho_spc_plans",
    providerSpaceKind: "group",
    providerParticipantIds: ["pho_usr_agent", "pho_usr_alice", "pho_usr_bob"],
    providerParticipantHandles: [ctx.config.demoAliceHandle, ctx.config.demoBobHandle],
    providerSenderId: "pho_usr_" + who,
    senderHandle: handle,
    text,
    receivedAt: new Date(Date.UTC(2026, 9, 18, 3, 0, seq)).toISOString(),
    mode: "live",
  };
  await ingestInbound(ctx, msg);
  // The pipeline runs in a microtask; let it finish so the message is processed.
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

function planTexts(ctx: PlatformContext): string[] {
  return rows<{ text: string }>(
    ctx.db,
    "SELECT o.text FROM outbox o JOIN kv k ON k.key='outbox-route:' || o.id WHERE json_extract(k.value,'$')='pho_spc_plans' AND o.idempotency_key LIKE 'plan:%'",
  ).map((r) => r.text);
}

async function quiet(ctx: PlatformContext, ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await settlePlanning(ctx);
}

it("waits for the chat to go quiet, researches, and sends one mom text to the group", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { llm, calls } = fakeLlm({ isPlan: true });
  const ctx = await setup(llm);
  await say(ctx, "alice", "we should do nyc next weekend");
  await say(ctx, "bob", "down, bus friday?");
  await quiet(ctx, 600);
  await say(ctx, "alice", "yeah cheap pls, back sunday");
  await quiet(ctx, 600);
  expect(planTexts(ctx)).toEqual([]); // the last message restarted the quiet timer
  await quiet(ctx, 600);
  expect(planTexts(ctx)).toEqual(["ok team, nyc weekend is happening. • bus friday ~$25 each"]);
  const compose = calls.find((c) => c.task === "plan_mom_text_v1")!;
  expect(compose.user).toContain('source="live web search"');
  expect(compose.user).toContain("megabus friday 5pm $25");

  // Nothing new since the plan: another quiet period sends nothing more.
  await quiet(ctx, 2000);
  expect(planTexts(ctx)).toHaveLength(1);
});

it("stays silent when the chat is not a plan", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { llm, calls } = fakeLlm({ isPlan: false });
  const ctx = await setup(llm);
  await say(ctx, "alice", "lol");
  await say(ctx, "bob", "that's crazy");
  await say(ctx, "alice", "anyway");
  await quiet(ctx, 1500);
  expect(planTexts(ctx)).toEqual([]);
  expect(calls.some((c) => c.task === "plan_research_v1")).toBe(false);
});

it("still sends a plan, marked as estimates, when research fails", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { llm, calls } = fakeLlm({ isPlan: true, researchFails: true });
  const ctx = await setup(llm);
  await say(ctx, "alice", "dinner thursday?");
  await say(ctx, "bob", "yes somewhere cheap");
  await say(ctx, "alice", "7pm works");
  await quiet(ctx, 1500);
  expect(planTexts(ctx)).toHaveLength(1);
  const compose = calls.find((c) => c.task === "plan_mom_text_v1")!;
  expect(compose.user).toContain('source="estimates, no live search"');
});

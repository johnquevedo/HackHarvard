import { afterEach, expect, it } from "vitest";
import type { InboundMessageT } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { DEMO_SCRIPTS } from "./demo-scripts.ts";
import { ingestInbound } from "./pipeline.ts";
import { matchScriptStep, scriptKey } from "./scripted-demo.ts";
import { rows } from "./storage.ts";
import { createTestPlatform } from "./testing.ts";

const contexts: PlatformContext[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) ctx.db.$client.close();
});

async function setup() {
  const ctx = await createTestPlatform({
    config: { demoScript: "hybrid", photonAgentUserId: "pho_usr_agent", photonSpaceMode: "group" },
  });
  contexts.push(ctx);
  return ctx;
}

let seq = 0;
function say(ctx: PlatformContext, space: string, text: string): InboundMessageT {
  return {
    provider: "photon",
    accountKey: "primary",
    providerMessageId: "ds_" + seq++,
    providerSpaceId: space,
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

async function settle() {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
}

function replies(ctx: PlatformContext, space: string): string[] {
  return rows<{ text: string }>(
    ctx.db,
    "SELECT o.text FROM outbox o JOIN kv k ON k.key='outbox-route:' || o.id WHERE json_extract(k.value,'$')=? ORDER BY o.rowid",
    space,
  ).map((r) => r.text);
}

it.each(DEMO_SCRIPTS.map((s) => [s.name, s] as const))(
  "%s: replaying the human lines gets the scripted replies word for word",
  async (_name, script) => {
    const ctx = await setup();
    const space = "pho_spc_" + script.name;
    for (const step of script.steps) {
      const result = await ingestInbound(ctx, say(ctx, space, step.text));
      expect(result.outcome).toBe("command");
      await settle();
    }
    expect(replies(ctx, space)).toEqual(script.steps.flatMap((step) => step.replies));
  },
);

it("matches typed variations: capitals, missing emoji, smart quotes, a pasted name label", () => {
  const now = new Date();
  expect(
    matchScriptStep("Sub 4 hours easy", { name: "marathon", index: 2, at: now.toISOString() }, now)
      ?.index,
  ).toBe(3);
  expect(matchScriptStep("u better not propose with that temu ring", null, now)?.script.name).toBe(
    "proposal",
  );
  expect(
    matchScriptStep("michael: I'm so cooked im failing my meta technical tmr", null, now)?.script
      .name,
  ).toBe("minute");
  expect(matchScriptStep("Guys I signed up for the Boston marathon!!", null, now)?.index).toBe(0);
});

it("tolerates a typo or a dropped word in longer lines, but not a different message", () => {
  const now = new Date();
  expect(
    matchScriptStep("boys i think im gonna propse to my gf next month", null, now)?.script.name,
  ).toBe("proposal");
  expect(matchScriptStep("bro my company just announced layoffs", null, now)).toBeNull();
  const at = { name: "proposal", index: 0, at: now.toISOString() };
  expect(matchScriptStep("BROOOOOO NO WAY", at, now)?.index).toBe(1);
  expect(matchScriptStep("u better not propose with that temu ring lol", at, now)?.index).toBe(2);
  expect(matchScriptStep("my gf is moving to nyc next month", null, now)).toBeNull();
});

it("short generic lines only count as the next line of an active script", () => {
  const now = new Date();
  expect(matchScriptStep("down", null, now)).toBeNull();
  expect(matchScriptStep("yes", null, now)).toBeNull();
  expect(
    matchScriptStep("down", { name: "cancun", index: 2, at: now.toISOString() }, now)?.index,
  ).toBe(3);
  const stale = new Date(now.getTime() - 60 * 60_000).toISOString();
  expect(matchScriptStep("down", { name: "cancun", index: 2, at: stale }, now)).toBeNull();
});

it("leaves every other message to normal Dennis", async () => {
  const ctx = await setup();
  const result = await ingestInbound(
    ctx,
    say(ctx, "pho_spc_other", "anyone know a good pho place"),
  );
  expect(result.outcome).not.toBe("command");
});

it("every distinctive line belongs to exactly one script", () => {
  const seen = new Map<string, string>();
  for (const script of DEMO_SCRIPTS)
    for (const step of script.steps) {
      const key = scriptKey(step.text);
      if (key.length < 18) continue;
      expect(seen.get(key) ?? script.name).toBe(script.name);
      seen.set(key, script.name);
    }
});

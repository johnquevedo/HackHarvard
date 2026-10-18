import { afterEach, expect, it, vi } from "vitest";
import type { InboundMessageT } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { DEMO_SCRIPTS } from "./demo-scripts.ts";
import { ingestInbound } from "./pipeline.ts";
import { castLine, matchScriptStep, scriptKey } from "./scripted-demo.ts";
import { rows } from "./storage.ts";
import { createTestPlatform } from "./testing.ts";

const contexts: PlatformContext[] = [];
afterEach(() => {
  vi.useRealTimers();
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
    // Everything comes from one phone (Alice), so she plays every character; Bob is also in the chat.
    const cast: Record<string, string> = {};
    const expected = script.steps.flatMap((step) => {
      cast[step.speaker] ??= "Alice";
      return step.replies.map((line) => castLine(line, cast, ["Alice", "Bob"]));
    });
    expect(replies(ctx, space)).toEqual(expected);
    expect(replies(ctx, space).join(" ")).not.toMatch(/\b(michael|steven|isaac|john)\b/i);
  },
);

it("names the real sender instead of the script character", async () => {
  const ctx = await setup();
  await ingestInbound(
    ctx,
    say(ctx, "pho_spc_names", "Im so cooked im failing my meta technical tmr"),
  );
  await settle();
  expect(replies(ctx, "pho_spc_names")[0]).toBe(
    "Yo alice why don’t you short yourself, i’ll set up a market. Anyone wanna get in on this?",
  );
});

it("casts other characters from the people in the chat, same names first", () => {
  const cast: Record<string, string> = { michael: "Edward" };
  expect(
    castLine("michael wanna bet? steven and isaac are in", cast, ["Edward", "Isaac", "Ada"]),
  ).toBe("edward wanna bet? ada and isaac are in");
  expect(castLine("who thinks stevens getting cut? ask John", {}, [])).toBe(
    "who thinks bros getting cut? ask Bro",
  );
});

it("starts a script from a differently worded message on its topic", () => {
  const now = new Date();
  expect(
    matchScriptStep("Bro my companies says theres layoffs next week", null, now),
  ).toMatchObject({ index: 0, script: { name: "layoffs" } });
  expect(matchScriptStep("gonna propose to my girlfriend soon guys", null, now)?.script.name).toBe(
    "proposal",
  );
  expect(matchScriptStep("what time does the bus leave", null, now)).toBeNull();
});

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
  expect(matchScriptStep("bro my company just announced layoffs", null, now)?.script.name).toBe(
    "layoffs",
  );
  const at = { name: "proposal", index: 0, at: now.toISOString() };
  expect(matchScriptStep("BROOOOOO NO WAY", at, now)?.index).toBe(1);
  expect(matchScriptStep("u better not propose with that temu ring lol", at, now)?.index).toBe(2);
  expect(matchScriptStep("anyone seen my charger around the apartment", null, now)).toBeNull();
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

it("plays Dennis's next scripted line if the chat goes quiet before the friends' lines", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const ctx = await setup();
  await ingestInbound(
    ctx,
    say(ctx, "pho_spc_nudge", "Bro my companies says theres layoffs next week"),
  );
  await vi.advanceTimersByTimeAsync(29_000);
  expect(replies(ctx, "pho_spc_nudge")).toEqual([]);
  await vi.advanceTimersByTimeAsync(2_000);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  vi.useRealTimers();
  await settle();
  expect(replies(ctx, "pho_spc_nudge")).toEqual([
    "yo lets set up a short market, who thinks alices getting cut?",
  ]);
});

it.each([
  ["im so fried for my midterm tmr", "exam"],
  ["im so fried im failing my meta technical tmrw", "minute"],
  ["my google onsite is tmr and im toast", "minute"],
  ["bruh i just got laid off", "layoffs"],
  ["yall i think im proposing to my girlfriend next month", "proposal"],
  ["boys we gotta do miami for spring break", "cancun"],
  ["running my first half marathon sunday", "marathon"],
  ["its michaels bday next week we should get him something", "gift"],
])("%s starts the %s script", (text, name) => {
  expect(matchScriptStep(text, null, new Date())?.script.name).toBe(name);
});

it("reads slang variants of the next line mid-script", () => {
  const now = new Date();
  const at = { name: "minute", index: 0, at: now.toISOString() };
  expect(matchScriptStep("lmfaooo run it ill put $500", at, now)?.index).toBe(1);
});

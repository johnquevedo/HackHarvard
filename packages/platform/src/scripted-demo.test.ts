import { afterEach, expect, it, vi } from "vitest";
import type { InboundMessageT } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { ingestInbound } from "./pipeline.ts";
import { rows } from "./storage.ts";
import { createTestPlatform } from "./testing.ts";
import { VIDEO_SCRIPT, findScriptedTurn } from "./scripted-demo.ts";

const contexts: PlatformContext[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const ctx of contexts.splice(0)) ctx.db.$client.close();
});

async function setup() {
  const ctx = await createTestPlatform({
    config: {
      demoScript: "video",
      typingMs: 2000,
      photonAgentUserId: "pho_usr_agent",
      photonSpaceMode: "group",
    },
  });
  contexts.push(ctx);
  return ctx;
}

const HANDLES = {
  john: "demoJohnHandle",
  steven: "demoStevenHandle",
  isaac: "demoIsaacHandle",
} as const;

function groupMessage(
  ctx: PlatformContext,
  from: keyof typeof HANDLES,
  id: string,
  text: string,
): InboundMessageT {
  return {
    provider: "photon",
    accountKey: "primary",
    providerMessageId: id,
    providerSpaceId: "pho_spc_video",
    providerSpaceKind: "group",
    providerParticipantIds: ["pho_usr_agent", "pho_usr_john", "pho_usr_steven", "pho_usr_isaac"],
    providerParticipantHandles: Object.values(HANDLES).map((key) => ctx.config[key]),
    providerSenderId: "pho_usr_" + from,
    senderHandle: ctx.config[HANDLES[from]],
    text,
    receivedAt: ctx.clock.nowIso(),
    mode: "live",
  };
}

function groupReplies(ctx: PlatformContext): string[] {
  return rows<{ text: string }>(
    ctx.db,
    "SELECT o.text FROM outbox o JOIN kv k ON k.key='outbox-route:' || o.id WHERE json_extract(k.value,'$')='pho_spc_video' ORDER BY o.rowid",
  ).map((r) => r.text);
}

it("posts exactly the scripted replies, in order, to the group", async () => {
  await import("./runtime.ts"); // sendReplies loads it lazily; warm it so fake timers stay in step
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const ctx = await setup();
  const typing: boolean[] = [];
  Object.assign(ctx.messaging, {
    setTyping: async (_space: string, on: boolean) => void typing.push(on),
  });
  for (const [index, turn] of VIDEO_SCRIPT.entries()) {
    await ingestInbound(ctx, groupMessage(ctx, turn.from, "video_" + index, turn.text));
    await vi.runAllTimersAsync();
    // Let the send and typing-off steps after the last pause finish before the next line.
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  }
  const replies = VIDEO_SCRIPT.flatMap((turn) => turn.replies);
  expect(groupReplies(ctx)).toEqual(replies);
  expect(typing).toEqual(replies.flatMap(() => [true, false]));
  expect(rows(ctx.db, "SELECT id FROM markets")).toHaveLength(0);
  expect(rows(ctx.db, "SELECT id FROM approvals")).toHaveLength(0);
});

it("matches smart or straight apostrophes and ignores everything off script", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const ctx = await setup();
  expect(findScriptedTurn("I'M SO COOKED  im failing my meta technical tmr ")?.from).toBe("john");
  expect(
    findScriptedTurn("Edward Lai:\r\n\ti’m so cooked im failing my meta technical tmr")?.from,
  ).toBe("john");
  expect(findScriptedTurn("isaac: yeah do it")?.from).toBe("isaac");
  const off = await ingestInbound(ctx, groupMessage(ctx, "john", "off", "anyone up for lunch"));
  await vi.runAllTimersAsync();
  expect(off.outcome).toBe("ignored");
  expect(groupReplies(ctx)).toEqual([]);
});

import { afterEach, it, expect } from "vitest";
import { PurchaseCategory, MarketCategory } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { createTestPlatform } from "./testing.ts";
import { drainPlatform } from "./foundation.ts";
import { ingestInbound } from "./pipeline.ts";
import { update } from "./storage.ts";
const contexts: PlatformContext[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    await drainPlatform(ctx);
    ctx.db.$client.close();
  }
});
async function send(ctx: PlatformContext, id: string) {
  await ingestInbound(ctx, {
    provider: "sim",
    accountKey: "primary",
    providerMessageId: id,
    providerSpaceId: null,
    providerSenderId: null,
    senderHandle: ctx.config.demoAliceHandle,
    text: "I want a 27-inch 4K monitor this month.",
    receivedAt: ctx.clock.nowIso(),
    mode: "simulated",
  });
  await drainPlatform(ctx);
}
it("supplies purchase categories so a category-gated detector can create an intent", async () => {
  const ctx = await createTestPlatform();
  contexts.push(ctx);
  const observed: string[][] = [];
  ctx.detectors.register({
    id: "purchase",
    intentKind: "purchase",
    async detect(input) {
      observed.push(input.enabledCategories);
      if (!input.enabledCategories.includes("monitor"))
        return {
          detections: [],
          rejected: [
            { reason: "category_disabled", detail: "Monitor disabled" },
          ],
          llm: null,
        };
      return {
        detections: [
          {
            kind: "purchase",
            confidence: 0.95,
            rationale: "Explicit purchase plan",
            summary: "Monitor purchase",
            privatePayload: {
              productText: "27-inch 4K monitor",
              category: "monitor",
              quantity: 1,
              budgetMaxCents: 35000,
              timeframe: { kind: "this_month", from: null, to: null },
              statedCertainty: "considering",
              sourceExcerpt: input.text,
            },
            publicPayload: {
              category: "monitor",
              productKey: "monitor_27in_4k",
              quantity: 1,
              budgetBandMaxCents: 35000,
              window: { from: "2026-10-17", to: "2026-10-31" },
              regionCode: "boston-cambridge",
            },
          },
        ],
        rejected: [],
        llm: null,
      };
    },
  });
  await send(ctx, "categories-one");
  expect(observed).toEqual([[...PurchaseCategory.options]]);
  expect(await ctx.intents.listByAgent("agt_demo_alice")).toHaveLength(1);
  expect(observed[0]).not.toContain("recruiting");
});
it("scopes milestone categories separately and preserves the feature settings gate", async () => {
  const ctx = await createTestPlatform();
  contexts.push(ctx);
  let purchaseCalls = 0;
  const milestoneCategories: string[][] = [];
  ctx.detectors.register({
    id: "purchase",
    intentKind: "purchase",
    async detect() {
      purchaseCalls++;
      return { detections: [], rejected: [], llm: null };
    },
  });
  ctx.detectors.register({
    id: "milestone",
    intentKind: "milestone",
    async detect(input) {
      milestoneCategories.push(input.enabledCategories);
      return { detections: [], rejected: [], llm: null };
    },
  });
  const agent = await ctx.users.getAgent("agt_demo_alice");
  update(
    ctx.db,
    "agents",
    { settings: { ...agent!.settings, matchingEnabled: false } },
    "id=?",
    agent!.id,
  );
  await send(ctx, "categories-two");
  expect(purchaseCalls).toBe(0);
  expect(milestoneCategories).toEqual([[...MarketCategory.options]]);
  expect(milestoneCategories[0]).not.toContain("monitor");
});

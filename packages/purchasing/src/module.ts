import { Hono } from "hono";

import type { AgentT, IntentT } from "@dennis/contracts";
import { merchantOffers } from "@dennis/db";
import type { FeatureModule, PlatformContext } from "@dennis/platform";

import { purchaseDetector } from "./detector/mock.js";
import { DEMO_MONITOR_OFFER } from "./offers/demo.js";

function isMonitorIntent(intent: IntentT): boolean {
  return intent.kind === "purchase" && intent.publicPayload?.category === "monitor";
}

function stubGroupId(intentIds: string[]): string {
  const suffix = intentIds
    .sort()
    .map((id) => id.replace(/^int_/, "").replace(/[^a-z0-9_]/g, "").slice(-10))
    .join("_")
    .slice(0, 30);
  return `grp_stub_${suffix}`;
}

async function handlePurchaseDetection(
  ctx: PlatformContext,
  input: { intent: IntentT; agent: AgentT },
): Promise<void> {
  if (!input.agent.settings.matchingEnabled) return;
  if (!(await ctx.consent.has(input.agent.userId, "purchase_matching"))) return;

  const shared = await ctx.intents.markShared(input.intent.id);
  ctx.events.emit({
    type: "intent.registered",
    actor: { kind: "agent", agentId: input.agent.id, userId: input.agent.userId },
    visibility: "shared",
    payload: {
      intentId: shared.id,
      agentId: shared.agentId,
      kind: shared.kind,
      publicPayload: shared.publicPayload,
    },
  });

  if (!isMonitorIntent(shared)) return;
  const candidates = await ctx.intents.listShared({ kind: "purchase", excludeAgentId: input.agent.id });
  const candidate = candidates.find(
    (item) => item.publicPayload.category === "monitor" && item.agentId !== input.agent.id,
  );
  if (!candidate) return;

  const groupId = stubGroupId([shared.id, candidate.intentId]);
  await ctx.opportunities.upsert({
    type: "group_purchase",
    domainRefId: groupId,
    status: "proposed",
    headline: "SIMULATED OFFER: two Dennis users may save on a monitor",
    participantAgentIds: [input.agent.id, candidate.agentId].sort(),
  });
}

export const purchasingModule: FeatureModule = {
  name: "purchasing",
  async register(ctx) {
    ctx.detectors.register(purchaseDetector);
    ctx.detectors.onDetection("purchase", (input) => handlePurchaseDetection(ctx, input));
  },
  routes() {
    return new Hono();
  },
  async seed(ctx) {
    await ctx.db
      .insert(merchantOffers)
      .values(DEMO_MONITOR_OFFER)
      .onConflictDoUpdate({
        target: merchantOffers.id,
        set: {
          merchantName: DEMO_MONITOR_OFFER.merchantName,
          productKey: DEMO_MONITOR_OFFER.productKey,
          title: DEMO_MONITOR_OFFER.title,
          unitPriceCents: DEMO_MONITOR_OFFER.unitPriceCents,
          tiers: [...DEMO_MONITOR_OFFER.tiers],
          isSimulated: DEMO_MONITOR_OFFER.isSimulated,
          sourceLabel: DEMO_MONITOR_OFFER.sourceLabel,
          validUntil: DEMO_MONITOR_OFFER.validUntil,
        },
      });
  },
  async reset() {},
  async recover() {},
};

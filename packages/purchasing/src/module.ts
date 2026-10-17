import { PurchaseIntentPublic, type A2AMessage, type AgentT, type IntentT } from "@dennis/contracts";
import { merchantOffers } from "@dennis/db";
import type { FeatureModule, PlatformContext } from "@dennis/platform";
import { Hono } from "hono";

import { purchaseDetector } from "./detector/purchase.js";
import { isCompatible } from "./matching/matcher.js";
import { matchingRules } from "./matching/rules.js";
import { DEMO_MONITOR_OFFER } from "./offers/demo.js";

const PROBE_REASON_BY_RULE: Record<string, string> = {
  budget_overlap: "budget_overlap",
  window_overlap: "window_overlap",
  product_match: "product_match",
  region_match: "region_match",
  matching_enabled: "matching_disabled",
  already_matched: "already_matched",
};

function stubGroupId(intentIds: string[]): string {
  const suffix = intentIds
    .sort()
    .map((id) => id.replace(/^int_/, "").replace(/[^a-z0-9_]/g, "").slice(-10))
    .join("_")
    .slice(0, 30);
  return `grp_stub_${suffix}`;
}

async function sendCandidateProbes(ctx: PlatformContext, intent: IntentT): Promise<void> {
  if (!intent.publicPayload) return;
  const publicIntent = PurchaseIntentPublic.parse(intent.publicPayload);
  const candidates = await ctx.intents.listShared({ kind: "purchase", excludeAgentId: intent.agentId });
  for (const candidate of candidates) {
    await ctx.a2a.send({
      type: "purchase.probe",
      fromAgentId: intent.agentId,
      toAgentId: candidate.agentId,
      conversationId: `cnv_${intent.id}`,
      payload: { intentRef: intent.id, publicIntent, leadAgentId: intent.agentId },
      idempotencyKey: `purchase:probe:${intent.id}:${candidate.intentId}`,
    });
  }
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
  await sendCandidateProbes(ctx, shared);
}

async function handleProbe(ctx: PlatformContext, msg: A2AMessage): Promise<void> {
  const intentRef = typeof msg.payload.intentRef === "string" ? msg.payload.intentRef : null;
  const leadAgentId = typeof msg.payload.leadAgentId === "string" ? msg.payload.leadAgentId : null;
  const leadPublic = PurchaseIntentPublic.parse(msg.payload.publicIntent);
  if (!intentRef || !leadAgentId || leadAgentId !== msg.fromAgentId) {
    throw new Error("Invalid purchase.probe payload");
  }

  const candidateAgent = await ctx.users.getAgent(msg.toAgentId);
  const matchingEnabled =
    candidateAgent?.status === "active" &&
    candidateAgent.settings.matchingEnabled &&
    (await ctx.consent.has(candidateAgent.userId, "purchase_matching"));
  const ownIntents = await ctx.intents.listByAgent(msg.toAgentId, { kind: "purchase", status: "shared" });
  const own = ownIntents.at(-1);
  let checks;
  if (!matchingEnabled) {
    checks = [{ rule: "matching_enabled", passed: false, detail: "Candidate matching is disabled" }];
  } else if (!own?.publicPayload) {
    checks = [{ rule: "already_matched", passed: false, detail: "No active shared candidate intent" }];
  } else {
    checks = isCompatible(leadPublic, PurchaseIntentPublic.parse(own.publicPayload), matchingRules).checks;
  }
  const compatible = checks.every((check) => check.passed);
  const reasons = compatible
    ? ["budget_overlap", "window_overlap", "product_match", "region_match"]
    : checks.filter((check) => !check.passed).map((check) => PROBE_REASON_BY_RULE[check.rule] ?? "already_matched");

  ctx.events.emit({
    type: "purchase.match.evaluated",
    actor: { kind: "agent", agentId: msg.toAgentId },
    visibility: "shared",
    payload: {
      conversationId: msg.conversationId,
      aAgentId: msg.fromAgentId,
      bAgentId: msg.toAgentId,
      compatible,
      checks,
    },
  });
  await ctx.a2a.send({
    type: "purchase.probe_result",
    fromAgentId: msg.toAgentId,
    toAgentId: msg.fromAgentId,
    conversationId: msg.conversationId,
    payload: { intentRef, compatible, reasons },
    idempotencyKey: `purchase:probe-result:${msg.id}`,
  });
}

async function handleProbeResult(ctx: PlatformContext, msg: A2AMessage): Promise<void> {
  if (msg.payload.compatible !== true) return;
  const intentRef = typeof msg.payload.intentRef === "string" ? msg.payload.intentRef : null;
  if (!intentRef) throw new Error("Invalid purchase.probe_result payload");
  const groupId = stubGroupId([intentRef, msg.fromAgentId]);
  await ctx.opportunities.upsert({
    type: "group_purchase",
    domainRefId: groupId,
    status: "proposed",
    headline: "SIMULATED OFFER: two Dennis users may save on a monitor",
    participantAgentIds: [msg.fromAgentId, msg.toAgentId].sort(),
  });
}

export const purchasingModule: FeatureModule = {
  name: "purchasing",
  async register(ctx) {
    ctx.detectors.register(purchaseDetector);
    ctx.detectors.onDetection("purchase", (input) => handlePurchaseDetection(ctx, input));
    ctx.a2a.on("purchase.probe", (msg) => handleProbe(ctx, msg));
    ctx.a2a.on("purchase.probe_result", (msg) => handleProbeResult(ctx, msg));
  },
  routes() {
    return new Hono();
  },
  async seed(ctx) {
    ctx.db
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
      })
      .run();
  },
  async reset() {},
  async recover() {},
};

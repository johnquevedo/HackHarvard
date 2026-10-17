import {
  PurchaseIntentPublic,
  DennisError,
  type A2AMessage,
  type AgentT,
  type IntentT,
} from "@dennis/contracts";
import { merchantOffers, groupPurchaseMembers, groupPurchases } from "@dennis/db";
import { registerPrivacyCleanup } from "@dennis/platform";
import { eq, inArray, and } from "drizzle-orm";
import type { FeatureModule, PlatformContext } from "@dennis/platform";

import { purchaseDetector } from "./detector/purchase.js";
import {
  createGroupFromCompatibleProbe,
  handleJoinDecision,
  handleProposal,
  handleProposalResult,
  handlePurchaseConsentRevoked,
} from "./groups/service.js";
import { isCompatible } from "./matching/matcher.js";
import { matchingRules } from "./matching/rules.js";
import { DEMO_MONITOR_OFFER } from "./offers/demo.js";
import { handlePaymentDecision, recoverSubmittingPayments } from "./payments/index.js";
import { purchasingRoutes } from "./routes.js";
import { seedBank } from "./bank/seed.js";

const PROBE_REASON_BY_RULE: Record<string, string> = {
  budget_overlap: "budget_overlap",
  window_overlap: "window_overlap",
  product_match: "product_match",
  region_match: "region_match",
  matching_enabled: "matching_disabled",
  already_matched: "already_matched",
};

async function sendCandidateProbes(ctx: PlatformContext, intent: IntentT): Promise<void> {
  if (!intent.publicPayload) return;
  const publicIntent = PurchaseIntentPublic.parse(intent.publicPayload);
  const candidates = await ctx.intents.listShared({
    kind: "purchase",
    excludeAgentId: intent.agentId,
  });
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
  const ownIntents = await ctx.intents.listByAgent(msg.toAgentId, {
    kind: "purchase",
    status: "shared",
  });
  const own = ownIntents.at(-1);
  let checks;
  if (!matchingEnabled) {
    checks = [
      { rule: "matching_enabled", passed: false, detail: "Candidate matching is disabled" },
    ];
  } else if (!own?.publicPayload) {
    checks = [
      { rule: "already_matched", passed: false, detail: "No active shared candidate intent" },
    ];
  } else {
    checks = isCompatible(
      leadPublic,
      PurchaseIntentPublic.parse(own.publicPayload),
      matchingRules,
    ).checks;
  }
  const compatible = checks.every((check) => check.passed);
  const reasons = compatible
    ? ["budget_overlap", "window_overlap", "product_match", "region_match"]
    : checks
        .filter((check) => !check.passed)
        .map((check) => PROBE_REASON_BY_RULE[check.rule] ?? "already_matched");

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
  await createGroupFromCompatibleProbe(ctx, msg);
}

export const purchasingModule: FeatureModule = {
  name: "purchasing",
  async register(ctx) {
    registerPrivacyCleanup(ctx, (userId) => {
      const memberships = ctx.db
        .select()
        .from(groupPurchaseMembers)
        .where(eq(groupPurchaseMembers.userId, userId))
        .all();
      if (
        memberships.length &&
        ctx.db
          .select()
          .from(groupPurchases)
          .where(
            and(
              inArray(
                groupPurchases.id,
                memberships.map((m) => m.groupId),
              ),
              inArray(groupPurchases.status, ["settling"]),
            ),
          )
          .get()
      )
        throw new DennisError(
          "invalid_state",
          "Wait for in-flight settlement before forgetting",
          409,
        );
      ctx.db
        .update(groupPurchaseMembers)
        .set({ intentId: null })
        .where(eq(groupPurchaseMembers.userId, userId))
        .run();
    });
    ctx.detectors.register(purchaseDetector);
    ctx.detectors.onDetection("purchase", (input) => handlePurchaseDetection(ctx, input));
    ctx.a2a.on("purchase.probe", (msg) => handleProbe(ctx, msg));
    ctx.a2a.on("purchase.probe_result", (msg) => handleProbeResult(ctx, msg));
    ctx.a2a.on("purchase.proposal", (msg) => handleProposal(ctx, msg));
    ctx.a2a.on("purchase.proposal_result", (msg) => handleProposalResult(ctx, msg));
    ctx.approvals.onDecided("join_group_purchase", (approval) => handleJoinDecision(ctx, approval));
    ctx.approvals.onDecided("authorize_payment", (approval) =>
      handlePaymentDecision(ctx, approval),
    );
    ctx.consent.onRevoked((userId, scope) => handlePurchaseConsentRevoked(ctx, userId, scope));
  },
  routes(ctx) {
    return purchasingRoutes(ctx);
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
    await seedBank(ctx);
  },
  async reset() {},
  async recover(ctx) {
    await recoverSubmittingPayments(ctx);
  },
};

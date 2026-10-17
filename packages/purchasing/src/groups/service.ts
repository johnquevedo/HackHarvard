import {
  PurchaseIntentPrivate,
  type A2AMessage,
  type ApprovalT,
  type MerchantOfferT,
} from "@dennis/contracts";
import {
  bankLinks,
  groupPurchaseMembers,
  groupPurchases,
  merchantOffers,
} from "@dennis/db";
import type { PlatformContext } from "@dennis/platform";
import { and, eq, inArray } from "drizzle-orm";

import { authorizePaymentCopy, joinGroupCopy } from "../copy.js";
import { matchingRules } from "../matching/rules.js";
import { evaluateProposal, priceGroup } from "../offers/pricing.js";
import { transitionGroup, type GroupStatus } from "./state-machine.js";

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${field}`);
  return value;
}

function groupRow(ctx: PlatformContext, groupId: string) {
  return ctx.db.select().from(groupPurchases).where(eq(groupPurchases.id, groupId)).get();
}

function memberRows(ctx: PlatformContext, groupId: string) {
  return ctx.db
    .select()
    .from(groupPurchaseMembers)
    .where(eq(groupPurchaseMembers.groupId, groupId))
    .all();
}

function offerRow(ctx: PlatformContext, offerId: string) {
  return ctx.db.select().from(merchantOffers).where(eq(merchantOffers.id, offerId)).get();
}

async function emitGroupUpdated(ctx: PlatformContext, groupId: string): Promise<void> {
  const group = groupRow(ctx, groupId);
  if (!group) throw new Error(`Unknown group ${groupId}`);
  const members = memberRows(ctx, groupId);
  ctx.events.emit({
    type: "purchase.group.updated",
    actor: { kind: "agent", agentId: group.leadAgentId },
    visibility: "shared",
    opportunityId: group.opportunityId,
    payload: {
      groupId,
      status: group.status,
      members: members.map((member) => ({
        agentId: member.agentId,
        join: member.joinState,
        pay: member.payState,
      })),
      savingsPerMemberCents: group.savingsPerMemberCents,
    },
  });
  await ctx.opportunities.upsert({
    type: "group_purchase",
    domainRefId: group.id,
    status: group.status,
    headline: `SIMULATED OFFER: ${group.productKey} group purchase`,
    participantAgentIds: members.map((member) => member.agentId),
  });
}

function setGroupStatus(ctx: PlatformContext, groupId: string, status: GroupStatus, failureReason?: string): void {
  ctx.db
    .update(groupPurchases)
    .set({ status, failureReason: failureReason ?? null, updatedAt: ctx.clock.nowIso() })
    .where(eq(groupPurchases.id, groupId))
    .run();
}

export async function createGroupFromCompatibleProbe(
  ctx: PlatformContext,
  msg: A2AMessage,
): Promise<void> {
  if (msg.payload.compatible !== true) return;
  const leadIntentId = requiredString(msg.payload.intentRef, "intentRef");
  const leadIntent = await ctx.intents.get(leadIntentId);
  if (!leadIntent || !leadIntent.privatePayload) throw new Error("Lead purchase intent not found");
  const candidateIntents = await ctx.intents.listByAgent(msg.fromAgentId, {
    kind: "purchase",
    status: "shared",
  });
  const candidateIntent = candidateIntents.at(-1);
  if (!candidateIntent) throw new Error("Candidate purchase intent not found");
  const offer = offerRow(ctx, DEMO_OFFER_ID);
  if (!offer || !offer.isSimulated) throw new Error("Required simulated offer is missing");
  const price = priceGroup(offer as MerchantOfferT, 2);
  if (!price) throw new Error("No two-member offer tier exists");
  const leadEvaluation = evaluateProposal(
    { groupUnitCents: price.groupUnitCents, savingsPerMemberCents: price.savingsPerMemberCents },
    PurchaseIntentPrivate.parse(leadIntent.privatePayload),
    matchingRules,
  );
  if (!leadEvaluation.accept) return;

  const groupId = ctx.ids.next("group");
  const opportunity = await ctx.opportunities.upsert({
    type: "group_purchase",
    domainRefId: groupId,
    status: "proposed",
    headline: "SIMULATED OFFER: two Dennis users may save on a monitor",
    participantAgentIds: [msg.fromAgentId, msg.toAgentId].sort(),
  });
  ctx.db.transaction((tx) => {
    tx.insert(groupPurchases)
      .values({
        id: groupId,
        opportunityId: opportunity.id,
        offerId: offer.id,
        productKey: offer.productKey,
        leadAgentId: msg.toAgentId,
        status: "proposed",
        individualPriceCents: price.individualCents,
        groupUnitPriceCents: price.groupUnitCents,
        quantityPerMember: 1,
        savingsPerMemberCents: price.savingsPerMemberCents,
        poolAccountRef: null,
        failureReason: null,
        createdAt: ctx.clock.nowIso(),
        updatedAt: ctx.clock.nowIso(),
      })
      .run();
    tx.insert(groupPurchaseMembers)
      .values([
        {
          groupId,
          agentId: leadIntent.agentId,
          userId: leadIntent.userId,
          intentId: leadIntent.id,
          shareCents: price.groupUnitCents,
          joinState: "pending",
          joinApprovalId: null,
          payState: "none",
          payApprovalId: null,
        },
        {
          groupId,
          agentId: candidateIntent.agentId,
          userId: candidateIntent.userId,
          intentId: candidateIntent.id,
          shareCents: price.groupUnitCents,
          joinState: "pending",
          joinApprovalId: null,
          payState: "none",
          payApprovalId: null,
        },
      ])
      .run();
  });
  await emitGroupUpdated(ctx, groupId);
  await ctx.a2a.send({
    type: "purchase.proposal",
    fromAgentId: msg.toAgentId,
    toAgentId: msg.fromAgentId,
    conversationId: msg.conversationId,
    opportunityId: opportunity.id,
    payload: {
      groupId,
      offerId: offer.id,
      productKey: offer.productKey,
      individualPriceCents: price.individualCents,
      groupUnitPriceCents: price.groupUnitCents,
      savingsPerMemberCents: price.savingsPerMemberCents,
      quantityPerMember: 1,
      isSimulatedOffer: true,
      validUntil: offer.validUntil,
    },
    idempotencyKey: `purchase:proposal:${groupId}:${msg.fromAgentId}`,
  });
}

export async function handleProposal(ctx: PlatformContext, msg: A2AMessage): Promise<void> {
  const groupId = requiredString(msg.payload.groupId, "groupId");
  if (msg.payload.isSimulatedOffer !== true) throw new Error("Only simulated offers are allowed");
  const ownIntents = await ctx.intents.listByAgent(msg.toAgentId, { kind: "purchase", status: "shared" });
  const own = ownIntents.at(-1);
  if (!own) throw new Error("Candidate purchase intent not found");
  const evaluation = evaluateProposal(
    {
      groupUnitCents: Number(msg.payload.groupUnitPriceCents),
      savingsPerMemberCents: Number(msg.payload.savingsPerMemberCents),
    },
    PurchaseIntentPrivate.parse(own.privatePayload),
    matchingRules,
  );
  await ctx.a2a.send({
    type: "purchase.proposal_result",
    fromAgentId: msg.toAgentId,
    toAgentId: msg.fromAgentId,
    conversationId: msg.conversationId,
    opportunityId: msg.opportunityId ?? undefined,
    payload: { groupId, accept: evaluation.accept, reasons: evaluation.reasons },
    idempotencyKey: `purchase:proposal-result:${msg.id}`,
  });
}

async function requestJoinApprovals(ctx: PlatformContext, groupId: string): Promise<void> {
  const group = groupRow(ctx, groupId);
  if (!group) throw new Error(`Unknown group ${groupId}`);
  const offer = offerRow(ctx, group.offerId);
  if (!offer) throw new Error(`Unknown offer ${group.offerId}`);
  for (const member of memberRows(ctx, groupId)) {
    const user = await ctx.users.get(member.userId);
    if (!user) throw new Error(`Unknown user ${member.userId}`);
    const approval = await ctx.approvals.request({
      kind: "join_group_purchase",
      userId: member.userId,
      agentId: member.agentId,
      opportunityId: group.opportunityId,
      payload: {
        groupId,
        userId: member.userId,
        offerId: group.offerId,
        productKey: group.productKey,
        shareCents: member.shareCents,
        isSimulatedOffer: true,
      },
      promptText: joinGroupCopy({
        first: user.firstName,
        productLabel: offer.title,
        groupCents: group.groupUnitPriceCents,
        individualCents: group.individualPriceCents,
        savingsCents: group.savingsPerMemberCents,
        merchant: offer.merchantName,
      }),
      ttlMinutes: ctx.config.approvalTtlMinutes,
      idempotencyKey: `purchase:join:${groupId}:${member.userId}`,
    });
    ctx.db
      .update(groupPurchaseMembers)
      .set({ joinApprovalId: approval.id })
      .where(
        and(
          eq(groupPurchaseMembers.groupId, groupId),
          eq(groupPurchaseMembers.agentId, member.agentId),
        ),
      )
      .run();
  }
}

export async function handleProposalResult(ctx: PlatformContext, msg: A2AMessage): Promise<void> {
  const groupId = requiredString(msg.payload.groupId, "groupId");
  const group = groupRow(ctx, groupId);
  if (!group || group.status !== "proposed") return;
  const trigger = msg.payload.accept === true ? "proposal_accepted" : "proposal_rejected";
  const next = transitionGroup(group.status as GroupStatus, trigger);
  setGroupStatus(ctx, groupId, next);
  await emitGroupUpdated(ctx, groupId);
  if (next === "awaiting_join_approvals") await requestJoinApprovals(ctx, groupId);
}

async function notifyNeutralCancellation(
  ctx: PlatformContext,
  groupId: string,
  decliningUserId: string,
): Promise<void> {
  for (const member of memberRows(ctx, groupId)) {
    if (member.userId === decliningUserId) continue;
    await ctx.notifier.send({
      userId: member.userId,
      kind: "info",
      text: "The other person passed on the group purchase. Nothing was charged.",
      opportunityId: groupRow(ctx, groupId)?.opportunityId,
      idempotencyKey: `purchase:cancelled:${groupId}:${member.userId}`,
    });
  }
}

async function revealNamesAndRequestPayment(ctx: PlatformContext, groupId: string): Promise<void> {
  const group = groupRow(ctx, groupId);
  if (!group) throw new Error(`Unknown group ${groupId}`);
  const offer = offerRow(ctx, group.offerId);
  if (!offer) throw new Error(`Unknown offer ${group.offerId}`);
  const members = memberRows(ctx, groupId);
  const pool = ctx.db.select().from(bankLinks).where(eq(bankLinks.linkKey, "pool")).get();
  if (!pool) throw new Error("Group pool account is not seeded");

  for (const member of members) {
    if (!(await ctx.consent.has(member.userId, "sandbox_payments"))) {
      setGroupStatus(ctx, groupId, "cancelled", "sandbox_payments consent missing");
      await notifyNeutralCancellation(ctx, groupId, member.userId);
      await emitGroupUpdated(ctx, groupId);
      return;
    }
  }

  for (const member of members) {
    const user = await ctx.users.get(member.userId);
    const other = members.find((item) => item.userId !== member.userId);
    const otherUser = other ? await ctx.users.get(other.userId) : null;
    const payer = ctx.db.select().from(bankLinks).where(eq(bankLinks.linkKey, member.userId)).get();
    if (!user || !otherUser || !payer) throw new Error("Group identity or bank link is missing");
    await ctx.notifier.send({
      userId: member.userId,
      kind: "info",
      text: `You're buying with ${otherUser.firstName}.`,
      opportunityId: group.opportunityId,
      idempotencyKey: `purchase:name-reveal:${groupId}:${member.userId}`,
    });
    const approval = await ctx.approvals.request({
      kind: "authorize_payment",
      userId: member.userId,
      agentId: member.agentId,
      opportunityId: group.opportunityId,
      payload: {
        groupId,
        userId: member.userId,
        amountCents: member.shareCents,
        fromAccountRef: payer.accountRef,
        toAccountRef: pool.accountRef,
        productKey: group.productKey,
      },
      promptText: authorizePaymentCopy({
        first: user.firstName,
        amountCents: member.shareCents,
        last4: payer.last4,
        productLabel: offer.title,
      }),
      ttlMinutes: ctx.config.approvalTtlMinutes,
      idempotencyKey: `purchase:payment-approval:${groupId}:${member.userId}`,
    });
    ctx.db
      .update(groupPurchaseMembers)
      .set({ payApprovalId: approval.id })
      .where(
        and(
          eq(groupPurchaseMembers.groupId, groupId),
          eq(groupPurchaseMembers.agentId, member.agentId),
        ),
      )
      .run();
  }
}

export async function handleJoinDecision(ctx: PlatformContext, approval: ApprovalT): Promise<void> {
  const member = ctx.db
    .select()
    .from(groupPurchaseMembers)
    .where(eq(groupPurchaseMembers.joinApprovalId, approval.id))
    .get();
  if (!member) return;
  const group = groupRow(ctx, member.groupId);
  if (!group || group.status !== "awaiting_join_approvals") return;

  if (approval.status === "expired") {
    setGroupStatus(ctx, member.groupId, transitionGroup(group.status as GroupStatus, "approval_expired"));
    await emitGroupUpdated(ctx, member.groupId);
    return;
  }
  if (approval.status === "declined") {
    ctx.db
      .update(groupPurchaseMembers)
      .set({ joinState: "declined" })
      .where(
        and(
          eq(groupPurchaseMembers.groupId, member.groupId),
          eq(groupPurchaseMembers.agentId, member.agentId),
        ),
      )
      .run();
    setGroupStatus(
      ctx,
      member.groupId,
      transitionGroup(group.status as GroupStatus, "join_declined"),
    );
    await notifyNeutralCancellation(ctx, member.groupId, member.userId);
    await emitGroupUpdated(ctx, member.groupId);
    return;
  }
  if (approval.status !== "approved") return;

  ctx.db
    .update(groupPurchaseMembers)
    .set({ joinState: "approved" })
    .where(
      and(
        eq(groupPurchaseMembers.groupId, member.groupId),
        eq(groupPurchaseMembers.agentId, member.agentId),
      ),
    )
    .run();
  const members = memberRows(ctx, member.groupId);
  if (!members.every((item) => item.joinState === "approved")) {
    await emitGroupUpdated(ctx, member.groupId);
    return;
  }
  for (const item of members) {
    if (!(await ctx.consent.has(item.userId, "purchase_matching"))) {
      setGroupStatus(ctx, member.groupId, "cancelled", "purchase_matching consent missing");
      await notifyNeutralCancellation(ctx, member.groupId, item.userId);
      await emitGroupUpdated(ctx, member.groupId);
      return;
    }
  }

  setGroupStatus(
    ctx,
    member.groupId,
    transitionGroup(group.status as GroupStatus, "all_join_approved"),
  );
  await emitGroupUpdated(ctx, member.groupId);
  setGroupStatus(ctx, member.groupId, "awaiting_payment_approvals");
  await emitGroupUpdated(ctx, member.groupId);
  await revealNamesAndRequestPayment(ctx, member.groupId);
}

export async function handlePurchaseConsentRevoked(
  ctx: PlatformContext,
  userId: string,
  scope: string,
): Promise<void> {
  if (scope !== "purchase_matching" && scope !== "sandbox_payments") return;
  const memberships = ctx.db
    .select()
    .from(groupPurchaseMembers)
    .where(eq(groupPurchaseMembers.userId, userId))
    .all();
  if (memberships.length === 0) return;
  const groups = ctx.db
    .select()
    .from(groupPurchases)
    .where(
      and(
        inArray(
          groupPurchases.id,
          memberships.map((item) => item.groupId),
        ),
        inArray(groupPurchases.status, [
          "proposed",
          "awaiting_join_approvals",
          "confirmed",
          "awaiting_payment_approvals",
          "ready_to_settle",
        ]),
      ),
    )
    .all();
  for (const group of groups) {
    setGroupStatus(ctx, group.id, "cancelled", `${scope} revoked`);
    await ctx.intents.revoke(
      memberships.find((item) => item.groupId === group.id)!.intentId,
      { userId },
    );
    await notifyNeutralCancellation(ctx, group.id, userId);
    await emitGroupUpdated(ctx, group.id);
  }
}

const DEMO_OFFER_ID = "ofr_demo_monitor";

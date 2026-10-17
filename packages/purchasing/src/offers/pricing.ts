import type { MerchantOfferT, PurchaseIntentPrivateT } from "@dennis/contracts";

import type { MatchingRules } from "../matching/matcher.js";

export interface GroupPrice {
  memberCount: number;
  individualCents: number;
  groupUnitCents: number;
  savingsPerMemberCents: number;
}

export function priceGroup(offer: MerchantOfferT, memberCount: number): GroupPrice | null {
  const applicable = offer.tiers
    .filter((tier) => memberCount >= tier.minQty)
    .sort((a, b) => a.unitPriceCents - b.unitPriceCents)[0];
  if (!applicable) return null;
  return {
    memberCount,
    individualCents: offer.unitPriceCents,
    groupUnitCents: applicable.unitPriceCents,
    savingsPerMemberCents: offer.unitPriceCents - applicable.unitPriceCents,
  };
}

export function evaluateProposal(
  proposal: { groupUnitCents: number; savingsPerMemberCents: number },
  own: PurchaseIntentPrivateT,
  rules: MatchingRules,
): { accept: boolean; reasons: string[] } {
  const savingsPercent =
    proposal.groupUnitCents + proposal.savingsPerMemberCents === 0
      ? 0
      : (proposal.savingsPerMemberCents * 100) /
        (proposal.groupUnitCents + proposal.savingsPerMemberCents);
  const reasons: string[] = [];
  if (
    proposal.savingsPerMemberCents < rules.minSavingsCents ||
    savingsPercent < rules.minSavingsPercent
  ) {
    reasons.push("savings_below_threshold");
  }
  if (own.budgetMaxCents !== null && proposal.groupUnitCents > own.budgetMaxCents) {
    reasons.push("over_budget");
  }
  return { accept: reasons.length === 0, reasons: reasons.length === 0 ? ["accepted"] : reasons };
}

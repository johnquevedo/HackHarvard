import type { MerchantOfferT, PurchaseIntentPrivateT } from "@dennis/contracts";
import { describe, expect, it } from "vitest";

import { matchingRules } from "../matching/rules.js";
import { evaluateProposal, priceGroup } from "./pricing.js";

const offer = {
  id: "ofr_demo_monitor",
  merchantName: "DemoMart (simulated)",
  productKey: "monitor_27in_4k",
  title: "27-inch 4K monitor",
  unitPriceCents: 32_999,
  tiers: [{ minQty: 2, unitPriceCents: 28_499 }],
  isSimulated: true,
  sourceLabel: "SIMULATED OFFER, not a real merchant quote",
  validUntil: "2026-10-19T12:00:00.000Z",
} as MerchantOfferT;

const own = {
  productText: "monitor",
  category: "monitor",
  quantity: 1,
  budgetMaxCents: 35_000,
  timeframe: { kind: "unspecified", from: "2026-10-17", to: "2026-10-31" },
  statedCertainty: "considering",
  sourceExcerpt: "private",
} as PurchaseIntentPrivateT;

describe("group pricing", () => {
  it("returns null below the first tier", () => {
    expect(priceGroup(offer, 1)).toBeNull();
  });

  it("prices the two member demo group", () => {
    expect(priceGroup(offer, 2)).toEqual({
      memberCount: 2,
      individualCents: 32_999,
      groupUnitCents: 28_499,
      savingsPerMemberCents: 4_500,
    });
  });

  it("accepts an offer that clears savings and budget rules", () => {
    expect(
      evaluateProposal(
        { groupUnitCents: 28_499, savingsPerMemberCents: 4_500 },
        own,
        matchingRules,
      ),
    ).toEqual({
      accept: true,
      reasons: ["accepted"],
    });
  });

  it("rejects insufficient savings", () => {
    expect(
      evaluateProposal({ groupUnitCents: 32_500, savingsPerMemberCents: 499 }, own, matchingRules),
    ).toMatchObject({
      accept: false,
      reasons: ["savings_below_threshold"],
    });
  });

  it("rejects a price over the private budget", () => {
    expect(
      evaluateProposal(
        { groupUnitCents: 28_499, savingsPerMemberCents: 4_500 },
        { ...own, budgetMaxCents: 28_000 },
        matchingRules,
      ),
    ).toMatchObject({ accept: false, reasons: ["over_budget"] });
  });
});

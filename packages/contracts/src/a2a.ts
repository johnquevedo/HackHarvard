import { z } from "zod";
import { PurchaseIntentPublic, IsoDateTime } from "./domain.ts";
import { Cents } from "./ids.ts";
const s = z.string();
export const A2A_PAYLOAD_SCHEMAS = {
  "purchase.probe": z
    .object({
      intentRef: s,
      publicIntent: PurchaseIntentPublic,
      leadAgentId: s,
    })
    .strict(),
  "purchase.probe_result": z
    .object({
      intentRef: s,
      compatible: z.boolean(),
      reasons: z.array(
        z.enum([
          "budget_overlap",
          "window_overlap",
          "product_match",
          "region_match",
          "matching_disabled",
          "already_matched",
          "budget_too_low",
        ]),
      ),
    })
    .strict(),
  "purchase.proposal": z
    .object({
      groupId: s,
      offerId: s,
      productKey: s,
      individualPriceCents: Cents,
      groupUnitPriceCents: Cents,
      savingsPerMemberCents: Cents,
      quantityPerMember: z.number().int().positive(),
      isSimulatedOffer: z.literal(true),
      validUntil: IsoDateTime,
    })
    .strict(),
  "purchase.proposal_result": z
    .object({
      groupId: s,
      accept: z.boolean(),
      reasons: z.array(
        z.enum([
          "accepted",
          "savings_below_threshold",
          "over_budget",
          "matching_disabled",
        ]),
      ),
    })
    .strict(),
  "market.invite": z
    .object({
      marketId: s,
      question: s.max(160),
      subjectFirstName: s,
      pointsOnly: z.literal(true),
      startingPoints: z.number().int().nonnegative(),
      expiresAt: IsoDateTime,
    })
    .strict(),
  "market.invite_response": z
    .object({
      marketId: s,
      response: z.enum(["accepted", "declined", "expired"]),
    })
    .strict(),
} as const;
export const A2AType = z.enum(
  Object.keys(A2A_PAYLOAD_SCHEMAS) as [
    keyof typeof A2A_PAYLOAD_SCHEMAS,
    ...(keyof typeof A2A_PAYLOAD_SCHEMAS)[],
  ],
);
export type A2ATypeT = z.infer<typeof A2AType>;

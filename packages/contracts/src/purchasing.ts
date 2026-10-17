import { z } from "zod";
import { Cents } from "./ids.ts";
import { IsoDateTime, JsonObject, MarketCategory } from "./domain.ts";
const s = z.string();
const pos = z.number().int().positive();
export const GroupPurchaseStatus = z.enum([
  "proposed",
  "awaiting_join_approvals",
  "confirmed",
  "awaiting_payment_approvals",
  "ready_to_settle",
  "settling",
  "settled",
  "failed",
  "cancelled",
  "expired",
]);
export const PaymentStatus = z.enum([
  "created",
  "submitting",
  "submitted",
  "verified",
  "unverified",
  "failed",
]);
export const MerchantOffer = z.object({
  id: s,
  merchantName: s,
  productKey: s,
  title: s,
  unitPriceCents: Cents,
  tiers: z.array(z.object({ minQty: pos, unitPriceCents: Cents })),
  isSimulated: z.literal(true),
  sourceLabel: s,
  validUntil: IsoDateTime,
});
export type MerchantOfferT = z.infer<typeof MerchantOffer>;
export const GroupPurchase = z.object({
  id: s,
  opportunityId: s,
  offerId: s,
  productKey: s,
  leadAgentId: s,
  status: GroupPurchaseStatus,
  individualPriceCents: Cents,
  groupUnitPriceCents: Cents,
  quantityPerMember: pos,
  savingsPerMemberCents: Cents,
  poolAccountRef: s,
  failureReason: s.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type GroupPurchaseT = z.infer<typeof GroupPurchase>;
export const GroupPurchaseMember = z.object({
  groupId: s,
  agentId: s,
  userId: s,
  intentId: s.nullable(),
  shareCents: Cents,
  joinState: z.enum(["pending", "approved", "declined", "withdrawn"]),
  joinApprovalId: s.nullable(),
  payState: z.enum(["none", "authorized", "settling", "settled", "failed"]),
  payApprovalId: s.nullable(),
});
export type GroupPurchaseMemberT = z.infer<typeof GroupPurchaseMember>;
export const BankLink = z.object({
  linkKey: s,
  role: z.enum(["member", "pool"]),
  provider: z.enum(["nessie", "sim"]),
  customerRef: s,
  accountRef: s,
  accountLabel: s,
  last4: s,
  baselineCents: Cents,
  seededAt: IsoDateTime,
});
export type BankLinkT = z.infer<typeof BankLink>;
export const PaymentAttempt = z.object({
  id: s,
  groupId: s,
  userId: s,
  approvalId: s,
  idempotencyKey: s,
  fromAccountRef: s,
  toAccountRef: s,
  amountCents: Cents,
  status: PaymentStatus,
  provider: s,
  providerTransferId: s.nullable(),
  requestJson: JsonObject.nullable(),
  responseJson: JsonObject.nullable(),
  balancesBefore: JsonObject.nullable(),
  balancesAfter: JsonObject.nullable(),
  verificationNote: s.nullable(),
  error: s.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PaymentAttemptT = z.infer<typeof PaymentAttempt>;

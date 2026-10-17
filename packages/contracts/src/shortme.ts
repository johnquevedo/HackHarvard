import { z } from "zod";
import { Cents } from "./ids.ts";
import { IsoDateTime, JsonObject, MarketCategory } from "./domain.ts";
const s = z.string();
const pos = z.number().int().positive();
export const MarketStatus = z.enum([
  "proposed",
  "declined",
  "expired",
  "open",
  "locked",
  "resolution_proposed",
  "disputed",
  "resolved",
  "void",
]);
export const Market = z.object({
  id: s,
  opportunityId: s,
  subjectUserId: s,
  subjectAgentId: s,
  sourceIntentId: s.nullable(),
  category: MarketCategory,
  templateKey: s,
  question: s,
  resolutionCriteria: s,
  status: MarketStatus,
  lockAt: IsoDateTime.nullable(),
  outcome: z.enum(["yes", "no", "void"]).nullable(),
  resolverKind: z.enum(["demo_standin", "subject"]),
  redactions: z.array(s),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  openedAt: IsoDateTime.nullable(),
  resolvedAt: IsoDateTime.nullable(),
});
export type MarketT = z.infer<typeof Market>;
export const MarketParticipant = z.object({
  marketId: s,
  userId: s,
  role: z.enum(["subject", "friend"]),
  inviteState: z.enum(["invited", "accepted", "declined", "expired", "not_applicable"]),
});
export type MarketParticipantT = z.infer<typeof MarketParticipant>;
export const Position = z.object({
  id: s,
  marketId: s,
  userId: s,
  side: z.enum(["back", "fade"]),
  points: pos.max(100),
  idempotencyKey: s,
  createdAt: IsoDateTime,
});
export type PositionT = z.infer<typeof Position>;
export const PointsAccount = z.object({
  userId: s,
  balance: z.number().int().nonnegative(),
});
export type PointsAccountT = z.infer<typeof PointsAccount>;
export const LedgerEntry = z.object({
  id: s,
  userId: s,
  marketId: s.nullable(),
  kind: z.enum(["grant", "stake", "payout", "refund", "adjustment"]),
  delta: z.number().int(),
  balanceAfter: z.number().int().nonnegative(),
  refId: s.nullable(),
  idempotencyKey: s,
  createdAt: IsoDateTime,
});
export type LedgerEntryT = z.infer<typeof LedgerEntry>;
export const MarketResolution = z.object({
  id: s,
  marketId: s,
  proposedOutcome: z.enum(["yes", "no"]),
  proposedBy: s,
  status: z.enum(["proposed", "confirmed", "disputed", "voided"]),
  subjectConfirmState: z.enum(["pending", "confirmed", "disputed"]),
  evidenceNote: s,
  createdAt: IsoDateTime,
  decidedAt: IsoDateTime.nullable(),
});
export type MarketResolutionT = z.infer<typeof MarketResolution>;

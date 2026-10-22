import { z } from "zod";
import { idSchema, Cents } from "./ids.ts";
export const IsoDateTime = z.iso.datetime();
export const IsoDate = z.iso.date();
export const JsonObject = z.record(z.string(), z.unknown());

export const ConsentScope = z.enum([
  "messaging_context",
  "purchase_matching",
  "shortme_free_play",
  "sandbox_payments",
]);
export const IntentKind = z.enum(["purchase", "milestone"]);
export const IntentStatus = z.enum(["detected", "shared", "matched", "closed", "revoked"]);
export const OpportunityType = z.enum(["group_purchase", "shortme_market"]);
export const ApprovalKind = z.enum([
  "join_group_purchase",
  "authorize_payment",
  "publish_market",
  "confirm_resolution",
]);
export const ApprovalStatus = z.enum(["pending", "approved", "declined", "expired", "revoked"]);
export const DecisionChannel = z.enum(["imessage", "sim_phone", "dashboard_fallback"]);
export const OutboxStatus = z.enum(["queued", "sending", "dispatched", "delivered", "failed"]);
export const EventVisibility = z.enum(["private", "shared", "system"]);
export const ProviderMode = z.enum(["live", "simulated", "replay", "fallback"]);
export const IntegrationName = z.enum(["photon", "llm", "nessie", "chalk"]);
export const RejectReason = z.enum([
  "not_an_intent",
  "low_confidence",
  "category_disabled",
  "sensitive",
  "not_subject_owned",
  "policy_blocked",
  "llm_unavailable",
  "schema_invalid",
]);

export const AgentSettings = z.object({
  matchingEnabled: z.boolean(),
  shortmeEnabled: z.boolean(),
  ackMode: z.enum(["none", "reaction"]),
});
export const User = z.object({
  id: idSchema("user"),
  displayName: z.string(),
  firstName: z.string(),
  handle: z.string(),
  handleKind: z.enum(["phone", "email"]),
  photonUserId: z.string().nullable(),
  isDemo: z.boolean(),
  regionCode: z.string(),
  createdAt: IsoDateTime,
});
export const Agent = z.object({
  id: idSchema("agent"),
  userId: idSchema("user"),
  name: z.string(),
  status: z.enum(["active", "paused"]),
  settings: AgentSettings,
  createdAt: IsoDateTime,
});

// Normalized inbound message produced by every MessagingProvider.
// Native iMessage send effects Dennis may use (Photon Spectrum maps them to Apple effect ids).
export const NativeEffect = z.enum([
  "slam",
  "loud",
  "gentle",
  "invisible",
  "confetti",
  "fireworks",
  "balloons",
  "lasers",
  "celebration",
  "sparkles",
  "spotlight",
  "echo",
  "heart",
]);
// A vote (or un-vote) on a native poll Dennis sent; `pollMessageId` is the poll's provider id.
export const PollVote = z.object({
  pollMessageId: z.string(),
  option: z.string(),
  selected: z.boolean(),
});

export const InboundMessage = z.object({
  provider: z.enum(["photon", "sim"]),
  accountKey: z.string(),
  providerMessageId: z.string(),
  providerSpaceId: z.string().nullable(),
  providerSpaceKind: z.enum(["direct", "group"]).optional(),
  providerParticipantIds: z.array(z.string()).optional(),
  providerParticipantHandles: z.array(z.string()).optional(),
  providerSenderId: z.string().nullable(),
  senderHandle: z.string(),
  text: z.string().max(4000),
  receivedAt: IsoDateTime,
  mode: ProviderMode,
  pollVote: PollVote.optional(),
});

export const PurchaseCategory = z.enum([
  "monitor",
  "moving_service",
  "trip",
  "subscription",
  "dining",
  "other",
]);
export const Timeframe = z.object({
  kind: z.enum(["this_weekend", "this_week", "this_month", "flexible", "unspecified"]),
  from: IsoDate.nullable(),
  to: IsoDate.nullable(),
});
export const PurchaseIntentPrivate = z
  .object({
    productText: z.string().max(200),
    category: PurchaseCategory,
    quantity: z.number().int().min(1).max(10),
    budgetMaxCents: Cents.nullable(),
    timeframe: Timeframe,
    statedCertainty: z.enum(["considering", "decided"]),
    sourceExcerpt: z.string().max(280), // never leaves the owner's private lane
  })
  .strict();
export const PurchaseIntentPublic = z
  .object({
    category: PurchaseCategory,
    productKey: z.string().max(60), // normalized, for example monitor_27in_4k
    quantity: z.number().int().min(1).max(10),
    budgetBandMaxCents: Cents.nullable(), // budget rounded UP to a multiple of 2500 cents
    window: z.object({ from: IsoDate, to: IsoDate }),
    regionCode: z.string().max(16), // coarse region only
  })
  .strict();

export const MarketCategory = z.enum([
  "recruiting",
  "academics",
  "dating",
  "friend_event",
  "other",
]);
export const MilestonePrivate = z
  .object({
    category: MarketCategory,
    milestoneKind: z.string().max(40),
    proposedQuestion: z.string().max(160),
    resolvesWithinDays: z.number().int().min(1).max(60).nullable(),
    sensitivity: z.enum(["none", "low", "high"]),
    redactions: z.array(z.string()).max(5),
    sourceExcerpt: z.string().max(280),
  })
  .strict();
// Milestones have NO public payload. The only shared artifact is a published market.

export const Intent = z.object({
  id: idSchema("intent"),
  agentId: idSchema("agent"),
  userId: idSchema("user"),
  kind: IntentKind,
  status: IntentStatus,
  sourceMessageId: z.string().nullable(),
  privatePayload: JsonObject,
  publicPayload: JsonObject.nullable(),
  shared: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(300),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  expiresAt: IsoDateTime.nullable(),
  revokedAt: IsoDateTime.nullable(),
});
// What OTHER agents may see. No userId, no private payload.
export const SharedIntentView = z.object({
  intentId: idSchema("intent"),
  agentId: idSchema("agent"),
  kind: IntentKind,
  publicPayload: JsonObject,
  createdAt: IsoDateTime,
});

export const Approval = z.object({
  id: idSchema("approval"),
  shortCode: z.string().length(4),
  userId: idSchema("user"),
  agentId: idSchema("agent"),
  opportunityId: z.string().nullable(),
  kind: ApprovalKind,
  status: ApprovalStatus,
  payload: JsonObject,
  payloadHash: z.string().length(64),
  promptText: z.string(),
  expiresAt: IsoDateTime,
  decidedAt: IsoDateTime.nullable(),
  decidedVia: DecisionChannel.nullable(),
  consumedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export const Opportunity = z.object({
  id: idSchema("opportunity"),
  type: OpportunityType,
  domainRefId: z.string(),
  status: z.string(),
  headline: z.string(),
  participantAgentIds: z.array(idSchema("agent")),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export const OutboxRecord = z.object({
  id: idSchema("outbox"),
  userId: idSchema("user"),
  kind: z.enum(["info", "approval_request", "result", "invite"]),
  text: z.string(),
  approvalId: z.string().nullable(),
  opportunityId: z.string().nullable(),
  status: OutboxStatus,
  provider: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  providerStatus: z.enum(["dispatched", "accepted", "delivered", "failed"]).nullable(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  createdAt: IsoDateTime,
  sentAt: IsoDateTime.nullable(),
  deliveredAt: IsoDateTime.nullable(),
});
export const IntegrationStatus = z.object({
  name: IntegrationName,
  mode: ProviderMode,
  healthy: z.boolean(),
  detail: z.string(),
  lastCheckedAt: IsoDateTime,
  lastSuccessAt: IsoDateTime.nullable(),
});
export const ProviderSendRequest = z.object({
  accountKey: z.string(),
  toHandle: z.string(),
  toPhotonUserId: z.string().nullable(),
  spaceId: z.string().nullable(),
  text: z.string().max(1500),
  idempotencyKey: z.string(),
  effect: NativeEffect.optional(),
});
export const ProviderSendResult = z.object({
  providerMessageId: z.string(),
  status: z.enum(["dispatched", "accepted", "delivered", "failed"]),
  mode: ProviderMode,
  spaceId: z.string().nullable(),
  photonUserId: z.string().nullable(),
});

export type IsoDateTimeT = z.infer<typeof IsoDateTime>;
export type IsoDateT = z.infer<typeof IsoDate>;
export type JsonObjectT = z.infer<typeof JsonObject>;
export type ConsentScopeT = z.infer<typeof ConsentScope>;
export type IntentKindT = z.infer<typeof IntentKind>;
export type IntentStatusT = z.infer<typeof IntentStatus>;
export type OpportunityTypeT = z.infer<typeof OpportunityType>;
export type ApprovalKindT = z.infer<typeof ApprovalKind>;
export type ApprovalStatusT = z.infer<typeof ApprovalStatus>;
export type DecisionChannelT = z.infer<typeof DecisionChannel>;
export type OutboxStatusT = z.infer<typeof OutboxStatus>;
export type EventVisibilityT = z.infer<typeof EventVisibility>;
export type ProviderModeT = z.infer<typeof ProviderMode>;
export type IntegrationNameT = z.infer<typeof IntegrationName>;
export type RejectReasonT = z.infer<typeof RejectReason>;
export type AgentSettingsT = z.infer<typeof AgentSettings>;
export type UserT = z.infer<typeof User>;
export type AgentT = z.infer<typeof Agent>;
export type InboundMessageT = z.infer<typeof InboundMessage>;
export type NativeEffectT = z.infer<typeof NativeEffect>;
export type PollVoteT = z.infer<typeof PollVote>;
export type PurchaseCategoryT = z.infer<typeof PurchaseCategory>;
export type TimeframeT = z.infer<typeof Timeframe>;
export type PurchaseIntentPrivateT = z.infer<typeof PurchaseIntentPrivate>;
export type PurchaseIntentPublicT = z.infer<typeof PurchaseIntentPublic>;
export type MarketCategoryT = z.infer<typeof MarketCategory>;
export type MilestonePrivateT = z.infer<typeof MilestonePrivate>;
export type IntentT = z.infer<typeof Intent>;
export type SharedIntentViewT = z.infer<typeof SharedIntentView>;
export type ApprovalT = z.infer<typeof Approval>;
export type OpportunityT = z.infer<typeof Opportunity>;
export type OutboxRecordT = z.infer<typeof OutboxRecord>;
export type IntegrationStatusT = z.infer<typeof IntegrationStatus>;
export type ProviderSendRequestT = z.infer<typeof ProviderSendRequest>;
export type ProviderSendResultT = z.infer<typeof ProviderSendResult>;

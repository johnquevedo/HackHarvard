import { DomainEvent } from "./events.ts";
import { z } from "zod";
import {
  User,
  Agent,
  AgentSettings,
  ConsentScope,
  IsoDateTime,
  Intent,
  Approval,
  Opportunity,
  IntegrationStatus,
} from "./domain.ts";
import { MerchantOffer, GroupPurchase, GroupPurchaseMember, PaymentAttempt } from "./purchasing.ts";
import { Market, MarketParticipant, Position, MarketResolution } from "./shortme.ts";
export const ConsentState = z.object({
  scope: ConsentScope,
  granted: z.boolean(),
  updatedAt: IsoDateTime,
  via: z.string(),
});
export const UserSummary = z.object({
  user: User,
  agent: Agent,
  consents: z.record(ConsentScope, z.boolean()),
  pendingApprovals: z.number().int().nonnegative(),
});
export const IntentView = Intent.omit({ privatePayload: true }).extend({
  privatePayload: Intent.shape.privatePayload.optional(),
});
export const ExplainTrace = z.object({
  opportunityId: z.string(),
  steps: z.array(
    z.object({
      seq: z.number().int(),
      ts: IsoDateTime,
      type: z.string(),
      agentId: z.string().optional(),
      summary: z.string(),
      checks: z
        .array(
          z.object({
            rule: z.string(),
            passed: z.boolean(),
            detail: z.string(),
          }),
        )
        .optional(),
    }),
  ),
});
export const PaymentAttemptView = PaymentAttempt.omit({ requestJson: true });
export const GroupDetail = z.object({
  group: GroupPurchase,
  members: z.array(GroupPurchaseMember.extend({ firstName: z.string().optional() })),
  offer: MerchantOffer,
  savingsPerMemberCents: z.number().int(),
  payments: z.array(PaymentAttemptView),
});
export const MarketDetail = z.object({
  market: Market,
  participants: z.array(MarketParticipant),
  positions: z.array(Position),
  pools: z.object({ back: z.number().int(), fade: z.number().int() }),
  resolution: MarketResolution.nullable(),
  payoutPreview: z.array(z.object({ userId: z.string(), points: z.number().int() })),
});
export const DemoState = z.object({
  runId: z.string(),
  modes: z.record(z.string(), z.string()),
  checklist: z.array(z.object({ id: z.string(), label: z.string(), ok: z.boolean() })),
});
export const SettingsRequest = AgentSettings.partial().strict();
export const PauseRequest = z.object({ paused: z.boolean() }).strict();
export const ConsentRequest = z
  .object({ userId: z.string(), scope: ConsentScope, granted: z.boolean() })
  .strict();
export const UserIdRequest = z.object({ userId: z.string() }).strict();
export const ApprovalDecisionRequest = z
  .object({ userId: z.string(), decision: z.enum(["approve", "decline"]) })
  .strict();
export const SimInboundRequest = z
  .object({
    fromUserId: z.string(),
    text: z.string().min(1).max(4000),
    clientMessageId: z.string().min(1).max(200).optional(),
  })
  .strict();
export const PositionRequest = z
  .object({
    userId: z.string(),
    side: z.enum(["back", "fade"]),
    points: z.number().int().min(1).max(100),
  })
  .strict();
export const ResolveRequest = z.object({ outcome: z.enum(["yes", "no"]) }).strict();
export const AdminResolveRequest = z.object({ outcome: z.enum(["yes", "no", "void"]) }).strict();
export const HealthResponse = z.object({
  status: z.literal("ok"),
  time: IsoDateTime,
  dbOk: z.boolean(),
  modes: z.object({ photon: z.string(), llm: z.string(), nessie: z.string() }),
});
export const EventsResponse = z.object({
  events: z.array(DomainEvent),
  lastSeq: z.number().int().nonnegative(),
});
export const SimInboundResponse = z.object({
  messageId: z.string().nullable(),
  accepted: z.boolean(),
});
export const SimThreadResponse = z.object({
  messages: z.array(
    z.object({
      direction: z.enum(["in", "out"]),
      text: z.string(),
      ts: IsoDateTime,
      status: z.string(),
    }),
  ),
});
export const ForgetResponse = z.object({
  deleted: z.object({
    messages: z.number().int(),
    intents: z.number().int(),
    positions: z.number().int(),
  }),
});
export const IntegrationsResponse = z.array(IntegrationStatus);
export const ApprovalsResponse = z.array(Approval);
export const OpportunitiesResponse = z.array(Opportunity);
export type UserSummaryT = z.infer<typeof UserSummary>;
export type ConsentStateT = z.infer<typeof ConsentState>;
export type IntentViewT = z.infer<typeof IntentView>;
export type ExplainTraceT = z.infer<typeof ExplainTrace>;
export type PaymentAttemptViewT = z.infer<typeof PaymentAttemptView>;
export type GroupDetailT = z.infer<typeof GroupDetail>;
export type MarketDetailT = z.infer<typeof MarketDetail>;
export type DemoStateT = z.infer<typeof DemoState>;

import { A2A_PAYLOAD_SCHEMAS } from "./a2a.ts";
import { z } from "zod";
import { idSchema, Cents } from "./ids.ts";
import {
  IsoDateTime,
  EventVisibility,
  ProviderMode,
  JsonObject,
  IntegrationStatus,
  PurchaseIntentPublic,
} from "./domain.ts";
export const EventActor = z.object({
  kind: z.enum(["user", "agent", "system", "provider"]),
  agentId: z.string().optional(),
  userId: z.string().optional(),
});
export const DomainEvent = z.object({
  seq: z.number().int(),
  id: idSchema("event"),
  ts: IsoDateTime,
  type: z.string(),
  actor: EventActor,
  visibility: EventVisibility,
  opportunityId: z.string().nullable(),
  traceId: z.string(),
  mode: ProviderMode.nullable(),
  payload: JsonObject,
});
export const NewEvent = z.object({
  type: z.string(),
  actor: EventActor,
  visibility: EventVisibility,
  opportunityId: z.string().optional(),
  traceId: z.string().optional(),
  mode: ProviderMode.optional(),
  payload: JsonObject,
});

const s = z.string();
const b = z.boolean();
const n = z.number().int().nonnegative();
function validateSharedA2A(
  value: { type: string; payload: Record<string, unknown> },
  ctx: z.RefinementCtx,
): void {
  const schema = A2A_PAYLOAD_SCHEMAS[value.type as keyof typeof A2A_PAYLOAD_SCHEMAS];
  if (!schema?.safeParse(value.payload).success)
    ctx.addIssue({ code: "custom", message: "Invalid minimal A2A payload" });
}
export const EVENT_PAYLOAD_SCHEMAS = {
  "message.received": z
    .object({ messageId: s, provider: z.enum(["photon", "sim"]), text: s })
    .strict(),
  "message.ignored": z
    .object({
      messageId: s.optional(),
      reason: z.enum([
        "unknown_handle",
        "no_consent",
        "paused",
        "non_text",
        "own_message",
        "replay",
        "provider_identity_mismatch",
        "group_participants_unresolved",
        "group_sender_mismatch",
        "group_member_unknown",
        "group_member_without_consent",
        "group_command_requires_direct",
      ]),
    })
    .strict(),
  "command.handled": z.object({ messageId: s, command: s, ok: b, note: s.optional() }).strict(),
  "consent.changed": z
    .object({
      userId: s,
      scope: s,
      status: z.enum(["granted", "revoked"]),
      via: s,
    })
    .strict(),
  "agent.status_changed": z.object({ agentId: s, status: z.enum(["active", "paused"]) }).strict(),
  "intent.detected": z
    .object({
      intentId: s,
      kind: z.enum(["purchase", "milestone"]),
      confidence: z.number().min(0).max(1),
      rationale: s,
      summary: s,
      detectorId: s,
      llm: z.object({ provider: s, model: s, latencyMs: n }).strict().nullable(),
    })
    .strict(),
  "intent.rejected": z.object({ messageId: s, detectorId: s, reason: s, detail: s }).strict(),
  "intent.registered": z
    .object({
      intentId: s,
      agentId: s,
      kind: z.literal("purchase"),
      publicPayload: PurchaseIntentPublic,
    })
    .strict(),
  "intent.revoked": z.object({ intentId: s, agentId: s, reason: s }).strict(),
  "a2a.sent": z
    .object({
      a2aId: s,
      conversationId: s,
      type: s,
      fromAgentId: s,
      toAgentId: s,
      payload: JsonObject,
    })
    .strict()
    .superRefine(validateSharedA2A),
  "a2a.handled": z.object({ a2aId: s, type: s, toAgentId: s, ok: b, error: s.optional() }).strict(),
  "approval.requested": z
    .object({
      approvalId: s,
      kind: s,
      shortCode: s,
      expiresAt: IsoDateTime,
      summary: s,
    })
    .strict(),
  "approval.decided": z.object({ approvalId: s, kind: s, status: s, via: s }).strict(),
  "approval.expired": z.object({ approvalId: s, kind: s }).strict(),
  "outbox.queued": z.object({ outboxId: s, userId: s, kind: s, preview: s }).strict(),
  "outbox.updated": z
    .object({
      outboxId: s,
      status: s,
      providerStatus: s.optional(),
      providerMessageId: s.optional(),
      provider: s,
      error: s.optional(),
    })
    .strict(),
  "opportunity.updated": z.object({ opportunityId: s, type: s, status: s, headline: s }).strict(),
  "purchase.match.evaluated": z
    .object({
      conversationId: s,
      aAgentId: s,
      bAgentId: s,
      compatible: b,
      checks: z.array(z.object({ rule: s, passed: b, detail: s }).strict()),
    })
    .strict(),
  "purchase.group.updated": z
    .object({
      groupId: s,
      status: s,
      members: z.array(z.object({ agentId: s, join: s, pay: s }).strict()),
      savingsPerMemberCents: Cents.optional(),
    })
    .strict(),
  "purchase.payment.updated": z
    .object({
      attemptId: s,
      groupId: s,
      userId: s,
      status: s,
      amountCents: Cents,
      providerTransferId: s.optional(),
      balancesBefore: JsonObject.optional(),
      balancesAfter: JsonObject.optional(),
      note: s.optional(),
      mode: ProviderMode,
    })
    .strict(),
  "bank.seeded": z
    .object({
      provider: s,
      mode: ProviderMode,
      accounts: z.array(z.object({ label: s, last4: s, balanceCents: Cents }).strict()),
    })
    .strict(),
  "shortme.market.updated": z
    .object({ marketId: s, status: s, question: s, subjectAgentId: s })
    .strict(),
  "shortme.position.placed": z
    .object({
      marketId: s,
      agentId: s,
      side: z.enum(["back", "fade"]),
      points: n,
      selfShort: b,
    })
    .strict(),
  "shortme.resolution.updated": z
    .object({
      marketId: s,
      status: s,
      proposedOutcome: z.enum(["yes", "no"]).optional(),
      subjectConfirmState: s,
    })
    .strict(),
  "shortme.ledger.posted": z
    .object({
      marketId: s.optional(),
      entries: z.array(
        z
          .object({
            agentId: s,
            kind: s,
            delta: z.number().int(),
            balanceAfter: n,
          })
          .strict(),
      ),
      invariantOk: b,
    })
    .strict(),
  "messaging.latency": z
    .object({ outboxId: s, provider: s, span: z.literal("outbox_send_to_delivered"), latencyMs: n })
    .strict(),
  "native.action": z
    .object({
      actionId: s,
      kind: z.enum(["react", "poll", "rename", "voice", "contact_card"]),
      status: z.enum(["queued", "sent", "failed", "unsupported", "skipped"]),
      detail: s,
    })
    .strict(),
  "poll.vote": z.object({ actionId: s, option: s, selected: b, ok: b, note: s }).strict(),
  "demo.reset": z.object({ runId: s }).strict(),
  "eval.report": z.object({ provider: z.enum(["chalk", "local"]), runId: s }).strict(),
  "error.logged": z.object({ where: s, message: s }).strict(),
  "integration.status": IntegrationStatus.strict(),
} as const;
export type EventType = keyof typeof EVENT_PAYLOAD_SCHEMAS;

export type EventActorT = z.infer<typeof EventActor>;

export type DomainEventT = z.infer<typeof DomainEvent>;

export type NewEventT = z.infer<typeof NewEvent>;

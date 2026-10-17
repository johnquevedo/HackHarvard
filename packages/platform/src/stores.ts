import {
  DennisError,
  ConsentScope,
  PurchaseIntentPrivate,
  PurchaseIntentPublic,
  MilestonePrivate,
  Intent,
  Opportunity,
} from "@dennis/contracts";
import type {
  ConsentService,
  ConsentRevokedHandler,
  IntentStore,
  OpportunityStore,
  IntentT,
  OpportunityT,
} from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { insert, row, rows, update } from "./storage.ts";
export function createConsent(ctx: PlatformContext): ConsentService {
  const hooks: ConsentRevokedHandler[] = [];
  async function has(
    userId: string,
    scope: Parameters<ConsentService["has"]>[1],
  ): Promise<boolean> {
    return (
      row<{ status: string }>(
        ctx.db,
        "SELECT status FROM consents WHERE user_id=? AND scope=? ORDER BY id DESC LIMIT 1",
        userId,
        scope,
      )?.status === "granted"
    );
  }
  return {
    has,
    async require(userId, scope) {
      if (!(await has(userId, scope)))
        throw new DennisError("consent_required", "Consent required: " + scope, 403);
    },
    onRevoked(h) {
      hooks.push(h);
    },
    async set(input) {
      if (!(await ctx.users.get(input.userId)))
        throw new DennisError("not_found", "User not found", 404);
      const agent = await ctx.users.getAgentByUserId(input.userId);
      if (!agent) throw new DennisError("not_found", "Agent not found", 404);
      insert(ctx.db, "consents", {
        userId: input.userId,
        scope: ConsentScope.parse(input.scope),
        status: input.granted ? "granted" : "revoked",
        via: input.via,
        textVersion: "v1",
        createdAt: ctx.clock.nowIso(),
      });
      ctx.events.emit({
        type: "consent.changed",
        actor: { kind: "user", userId: input.userId, agentId: agent.id },
        visibility: "private",
        payload: {
          userId: input.userId,
          scope: input.scope,
          status: input.granted ? "granted" : "revoked",
          via: input.via,
        },
      });
      if (!input.granted) {
        if (input.scope === "messaging_context" || input.scope === "purchase_matching") {
          for (const intent of await ctx.intents.listByAgent(agent.id))
            if (
              (input.scope === "messaging_context" || intent.kind === "purchase") &&
              ["detected", "shared", "matched"].includes(intent.status)
            )
              await ctx.intents.revoke(intent.id, { userId: input.userId });
        }
        const scopeKinds: Record<string, string[]> = {
          messaging_context: [
            "join_group_purchase",
            "authorize_payment",
            "publish_market",
            "confirm_resolution",
          ],
          purchase_matching: ["join_group_purchase", "authorize_payment"],
          sandbox_payments: ["authorize_payment"],
          shortme_free_play: ["publish_market", "confirm_resolution"],
        };
        for (const approval of rows<{ id: string; kind: string }>(
          ctx.db,
          "SELECT id,kind FROM approvals WHERE user_id=? AND status IN ('pending','approved') AND consumed_at IS NULL",
          input.userId,
        ))
          if (scopeKinds[input.scope]?.includes(approval.kind))
            update(ctx.db, "approvals", { status: "revoked" }, "id=?", approval.id);
        for (const hook of hooks) await hook(input.userId, input.scope);
      }
    },
  };
}
export function createIntentStore(ctx: PlatformContext): IntentStore {
  async function get(id: string) {
    return row<IntentT>(ctx.db, "SELECT * FROM intents WHERE id=?", id);
  }
  async function required(id: string) {
    const value = await get(id);
    if (!value) throw new DennisError("not_found", "Intent not found", 404);
    return value;
  }
  return {
    get,
    async create(input) {
      const agent = await ctx.users.getAgent(input.agentId);
      if (!agent || agent.userId !== input.userId)
        throw new DennisError("forbidden", "Intent owner mismatch", 403);
      await ctx.consent.require(input.userId, "messaging_context");
      const privatePayload = (
        input.kind === "purchase" ? PurchaseIntentPrivate : MilestonePrivate
      ).parse(input.privatePayload);
      const publicPayload =
        input.publicPayload === null
          ? null
          : input.kind === "purchase"
            ? PurchaseIntentPublic.parse(input.publicPayload)
            : (() => {
                throw new DennisError("validation_error", "Milestones have no public payload", 400);
              })();
      const now = ctx.clock.nowIso();
      const value = Intent.parse({
        ...input,
        id: ctx.ids.next("intent"),
        privatePayload,
        publicPayload,
        status: "detected",
        shared: false,
        createdAt: now,
        updatedAt: now,
        expiresAt: input.expiresAt ?? null,
        revokedAt: null,
      });
      insert(ctx.db, "intents", value);
      return value;
    },
    async listByAgent(agentId, filter) {
      return rows<IntentT>(
        ctx.db,
        "SELECT * FROM intents WHERE agent_id=? AND (? IS NULL OR kind=?) AND (? IS NULL OR status=?) ORDER BY created_at",
        agentId,
        filter?.kind ?? null,
        filter?.kind ?? null,
        filter?.status ?? null,
        filter?.status ?? null,
      );
    },
    async listShared(filter) {
      const shared = rows<IntentT>(
        ctx.db,
        "SELECT * FROM intents WHERE kind=? AND agent_id != ? AND shared=1 AND status IN ('shared','matched') AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
        filter.kind,
        filter.excludeAgentId,
        ctx.clock.nowIso(),
      );
      const result = [];
      for (const i of shared)
        if (
          i.kind === "purchase" &&
          (await ctx.consent.has(i.userId, "messaging_context")) &&
          (await ctx.consent.has(i.userId, "purchase_matching"))
        )
          result.push({
            intentId: i.id,
            agentId: i.agentId,
            kind: i.kind,
            publicPayload: PurchaseIntentPublic.parse(i.publicPayload),
            createdAt: i.createdAt,
          });
      return result;
    },
    async markShared(id) {
      const i = await required(id);
      if (i.kind !== "purchase" || i.status === "revoked" || !i.publicPayload)
        throw new DennisError("invalid_state", "Intent cannot be shared", 409);
      await ctx.consent.require(i.userId, "messaging_context");
      await ctx.consent.require(i.userId, "purchase_matching");
      PurchaseIntentPublic.parse(i.publicPayload);
      update(
        ctx.db,
        "intents",
        { shared: true, status: "shared", updatedAt: ctx.clock.nowIso() },
        "id=?",
        id,
      );
      return required(id);
    },
    async setStatus(id, status) {
      const i = await required(id);
      if (i.status === "revoked" && status !== "revoked")
        throw new DennisError("invalid_state", "Revoked intent cannot be reopened", 409);
      update(
        ctx.db,
        "intents",
        {
          status,
          updatedAt: ctx.clock.nowIso(),
          ...(["revoked", "closed"].includes(status) ? { shared: false } : {}),
        },
        "id=?",
        id,
      );
      return required(id);
    },
    async revoke(id, by) {
      const i = await required(id);
      if (i.userId !== by.userId)
        throw new DennisError("forbidden", "Intent belongs to another user", 403);
      if (i.status === "revoked") return i;
      update(
        ctx.db,
        "intents",
        {
          shared: false,
          status: "revoked",
          revokedAt: ctx.clock.nowIso(),
          updatedAt: ctx.clock.nowIso(),
        },
        "id=?",
        id,
      );
      ctx.events.emit({
        type: "intent.revoked",
        actor: { kind: "agent", agentId: i.agentId },
        visibility: "shared",
        payload: {
          intentId: id,
          agentId: i.agentId,
          reason: "consent_or_owner_revoked",
        },
      });
      return required(id);
    },
  };
}
export function createOpportunityStore(ctx: PlatformContext): OpportunityStore {
  async function get(id: string) {
    return row<OpportunityT>(ctx.db, "SELECT * FROM opportunities WHERE id=?", id);
  }
  return {
    get,
    async upsert(input) {
      const old = row<OpportunityT>(
        ctx.db,
        "SELECT * FROM opportunities WHERE type=? AND domain_ref_id=?",
        input.type,
        input.domainRefId,
      );
      const now = ctx.clock.nowIso();
      const value = Opportunity.parse({
        ...input,
        id: old?.id ?? ctx.ids.next("opportunity"),
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      });
      if (old) update(ctx.db, "opportunities", value, "id=?", old.id);
      else insert(ctx.db, "opportunities", value);
      ctx.events.emit({
        type: "opportunity.updated",
        actor: {
          kind: "system",
          ...(value.type === "shortme_market" &&
          ["proposed", "declined", "expired"].includes(value.status)
            ? { agentId: value.participantAgentIds[0] }
            : {}),
        },
        visibility:
          value.type === "shortme_market" &&
          ["proposed", "declined", "expired"].includes(value.status)
            ? "private"
            : "shared",
        opportunityId: value.id,
        payload: {
          opportunityId: value.id,
          type: value.type,
          status: value.status,
          headline: value.headline,
        },
      });
      return value;
    },
    async list(filter) {
      return rows<OpportunityT>(
        ctx.db,
        "SELECT * FROM opportunities WHERE (? IS NULL OR type=?) ORDER BY created_at DESC",
        filter?.type ?? null,
        filter?.type ?? null,
      )
        .filter(
          (o) =>
            !filter?.viewerAgentId ||
            (o.type === "shortme_market" && ["proposed", "declined", "expired"].includes(o.status)
              ? o.participantAgentIds[0] === filter.viewerAgentId
              : o.participantAgentIds.includes(filter.viewerAgentId)),
        )
        .slice(0, Math.min(filter?.limit ?? 50, 200));
    },
  };
}
export function agentScope(ctx: PlatformContext, agentId: string) {
  return {
    intents: {
      list: (filter?: Parameters<IntentStore["listByAgent"]>[1]) =>
        ctx.intents.listByAgent(agentId, filter),
      async get(id: string) {
        const i = await ctx.intents.get(id);
        if (i?.agentId !== agentId) return null;
        return i;
      },
      listShared: (kind: "purchase" | "milestone") =>
        ctx.intents.listShared({ kind, excludeAgentId: agentId }),
    },
    events: {
      history: (q?: { sinceSeq?: number; limit?: number }) =>
        ctx.events.history({ ...q, viewerAgentId: agentId }),
      subscribe: (listener: Parameters<typeof ctx.events.subscribe>[1]) =>
        ctx.events.subscribe({ viewerAgentId: agentId }, listener),
    },
  };
}

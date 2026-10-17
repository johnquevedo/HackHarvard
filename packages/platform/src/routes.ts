import { verifyPhotonWebhook, normalizePhotonEvent } from "@dennis/messaging";
import type { Hono, Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  DennisError,
  SettingsRequest,
  PauseRequest,
  ConsentRequest,
  UserIdRequest,
  ApprovalDecisionRequest,
  SimInboundRequest,
  ConsentScope,
  IntentKind,
  OpportunityType,
  ApprovalStatus,
  Agent,
  ApiErrorBody,
} from "@dennis/contracts";
import type {
  UserT,
  IntentT,
  OutboxRecordT,
  ApprovalT,
  OpportunityT,
  A2AMessage,
} from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { row, rows, update } from "./storage.ts";
import { ingestInbound } from "./pipeline.ts";
import { forgetUser } from "./commands.ts";
async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new DennisError("validation_error", "Malformed JSON body", 400);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new DennisError(
      "validation_error",
      "Invalid request",
      400,
      parsed.error.issues,
    );
  return parsed.data;
}
function limit(c: Context): number {
  return z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .parse(c.req.query("limit") ?? 50);
}
function since(c: Context): number {
  return z.coerce
    .number()
    .int()
    .nonnegative()
    .parse(c.req.query("sinceSeq") ?? c.req.header("Last-Event-ID") ?? 0);
}
export function mountPlatformRoutes(app: Hono, ctx: PlatformContext): void {
  function admin(c: Context) {
    if (c.req.header("x-dennis-admin") !== ctx.config.dennisAdminToken)
      throw new DennisError("unauthorized", "Admin token required", 401);
  }
  async function viewer(c: Context) {
    const id = c.req.query("viewerAgentId");
    if (!id) {
      admin(c);
      return { judge: true };
    }
    if (!(await ctx.users.getAgent(id)))
      throw new DennisError("not_found", "Viewer agent not found", 404);
    return { viewerAgentId: id };
  }
  async function userSummary(id: string) {
    const user = await ctx.users.get(id);
    const agent = await ctx.users.getAgentByUserId(id);
    if (!user || !agent)
      throw new DennisError("not_found", "User not found", 404);
    const consents = {} as Record<z.infer<typeof ConsentScope>, boolean>;
    for (const scope of ConsentScope.options)
      consents[scope] = await ctx.consent.has(id, scope);
    return {
      user: { ...user, handle: "***" + user.handle.slice(-4) },
      agent,
      consents,
      pendingApprovals: (await ctx.approvals.findPending(id, null)).length,
    };
  }
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        ApiErrorBody.parse({
          error: {
            code: "validation_error",
            message: "Invalid request",
            details: error.issues,
          },
        }),
        400,
      );
    if (error instanceof DennisError)
      return c.json(
        ApiErrorBody.parse({
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        }),
        error.status as 400,
      );
    ctx.log.error("Unhandled request failure");
    return c.json(
      { error: { code: "internal", message: "Internal server error" } },
      500,
    );
  });
  app.get("/api/health", (c) => {
    ctx.db.$client.prepare("SELECT 1").get();
    return c.json({
      status: "ok",
      time: ctx.clock.nowIso(),
      dbOk: true,
      modes: {
        photon:
          ctx.integrations.list().find((s) => s.name === "photon")?.mode ??
          "fallback",
        llm:
          ctx.integrations.list().find((s) => s.name === "llm")?.mode ??
          "fallback",
        nessie:
          ctx.integrations.list().find((s) => s.name === "nessie")?.mode ??
          "fallback",
      },
    });
  });
  app.get("/api/integrations", (c) => c.json(ctx.integrations.list()));
  app.get("/api/users", async (c) =>
    c.json(
      await Promise.all(
        rows<UserT>(ctx.db, "SELECT * FROM users ORDER BY created_at").map(
          (u) => userSummary(u.id),
        ),
      ),
    ),
  );
  app.get("/api/users/:userId", async (c) =>
    c.json(await userSummary(c.req.param("userId"))),
  );
  app.patch("/api/agents/:agentId/settings", async (c) => {
    const a = await ctx.users.getAgent(c.req.param("agentId"));
    if (!a) throw new DennisError("not_found", "Agent not found", 404);
    const settings = await body(c, SettingsRequest);
    update(
      ctx.db,
      "agents",
      { settings: { ...a.settings, ...settings } },
      "id=?",
      a.id,
    );
    return c.json(Agent.parse(await ctx.users.getAgent(a.id)));
  });
  app.post("/api/agents/:agentId/pause", async (c) => {
    const a = await ctx.users.getAgent(c.req.param("agentId"));
    if (!a) throw new DennisError("not_found", "Agent not found", 404);
    const { paused } = await body(c, PauseRequest);
    const status = paused ? "paused" : "active";
    update(ctx.db, "agents", { status }, "id=?", a.id);
    ctx.events.emit({
      type: "agent.status_changed",
      actor: { kind: "agent", agentId: a.id },
      visibility: "private",
      payload: { agentId: a.id, status },
    });
    return c.json(Agent.parse(await ctx.users.getAgent(a.id)));
  });
  async function consentState(
    userId: string,
    scope: z.infer<typeof ConsentScope>,
  ) {
    const latest = row<{ status: string; createdAt: string; via: string }>(
      ctx.db,
      "SELECT * FROM consents WHERE user_id=? AND scope=? ORDER BY id DESC LIMIT 1",
      userId,
      scope,
    );
    return {
      scope,
      granted: latest?.status === "granted",
      updatedAt: latest?.createdAt ?? ctx.clock.nowIso(),
      via: latest?.via ?? "none",
    };
  }
  app.get("/api/consents", async (c) => {
    const id = z.string().min(1).parse(c.req.query("userId"));
    if (!(await ctx.users.get(id)))
      throw new DennisError("not_found", "User not found", 404);
    return c.json(
      await Promise.all(ConsentScope.options.map((s) => consentState(id, s))),
    );
  });
  app.post("/api/consents", async (c) => {
    const input = await body(c, ConsentRequest);
    await ctx.consent.set({ ...input, via: "dashboard" });
    return c.json(await consentState(input.userId, input.scope));
  });
  app.post("/api/privacy/forget", async (c) =>
    c.json(await forgetUser(ctx, (await body(c, UserIdRequest)).userId)),
  );
  app.get("/api/intents", async (c) => {
    const lens = await viewer(c);
    const requested = c.req.query("agentId");
    const kind = c.req.query("kind");
    if (kind) IntentKind.parse(kind);
    if (lens.viewerAgentId && requested && requested !== lens.viewerAgentId)
      throw new DennisError(
        "forbidden",
        "Private intents belong to their owner",
        403,
      );
    const id = lens.viewerAgentId ?? requested;
    const values = rows<IntentT>(
      ctx.db,
      "SELECT * FROM intents WHERE (? IS NULL OR agent_id=?) AND (? IS NULL OR kind=?) ORDER BY created_at DESC LIMIT ?",
      id ?? null,
      id ?? null,
      kind ?? null,
      kind ?? null,
      limit(c),
    );
    return c.json(values);
  });
  app.post("/api/intents/:intentId/revoke", async (c) =>
    c.json(
      await ctx.intents.revoke(
        c.req.param("intentId"),
        await body(c, UserIdRequest),
      ),
    ),
  );
  app.get("/api/events", async (c) => {
    const lens = await viewer(c);
    const events = ctx.events.history({
      ...lens,
      sinceSeq: since(c),
      limit: limit(c),
    });
    return c.json({ events, lastSeq: events.at(-1)?.seq ?? since(c) });
  });
  app.get("/api/events/stream", async (c) => {
    const lens = await viewer(c);
    let cursor = since(c);
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      let closed = false;
      const queue: ReturnType<typeof ctx.events.history> = [];
      let wake: () => void = () => {};
      const unsubscribe = ctx.events.subscribe(lens, (e) => {
        queue.push(e);
        wake();
      });
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
        wake();
      });
      try {
        // Subscribe before replay and deduplicate by sequence to close the replay/live race.
        while (!closed) {
          const history = ctx.events.history({
            ...lens,
            sinceSeq: cursor,
            limit: 200,
          });
          if (!history.length) break;
          for (const e of history) {
            await stream.writeSSE({
              event: "domain",
              id: String(e.seq),
              data: JSON.stringify(e),
            });
            cursor = e.seq;
          }
          if (history.length < 200) break;
        }
        while (!closed) {
          while (queue.length) {
            const e = queue.shift()!;
            if (e.seq <= cursor) continue;
            await stream.writeSSE({
              event: "domain",
              id: String(e.seq),
              data: JSON.stringify(e),
            });
            cursor = e.seq;
          }
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 15000);
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
            if (closed || queue.length) wake();
          });
          if (!closed && !queue.length) await stream.write(": heartbeat\n\n");
        }
      } finally {
        unsubscribe();
      }
    });
  });
  app.get("/api/a2a", (c) => {
    admin(c);
    const conversation = c.req.query("conversationId");
    const opportunity = c.req.query("opportunityId");
    const result = rows<A2AMessage>(
      ctx.db,
      "SELECT * FROM a2a_messages WHERE (? IS NULL OR conversation_id=?) AND (? IS NULL OR opportunity_id=?) ORDER BY created_at LIMIT ?",
      conversation ?? null,
      conversation ?? null,
      opportunity ?? null,
      opportunity ?? null,
      limit(c),
    );
    return c.json(
      result.map(
        ({
          id,
          type,
          fromAgentId,
          toAgentId,
          conversationId,
          opportunityId,
          payload,
          createdAt,
        }) => ({
          id,
          type,
          fromAgentId,
          toAgentId,
          conversationId,
          opportunityId,
          payload,
          createdAt,
        }),
      ),
    );
  });
  app.get("/api/approvals", (c) => {
    const userId = z.string().min(1).parse(c.req.query("userId"));
    const status = c.req.query("status");
    if (status) ApprovalStatus.parse(status);
    return c.json(
      rows<ApprovalT>(
        ctx.db,
        "SELECT * FROM approvals WHERE user_id=? AND (? IS NULL OR status=?) ORDER BY created_at DESC LIMIT ?",
        userId,
        status ?? null,
        status ?? null,
        limit(c),
      ).map(
        ({
          idempotencyKey: _,
          ...a
        }: ApprovalT & { idempotencyKey?: string }) => a,
      ),
    );
  });
  app.post("/api/approvals/:approvalId/decision", async (c) =>
    c.json(
      await ctx.approvals.decide({
        ...(await body(c, ApprovalDecisionRequest)),
        approvalId: c.req.param("approvalId"),
        via: "dashboard_fallback",
      }),
    ),
  );
  app.get("/api/outbox", (c) =>
    c.json(
      rows<OutboxRecordT>(
        ctx.db,
        "SELECT * FROM outbox WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
        z.string().min(1).parse(c.req.query("userId")),
        limit(c),
      ).map(
        ({
          idempotencyKey: _,
          ...o
        }: OutboxRecordT & { idempotencyKey?: string }) => o,
      ),
    ),
  );
  app.get("/api/opportunities", async (c) => {
    const type = c.req.query("type");
    if (type) OpportunityType.parse(type);
    const viewerId = c.req.query("viewerAgentId");
    const values = await ctx.opportunities.list({
      type: type as z.infer<typeof OpportunityType> | undefined,
      viewerAgentId: viewerId,
      limit: limit(c),
    });
    return c.json(
      values.filter(
        (o) =>
          o.type !== "shortme_market" ||
          !["proposed", "declined", "expired"].includes(o.status) ||
          o.participantAgentIds[0] === (viewerId ?? "") ||
          c.req.header("x-dennis-admin") === ctx.config.dennisAdminToken,
      ),
    );
  });
  app.get("/api/opportunities/:id", async (c) => {
    const value = await ctx.opportunities.get(c.req.param("id"));
    if (!value)
      throw new DennisError("not_found", "Opportunity not found", 404);
    const viewerId = c.req.query("viewerAgentId");
    if (
      ["proposed", "declined", "expired"].includes(value.status) &&
      value.type === "shortme_market" &&
      value.participantAgentIds[0] !== (viewerId ?? "") &&
      c.req.header("x-dennis-admin") !== ctx.config.dennisAdminToken
    )
      throw new DennisError("not_found", "Opportunity not found", 404);
    return c.json(value);
  });
  app.get("/api/opportunities/:id/explain", async (c) => {
    const id = c.req.param("id");
    const opportunity = await ctx.opportunities.get(id);
    if (!opportunity)
      throw new DennisError("not_found", "Opportunity not found", 404);
    const lens = await viewer(c);
    if (
      lens.viewerAgentId &&
      !opportunity.participantAgentIds.includes(lens.viewerAgentId)
    )
      throw new DennisError("not_found", "Opportunity not found", 404);
    const events = ctx.events
      .history({ ...lens, limit: 200 })
      .filter((e) => e.opportunityId === id);
    return c.json({
      opportunityId: id,
      steps: events.map((e) => ({
        seq: e.seq,
        ts: e.ts,
        type: e.type,
        ...(e.actor.agentId ? { agentId: e.actor.agentId } : {}),
        summary: e.type,
        ...(Array.isArray(e.payload.checks)
          ? { checks: e.payload.checks }
          : {}),
      })),
    });
  });
  app.post("/api/sim/inbound", async (c) => {
    admin(c);
    if (ctx.messaging.name !== "sim")
      throw new DennisError(
        "invalid_state",
        "Simulator provider is not active",
        409,
      );
    const input = await body(c, SimInboundRequest);
    const user = await ctx.users.get(input.fromUserId);
    if (!user) throw new DennisError("not_found", "User not found", 404);
    const result = await ingestInbound(ctx, {
      provider: "sim",
      accountKey: ctx.config.photonAccountKey,
      providerMessageId: input.clientMessageId ?? ctx.ids.next("message"),
      providerSpaceId: null,
      providerSenderId: null,
      senderHandle: user.handle,
      text: input.text,
      receivedAt: ctx.clock.nowIso(),
      mode: "simulated",
    });
    return c.json({
      messageId: result.messageId,
      accepted: result.outcome !== "ignored",
    });
  });
  app.get("/api/sim/thread", async (c) => {
    const id = z.string().min(1).parse(c.req.query("userId"));
    if (!(await ctx.users.get(id)))
      throw new DennisError("not_found", "User not found", 404);
    const incoming = rows<{ text: string; receivedAt: string; status: string }>(
      ctx.db,
      "SELECT text,received_at,status FROM inbound_messages WHERE user_id=? AND text IS NOT NULL",
      id,
    ).map((m) => ({
      direction: "in" as const,
      text: m.text,
      ts: m.receivedAt,
      status: m.status,
    }));
    const outgoing = rows<OutboxRecordT>(
      ctx.db,
      "SELECT * FROM outbox WHERE user_id=?",
      id,
    ).map((m) => ({
      direction: "out" as const,
      text: m.text,
      ts: m.createdAt,
      status: m.status,
    }));
    return c.json({
      messages: [...incoming, ...outgoing].sort((a, b) =>
        a.ts.localeCompare(b.ts),
      ),
    });
  });
  app.post("/webhooks/photon", async (c) => {
    if (!ctx.config.photonWebhookSecret || !ctx.config.photonAgentUserId)
      throw new DennisError(
        "integration_unavailable",
        "Photon webhook is not configured",
        503,
      );
    const raw = await c.req.text();
    const headers = {
      "webhook-id": c.req.header("webhook-id") ?? "",
      "webhook-timestamp": c.req.header("webhook-timestamp") ?? "",
      "webhook-signature": c.req.header("webhook-signature") ?? "",
    };
    const event = verifyPhotonWebhook(
      raw,
      headers,
      ctx.config.photonWebhookSecret,
    );
    return ctx.runExclusive("webhook:" + headers["webhook-id"], async () => {
      const key = "webhook:" + headers["webhook-id"];
      if (row(ctx.db, "SELECT key FROM photon_cursors WHERE key=?", key))
        return c.json({ ok: true });
      const message = normalizePhotonEvent(
        event,
        ctx.config.photonAgentUserId!,
      );
      if (message)
        await ingestInbound(ctx, {
          ...message,
          accountKey: ctx.config.photonAccountKey,
        });
      ctx.db.$client
        .prepare(
          "INSERT INTO photon_cursors (key,value,updated_at) VALUES (?,?,?)",
        )
        .run(key, "seen", ctx.clock.nowIso());
      return c.json({ ok: true });
    });
  });
}

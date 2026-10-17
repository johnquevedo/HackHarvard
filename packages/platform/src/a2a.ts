import { A2A_PAYLOAD_SCHEMAS, DennisError, hashPayload } from "@dennis/contracts";
import type { A2ABus, A2AHandler, A2AMessage } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { insert, row, rows, update } from "./storage.ts";
const deliveries = new WeakMap<PlatformContext, (id: string) => Promise<void>>();
export function createA2ABus(ctx: PlatformContext): A2ABus {
  const handlers = new Map<string, A2AHandler[]>();
  async function deliver(id: string): Promise<void> {
    const message = row<A2AMessage & { status: string }>(
      ctx.db,
      "SELECT * FROM a2a_messages WHERE id=?",
      id,
    );
    if (!message || message.status !== "queued") return;
    await ctx.runExclusive("a2a:" + message.toAgentId, async () => {
      const latest = row<{ status: string }>(
        ctx.db,
        "SELECT status FROM a2a_messages WHERE id=?",
        id,
      );
      if (latest?.status !== "queued") return;
      const registered = handlers.get(message.type);
      if (!registered?.length) return;
      try {
        for (const handler of registered) await handler(message);
        update(
          ctx.db,
          "a2a_messages",
          { status: "handled", handledAt: ctx.clock.nowIso() },
          "id=?",
          id,
        );
        ctx.events.emit({
          type: "a2a.handled",
          actor: { kind: "agent", agentId: message.toAgentId },
          visibility: "shared",
          payload: {
            a2aId: id,
            type: message.type,
            toAgentId: message.toAgentId,
            ok: true,
          },
        });
      } catch {
        update(
          ctx.db,
          "a2a_messages",
          {
            status: "failed",
            error: "handler_failed",
            handledAt: ctx.clock.nowIso(),
          },
          "id=?",
          id,
        );
        ctx.events.emit({
          type: "a2a.handled",
          actor: { kind: "agent", agentId: message.toAgentId },
          visibility: "shared",
          payload: {
            a2aId: id,
            type: message.type,
            toAgentId: message.toAgentId,
            ok: false,
            error: "handler_failed",
          },
        });
      }
    });
  }
  deliveries.set(ctx, deliver);
  return {
    async send(input) {
      const schema = A2A_PAYLOAD_SCHEMAS[input.type];
      if (!schema) throw new DennisError("validation_error", "Unknown A2A type", 400);
      const result = schema.safeParse(input.payload);
      if (!result.success)
        throw new DennisError("validation_error", "Invalid A2A payload", 400, result.error.issues);
      for (const id of [input.fromAgentId, input.toAgentId])
        if (!(await ctx.users.getAgent(id)))
          throw new DennisError("not_found", "A2A agent not found", 404);
      const previous = row<A2AMessage>(
        ctx.db,
        "SELECT * FROM a2a_messages WHERE idempotency_key=?",
        input.idempotencyKey,
      );
      if (previous) {
        if (
          previous.type !== input.type ||
          previous.fromAgentId !== input.fromAgentId ||
          previous.toAgentId !== input.toAgentId ||
          previous.conversationId !== input.conversationId ||
          previous.opportunityId !== (input.opportunityId ?? null) ||
          hashPayload(previous.payload) !== hashPayload(input.payload)
        )
          throw new DennisError("idempotency_conflict", "A2A key reused with different input", 409);
        return previous;
      }
      const value: A2AMessage = {
        id: ctx.ids.next("a2a"),
        type: input.type,
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId,
        conversationId: input.conversationId,
        opportunityId: input.opportunityId ?? null,
        payload: result.data,
        createdAt: ctx.clock.nowIso(),
      };
      insert(ctx.db, "a2a_messages", {
        ...value,
        status: "queued",
        error: null,
        causedByEventId: null,
        idempotencyKey: input.idempotencyKey,
        handledAt: null,
      });
      ctx.events.emit({
        type: "a2a.sent",
        actor: { kind: "agent", agentId: input.fromAgentId },
        visibility: "shared",
        ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
        payload: {
          a2aId: value.id,
          conversationId: value.conversationId,
          type: value.type,
          fromAgentId: value.fromAgentId,
          toAgentId: value.toAgentId,
          payload: value.payload,
        },
      });
      queueMicrotask(() => {
        void deliver(value.id).catch(() => ctx.log.error("A2A delivery failed"));
      });
      return value;
    },
    on(type, handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
    async listConversation(conversationId) {
      return rows<A2AMessage>(
        ctx.db,
        "SELECT * FROM a2a_messages WHERE conversation_id=? ORDER BY created_at,id",
        conversationId,
      ).map(
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
      );
    },
  };
}
export async function recoverA2A(ctx: PlatformContext): Promise<void> {
  for (const { id } of rows<{ id: string }>(
    ctx.db,
    "SELECT id FROM a2a_messages WHERE status='queued' ORDER BY created_at",
  ))
    await deliveries.get(ctx)?.(id);
}

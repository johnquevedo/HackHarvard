import {
  DomainEvent,
  NewEvent,
  EVENT_PAYLOAD_SCHEMAS,
  A2A_PAYLOAD_SCHEMAS,
  DennisError,
  PurchaseIntentPublic,
} from "@dennis/contracts";
import type { EventBus, EventListener, Clock, IdFactory } from "@dennis/contracts";
import type { Db } from "@dennis/db";
import { insert, row, rows } from "./storage.ts";
const PRIVATE_TEXT_FIELDS = new Set([
  "text",
  "preview",
  "summary",
  "rationale",
  "detail",
  "headline",
  "question",
]);
export function redactPrivateText(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      PRIVATE_TEXT_FIELDS.has(key) && typeof child === "string" ? "[forgotten]" : child,
    ]),
  );
}
function privateEventKey(agentId: string, eventId: string): string {
  return "private-event:" + agentId + ":" + eventId;
}
type Filter = { viewerAgentId?: string; judge?: boolean };
function assertSharedSafe(payload: unknown): void {
  const forbidden = new Set([
    "sourceExcerpt",
    "sourceMessageId",
    "privatePayload",
    "senderHandle",
    "handle",
    "productText",
    "userId",
  ]);
  function scan(value: unknown): void {
    if (
      typeof value === "string" &&
      (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(value) ||
        /\+[1-9]\d{7,14}/.test(value))
    )
      throw new DennisError("internal", "Shared event contains a handle", 500);
    if (Array.isArray(value)) {
      for (const child of value) scan(child);
      return;
    }
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.has(key))
          throw new DennisError("internal", "Shared event contains a private field", 500);
        scan(child);
      }
  }
  scan(payload);
}
export function createEventBus(db: Db, clock: Clock, ids: IdFactory): EventBus {
  const listeners = new Set<{ filter: Filter; listener: EventListener }>();
  function visible(event: ReturnType<typeof DomainEvent.parse>, filter: Filter): boolean {
    return (
      filter.judge === true ||
      event.visibility !== "private" ||
      (!!filter.viewerAgentId && event.actor.agentId === filter.viewerAgentId)
    );
  }
  function read(q: Parameters<EventBus["history"]>[0]) {
    const limit = Math.max(1, Math.min(q.limit ?? 50, 200));
    const raw = rows<Record<string, unknown>>(
      db,
      "SELECT * FROM events WHERE seq > ? AND (? = 1 OR visibility != 'private' OR actor_agent_id = ?) ORDER BY seq LIMIT ?",
      q.sinceSeq ?? 0,
      Number(q.judge === true),
      q.viewerAgentId ?? null,
      limit,
    );
    return raw.map((r) =>
      DomainEvent.parse({
        seq: r.seq,
        id: r.id,
        ts: r.ts,
        type: r.type,
        actor: {
          kind: r.actorKind,
          ...(r.actorAgentId ? { agentId: r.actorAgentId } : {}),
          ...(r.actorUserId ? { userId: r.actorUserId } : {}),
        },
        visibility: r.visibility,
        opportunityId: r.opportunityId,
        traceId: r.traceId,
        mode: r.providerMode,
        payload:
          r.visibility === "private" && r.actorAgentId
            ? (row<{ value: Record<string, unknown> }>(
                db,
                "SELECT value FROM kv WHERE key=?",
                privateEventKey(String(r.actorAgentId), String(r.id)),
              )?.value ?? r.payload)
            : r.payload,
      }),
    );
  }
  return {
    emit(input) {
      const e = NewEvent.parse(input);
      const schema = EVENT_PAYLOAD_SCHEMAS[e.type as keyof typeof EVENT_PAYLOAD_SCHEMAS];
      if (!schema) throw new DennisError("internal", "Unknown event type", 500);
      if (e.visibility === "shared") assertSharedSafe(e.payload);
      const parsed = schema.safeParse(e.payload);
      if (!parsed.success)
        throw new DennisError(
          "internal",
          "Invalid event payload: " + e.type,
          500,
          parsed.error.issues,
        );
      if (e.type === "a2a.sent") {
        const payloadSchema =
          A2A_PAYLOAD_SCHEMAS[e.payload.type as keyof typeof A2A_PAYLOAD_SCHEMAS];
        if (!payloadSchema?.safeParse(e.payload.payload).success)
          throw new DennisError("internal", "Invalid shared A2A payload", 500);
      }
      if (
        e.visibility === "shared" &&
        [
          "message.received",
          "command.handled",
          "intent.detected",
          "intent.rejected",
          "approval.requested",
          "approval.decided",
          "outbox.queued",
          "outbox.updated",
          "messaging.latency",
          "purchase.payment.updated",
        ].includes(e.type)
      )
        throw new DennisError("internal", "Private event cannot be shared", 500);
      if (
        e.visibility === "shared" &&
        e.type === "shortme.market.updated" &&
        ["proposed", "declined", "expired"].includes(String(e.payload.status))
      )
        throw new DennisError("internal", "Market draft is private", 500);
      if (
        e.visibility === "shared" &&
        e.type === "opportunity.updated" &&
        e.payload.type === "shortme_market" &&
        ["proposed", "declined", "expired"].includes(String(e.payload.status))
      )
        throw new DennisError("internal", "Unpublished market opportunity is private", 500);
      if (e.type === "intent.registered") PurchaseIntentPublic.parse(e.payload.publicPayload);
      if (e.visibility === "private" && !e.actor.agentId)
        throw new DennisError("internal", "Private event requires an agent", 500);
      const data = {
        id: ids.next("event"),
        ts: clock.nowIso(),
        type: e.type,
        actorKind: e.actor.kind,
        actorAgentId: e.actor.agentId ?? null,
        actorUserId: e.actor.userId ?? null,
        visibility: e.visibility,
        opportunityId: e.opportunityId ?? null,
        traceId: e.traceId ?? ids.next("trace"),
        providerMode: e.mode ?? null,
        payload: parsed.data,
      };
      // Keep the immutable audit row free of private prose. The removable overlay
      // preserves owner history until FORGET without rewriting the event log.
      const seq = db.$client.transaction(() => {
        insert(db, "events", {
          ...data,
          payload: e.visibility === "private" ? redactPrivateText(data.payload) : data.payload,
        });
        const inserted = (
          db.$client.prepare("SELECT last_insert_rowid() AS seq").get() as { seq: number }
        ).seq;
        if (e.visibility === "private" && e.actor.agentId)
          insert(db, "kv", { key: privateEventKey(e.actor.agentId, data.id), value: data.payload });
        return Number(inserted);
      })();
      const event = DomainEvent.parse({
        ...e,
        ...data,
        seq,
        actor: e.actor,
        mode: data.providerMode,
      });
      for (const item of listeners)
        if (visible(event, item.filter)) {
          try {
            item.listener(event);
          } catch {
            /* A subscriber cannot roll back a committed event. */
          }
        }
      return event;
    },
    history: read,
    subscribe(filter, listener) {
      const item = { filter, listener };
      listeners.add(item);
      return () => {
        listeners.delete(item);
      };
    },
  };
}

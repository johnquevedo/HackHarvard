import { hashPayload, DennisError } from "@dennis/contracts";
import type { Clock } from "@dennis/contracts";
import type { Db } from "@dennis/db";
import { redactPrivateText } from "./events.ts";
interface LegacyEvent {
  id: string;
  actor_agent_id: string;
  payload: string;
}
function legacyEvents(db: Db) {
  return (
    db.$client
      .prepare(
        "SELECT id,actor_agent_id,payload FROM events WHERE visibility='private' AND actor_agent_id IS NOT NULL ORDER BY seq",
      )
      .all() as LegacyEvent[]
  )
    .map((event) => ({ ...event, original: JSON.parse(event.payload) as Record<string, unknown> }))
    .filter(
      (event) => hashPayload(event.original) !== hashPayload(redactPrivateText(event.original)),
    );
}
export function planLegacyPrivacyMigration(db: Db) {
  const events = legacyEvents(db);
  return {
    rewriteRequired: events.length,
    affectedAgents: new Set(events.map((e) => e.actor_agent_id)).size,
    policyException: "One-time rewrite of legacy private prose in otherwise immutable audit rows",
    applied: false,
  };
}
export function applyLegacyPrivacyMigration(
  db: Db,
  clock: Clock,
  options: { allowAuditPayloadRewrite: boolean },
) {
  if (options.allowAuditPayloadRewrite !== true)
    throw new DennisError(
      "forbidden",
      "Explicit legacy audit-payload rewrite authorization is required",
      403,
    );
  return db.$client.transaction(() => {
    const events = legacyEvents(db);
    for (const event of events) {
      const redacted = redactPrivateText(event.original);
      const key = "private-event:" + event.actor_agent_id + ":" + event.id;
      // Never overwrite an existing removable overlay with different content.
      const previous = db.$client.prepare("SELECT value FROM kv WHERE key=?").get(key) as
        { value: string } | undefined;
      if (previous && hashPayload(JSON.parse(previous.value)) !== hashPayload(event.original))
        throw new DennisError(
          "conflict",
          "Legacy event overlay conflicts with existing private history",
          409,
        );
      db.$client
        .prepare("INSERT OR IGNORE INTO kv(key,value) VALUES(?,?)")
        .run(key, JSON.stringify(event.original));
      db.$client.prepare("INSERT INTO kv(key,value) VALUES(?,?)").run(
        "privacy-migration:" + event.id,
        JSON.stringify({
          originalPayloadHash: hashPayload(event.original),
          redactedPayloadHash: hashPayload(redacted),
          migratedAt: clock.nowIso(),
        }),
      );
      const changed = db.$client
        .prepare("UPDATE events SET payload=? WHERE id=? AND payload=?")
        .run(JSON.stringify(redacted), event.id, event.payload);
      if (changed.changes !== 1)
        throw new DennisError("conflict", "Legacy event changed during migration", 409);
    }
    return { rewritten: events.length, applied: true };
  })();
}

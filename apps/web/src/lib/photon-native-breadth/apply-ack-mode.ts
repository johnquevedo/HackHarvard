import { parseAckMode, type DennisAckMode } from "./flags";

export type SqliteLike = {
  prepare(sql: string): {
    all: (...params: unknown[]) => { id: string; settings: string }[];
    run: (...params: unknown[]) => { changes: number };
  };
};

/** Merge DENNIS_ACK_MODE into an agent settings JSON blob. */
export function mergeAckModeSettings(
  settingsJson: string,
  ackMode: DennisAckMode,
): { next: string; changed: boolean } {
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(settingsJson) as Record<string, unknown>;
  } catch {
    settings = {};
  }
  if (settings.ackMode === ackMode) return { next: settingsJson, changed: false };
  return { next: JSON.stringify({ ...settings, ackMode }), changed: true };
}

/**
 * Upsert ackMode on demo agents so DENNIS_ACK_MODE applies without wiping the DB.
 * Platform seedCore only sets ackMode on first insert.
 */
export function applyAckModeToDemoAgents(db: SqliteLike, ackMode: DennisAckMode): number {
  const rows = db.prepare("SELECT id, settings FROM agents WHERE id LIKE 'agt_demo_%'").all() as {
    id: string;
    settings: string;
  }[];
  let updated = 0;
  const stmt = db.prepare("UPDATE agents SET settings=? WHERE id=?");
  for (const row of rows) {
    const raw = typeof row.settings === "string" ? row.settings : JSON.stringify(row.settings);
    const { next, changed } = mergeAckModeSettings(raw, ackMode);
    if (!changed) continue;
    stmt.run(next, row.id);
    updated += 1;
  }
  return updated;
}

export function applyAckModeFromEnv(
  db: SqliteLike,
  env: Record<string, string | undefined> = process.env,
): { ackMode: DennisAckMode; updated: number } {
  const ackMode = parseAckMode(env.DENNIS_ACK_MODE);
  return { ackMode, updated: applyAckModeToDemoAgents(db, ackMode) };
}

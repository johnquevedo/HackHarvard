import type { Db } from "@dennis/db";
const jsonKeys = new Set([
  "settings",
  "privatePayload",
  "publicPayload",
  "participantAgentIds",
  "payload",
  "value",
  "tiers",
  "redactions",
  "requestJson",
  "responseJson",
  "balancesBefore",
  "balancesAfter",
]);
const boolKeys = new Set(["isDemo", "shared", "canInvite", "isSimulated"]);
function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}
function decode(row: unknown, jsonValue: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    const key = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    result[key] =
      v === null
        ? null
        : jsonKeys.has(key) && (key !== "value" || jsonValue)
          ? JSON.parse(v as string)
          : boolKeys.has(key)
            ? Boolean(v)
            : v;
  }
  return result;
}
export function rows<T>(db: Db, sql: string, ...params: unknown[]): T[] {
  return db.$client
    .prepare(sql)
    .all(...params)
    .map((value) => decode(value, /\b(?:FROM|JOIN)\s+[`"]?kv\b/i.test(sql))) as T[];
}
export function row<T>(db: Db, sql: string, ...params: unknown[]): T | null {
  return rows<T>(db, sql, ...params)[0] ?? null;
}
export function insert(db: Db, table: string, data: Record<string, unknown>): void {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  db.$client
    .prepare(
      `INSERT INTO ${table} (${entries.map(([k]) => snake(k)).join(",")}) VALUES (${entries.map(() => "?").join(",")})`,
    )
    .run(
      ...entries.map(([k, v]) =>
        v === null
          ? null
          : jsonKeys.has(k)
            ? JSON.stringify(v)
            : typeof v === "boolean"
              ? Number(v)
              : v,
      ),
    );
}
export function update(
  db: Db,
  table: string,
  data: Record<string, unknown>,
  where: string,
  ...params: unknown[]
): number {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  return db.$client
    .prepare(
      `UPDATE ${table} SET ${entries.map(([k]) => snake(k) + "=?").join(",")} WHERE ${where}`,
    )
    .run(
      ...entries.map(([k, v]) =>
        v === null
          ? null
          : jsonKeys.has(k)
            ? JSON.stringify(v)
            : typeof v === "boolean"
              ? Number(v)
              : v,
      ),
      ...params,
    ).changes;
}

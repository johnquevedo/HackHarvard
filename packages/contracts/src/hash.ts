import { createHash } from "node:crypto";
export function hashPayload(payload: Record<string, unknown>): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, canonical(v)]),
      );
    if (
      value === undefined ||
      typeof value === "function" ||
      typeof value === "symbol" ||
      typeof value === "bigint" ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      throw new TypeError("Payload must be JSON");
    return value;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(payload)))
    .digest("hex");
}

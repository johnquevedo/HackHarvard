export const SCENARIOS = [
  "E1",
  "E2",
  "E3",
  "E4",
  "E5",
  "E6",
  "E7",
  "E8",
  "E9",
  "E10",
  "E11",
  "E12",
] as const;

const SECRET_KEYS = new Set([
  "handle",
  "text",
  "sourceExcerpt",
  "privatePayload",
  "senderHandle",
  "phone",
]);
const PHONE = /\b\d{3}-\d{3}-\d{4}\b/;

export function findSharedLeaks(event: { visibility: string; payload: unknown }): string[] {
  if (event.visibility !== "shared") return [];
  const leaks: string[] = [];
  const walk = (value: unknown, keyPath: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${keyPath}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const next = keyPath ? `${keyPath}.${key}` : key;
        if (SECRET_KEYS.has(key)) leaks.push(next);
        walk(child, next);
      }
      return;
    }
    if (typeof value === "string" && PHONE.test(value)) leaks.push(keyPath || "value");
  };
  walk(event.payload, "");
  return leaks;
}

export type ParsedCommand =
  | { kind: "agree"; scope: "base" | "shortme" | "payments" }
  | { kind: "stop" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "status" }
  | { kind: "forget" }
  | { kind: "help" }
  | { kind: "approve"; code: string | null }
  | { kind: "decline"; code: string | null }
  | { kind: "back"; points: number; code: string | null }
  | { kind: "fade"; points: number; code: string | null }
  | { kind: "pass"; code: string | null }
  | { kind: "confirm"; code: string | null }
  | { kind: "dispute"; code: string | null }
  | { kind: "none" };
export function parseCommand(text: string): ParsedCommand {
  const normalized = text
    .trim()
    .replace(/[.!?,;:]+$/, "")
    .trim()
    .toLowerCase();
  const parts = normalized.split(/\s+/);
  const first = parts[0];
  if (first === "agree" && parts.length <= 2) {
    const scope = parts[1];
    if (!scope || scope === "shortme" || scope === "payments")
      return {
        kind: "agree",
        scope: scope === "shortme" ? "shortme" : scope === "payments" ? "payments" : "base",
      };
  }
  if (["stop", "pause", "resume", "status", "forget", "help"].includes(normalized))
    return { kind: normalized } as ParsedCommand;
  const aliases: Record<string, string> = {
    yes: "approve",
    y: "approve",
    approve: "approve",
    ok: "approve",
    no: "decline",
    n: "decline",
    decline: "decline",
    pass: "pass",
    confirm: "confirm",
    dispute: "dispute",
  };
  if (first && aliases[first] && parts.length <= 2 && (!parts[1] || /^[a-z0-9]{4}$/.test(parts[1])))
    return { kind: aliases[first], code: parts[1] ?? null } as ParsedCommand;
  if (
    (first === "back" || first === "fade") &&
    parts.length >= 2 &&
    parts.length <= 3 &&
    /^\d+$/.test(parts[1] ?? "") &&
    (!parts[2] || /^[a-z0-9]{4}$/.test(parts[2]))
  ) {
    const points = Number(parts[1]);
    if (Number.isSafeInteger(points) && points >= 1 && points <= 100)
      return { kind: first, points, code: parts[2] ?? null };
  }
  return { kind: "none" };
}

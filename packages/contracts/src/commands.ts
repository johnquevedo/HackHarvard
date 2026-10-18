export type ParsedCommand =
  | { kind: "agree"; scope: "base" | "shortme" | "payments" }
  | { kind: "stop" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "status" }
  | { kind: "forget" }
  | { kind: "help" }
  | { kind: "presence" }
  | { kind: "approve"; code: string | null }
  | { kind: "decline"; code: string | null }
  | { kind: "back"; points: number; code: string | null }
  | { kind: "fade"; points: number; code: string | null }
  | { kind: "pass"; code: string | null }
  | { kind: "confirm"; code: string | null }
  | { kind: "dispute"; code: string | null }
  | { kind: "put"; dollars: number; approve: boolean; code: string | null; alsoDetect?: boolean }
  | { kind: "none" };
export function parseCommand(
  text: string,
  options: { allowNaturalApproval?: boolean; allowDemoPut?: boolean } = {},
): ParsedCommand {
  const allowNaturalApproval = options.allowNaturalApproval ?? true;
  const allowDemoPut = options.allowDemoPut ?? true;
  const commandText = text.replace(/^\s*@?dennis\s*[:,]?\s+/i, "");
  const normalized = commandText
    .trim()
    .replace(/[.!?,;:]+$/, "")
    .trim()
    .toLowerCase();
  const parts = normalized.split(/\s+/);
  const first = parts[0];
  if (
    /^(?:hey\s+)?dennis(?:\s*[,!?]?\s*(?:are\s+you\s+there|you\s+there))?$/.test(normalized) ||
    /^(?:are\s+)?you\s+there(?:\s+dennis)?$/.test(normalized)
  )
    return { kind: "presence" };
  const approvalPhrase = /\b(run it|lowk sure|sure|do it|yeah do it|bet|send it|yes)\b/i;
  const explicitPut = /(?:\bi[’']?ll\s+put\s+|\bput\s+)\$(\d{1,4})\b/i.exec(commandText);
  const bareApprovedAmount = approvalPhrase.test(commandText)
    ? /(?:^|\s)\$(\d{1,4})\b/i.exec(commandText)
    : null;
  const put = /^\s*(?:back|fade)\b/i.test(commandText) ? null : (explicitPut ?? bareApprovedAmount);
  if (put && allowDemoPut) {
    const dollars = Number(put[1]);
    if (Number.isSafeInteger(dollars) && dollars >= 1 && dollars <= 1000) {
      const approve = approvalPhrase.test(commandText);
      const trailing = commandText.slice((put.index ?? 0) + put[0].length);
      const alsoDetect =
        /put/i.test(put[0]) &&
        /\b(i|i'm|im|my|me)\b/i.test(trailing) &&
        /[a-z]{3,}/i.test(trailing);
      return {
        kind: "put",
        dollars,
        approve,
        code: null,
        ...(alsoDetect ? { alsoDetect: true } : {}),
      };
    }
  }
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
    sure: "approve",
    bet: "approve",
    no: "decline",
    n: "decline",
    decline: "decline",
    pass: "pass",
    confirm: "confirm",
    dispute: "dispute",
  };
  if (allowNaturalApproval && /^(?:yeah\s+)?(?:do it|run it|send it)$|^lowk sure$/.test(normalized))
    return { kind: "approve", code: null };
  if (
    first &&
    aliases[first] &&
    parts.length <= 2 &&
    (!parts[1] || /^[a-z0-9]{4}$/.test(parts[1])) &&
    (Boolean(parts[1]) || allowNaturalApproval || !["approve", "decline"].includes(aliases[first]!))
  )
    return { kind: aliases[first], code: parts[1] ?? null } as ParsedCommand;
  if (
    (first === "back" || first === "fade") &&
    parts.length >= 2 &&
    parts.length <= 3 &&
    /^\$?\d+$/.test(parts[1] ?? "") &&
    (!parts[2] || /^[a-z0-9]{4}$/.test(parts[2]))
  ) {
    const points = Number(parts[1]!.replace(/^\$/, ""));
    if (Number.isSafeInteger(points) && points >= 1 && points <= 1000)
      return { kind: first, points, code: parts[2] ?? null };
  }
  return { kind: "none" };
}

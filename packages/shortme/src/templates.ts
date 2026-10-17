// ShortMe copy in Dennis's group-chat voice: lowercase, short, a little unhinged, never preachy.
// Names, amounts, and codes are inserted by code, never by the LLM. Every `{code}` stays literal for
// the approval service to fill. Amounts are shown in sim dollars: 1 ledger point = GATES.dollarsPerPoint.
import { GATES } from "./rules";

export const TEMPLATE_VERSION = "v2";
export const SIM_MONEY_NOTE = "(sim $, no real money moved)";

export function dollars(points: number): string {
  return `$${(points * GATES.dollarsPerPoint).toLocaleString("en-US")}`;
}

export function signedDollars(points: number): string {
  if (points === 0) return "$0";
  return points > 0 ? `+${dollars(points)}` : `-${dollars(-points)}`;
}

// Whole sim dollars to ledger points; null unless it is a positive multiple of dollarsPerPoint.
export function dollarsToPoints(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const pts = amount / GATES.dollarsPerPoint;
  return Number.isInteger(pts) ? pts : null;
}

export function voiceName(first: string): string {
  return first.toLowerCase();
}

// Dennis's opener when it spots a ShortMe moment. Approving publishes; the trailing code is only
// needed when the person has more than one thing pending.
export function publishMarketPrompt(p: {
  first: string;
  question: string;
  category: string;
  names: string[];
}): string {
  if (p.category === "dating") {
    return "ur chopped, thats a high risk asset. wanna open a market on whether or not she ghosts you? ({code})";
  }
  return `Yo ${voiceName(p.first)} why don't you short yourself, i'll set up a market. Anyone wanna get in on this? ({code})`;
}

// Posted once the market is live. Mentions the subject's own stake when they put money in.
export function marketCreatedText(p: {
  question: string;
  subjectStakePoints: number | null;
  category: string;
}): string {
  if (p.subjectStakePoints && p.subjectStakePoints > 0) {
    const what = p.category === "dating" ? "on the line" : "insurance for sale";
    return `Market created: "${p.question}" ${dollars(p.subjectStakePoints)} ${what}`;
  }
  return `Market created: "${p.question}" Anyone wanna get in on this?`;
}

// 1:1 invite for a friend whose agent got the market over A2A (used until group chats land).
export function marketInviteText(p: {
  subjectFirst: string;
  question: string;
  points: number;
  code: string;
}): string {
  const s = voiceName(p.subjectFirst);
  return `${s}'s got a market: "${p.question}" you've got ${dollars(p.points)} sim to play. BACK $200 ${p.code} if ${s} makes it, FADE $200 ${p.code} if not, or PASS ${p.code}.`;
}

export function stakeRecordedText(p: {
  first: string;
  subjectFirst: string;
  side: "back" | "fade";
  points: number;
  isSubject: boolean;
}): string {
  const who = voiceName(p.first);
  if (p.isSubject && p.side === "fade")
    return `${who} bought ${dollars(p.points)} of insurance on themself. respect.`;
  if (p.side === "back")
    return `${who}'s in for ${dollars(p.points)} backing ${voiceName(p.subjectFirst)}.`;
  return `${who} put ${dollars(p.points)} against ${voiceName(p.subjectFirst)}. cold.`;
}

export function confirmResolutionPrompt(p: { question: string; outcome: "yes" | "no" }): string {
  return `results are in for "${p.question}": ${p.outcome.toUpperCase()}. CONFIRM {code} to settle or DISPUTE {code} if that's cap.`;
}

export function outcomeSentence(p: {
  subjectFirst: string;
  outcome: "yes" | "no" | "void";
}): string {
  const s = voiceName(p.subjectFirst);
  if (p.outcome === "void") return `market on ${s} is void, everyone got their money back.`;
  return p.outcome === "yes" ? `${s} did it.` : `${s} took the L.`;
}

export function disputeText(question: string): string {
  return `"${question}" is disputed. payouts frozen till an admin sorts it out. ${SIM_MONEY_NOTE}`;
}

export function formatDelta(points: number): string {
  return signedDollars(points);
}

export function deltaLine(rows: { firstName: string; net: number }[]): string {
  return rows.map((r) => `${voiceName(r.firstName)} ${formatDelta(r.net)}`).join(", ");
}

export function fillSubject(template: string, first: string): string {
  return template.split("{subject}").join(voiceName(first));
}

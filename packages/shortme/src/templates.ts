// ShortMe copy in Dennis's group-chat voice: lowercase, short, a little unhinged, never preachy.
// Names, amounts, and codes are inserted by code, never by the LLM. Every `{code}` stays literal for
// the approval service to fill. Amounts are shown in sim dollars: 1 ledger point = GATES.dollarsPerPoint.
import { voiceLine } from "@dennis/contracts";
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

// Dennis's opener when it spots a ShortMe moment. In the group-chat demo the subject can approve
// naturally (for example, "run it") when this is their only pending action.
export function publishMarketPrompt(p: {
  first: string;
  question: string;
  category: string;
  names: string[];
  mode?: "normal" | "demo";
}): string {
  if (p.mode === "normal") {
    const audience = p.names.length ? ` for ${p.names.map(voiceName).join(", ")}` : "";
    return `want me to open a private points-only market${audience}: "${p.question}"? no real money moves.`;
  }
  if (p.category === "dating") {
    return voiceLine("shortme.open.dating", [
      "ur chopped, thats a high risk asset. wanna open a market on whether or not she ghosts you?",
      "bro that's a volatile position. want a market on whether she leaves you on read?",
      "high risk, high reward. should i open a market on her ghosting you?",
      "chopped is strong but the chart isn't looking great. market on whether she ghosts you?",
    ]);
  }
  const first = voiceName(p.first);
  return voiceLine("shortme.open.self", [
    `Yo ${first} why don't you short yourself, i'll set up a market. Anyone wanna get in on this?`,
    `${first} if you're that cooked you might as well profit off it. want me to set up a market? who's in?`,
    `ngl ${first} this is a buy-the-dip moment. short yourself, i'll open the market. anyone wanna get in?`,
    `say less ${first}. let's turn this into a tradeable asset. i'll set up a market, who's getting in?`,
  ]);
}

// Posted once the market is live. Mentions the subject's own stake when they put money in.
export function marketCreatedText(p: {
  question: string;
  subjectStakePoints: number | null;
  category: string;
  mode?: "normal" | "demo";
}): string {
  if (p.mode === "normal")
    return `market's open: "${p.question}"${
      p.subjectStakePoints ? ` with ${dollars(p.subjectStakePoints)} sim from the subject` : ""
    }. points only, no real money.`;
  if (p.subjectStakePoints && p.subjectStakePoints > 0) {
    const what = p.category === "dating" ? "on the line" : "insurance for sale";
    const amount = `${dollars(p.subjectStakePoints)} ${what}`;
    return voiceLine("shortme.created.stake", [
      `Market created: "${p.question}" ${amount}`,
      `market's live: "${p.question}" ${amount}`,
      `done. "${p.question}" is open, ${amount}`,
      `"${p.question}" is officially trading. ${amount}`,
    ]);
  }
  return voiceLine("shortme.created", [
    `Market created: "${p.question}" Anyone wanna get in on this?`,
    `market's live: "${p.question}" who's getting in?`,
    `done. "${p.question}" is open for business. anyone?`,
    `"${p.question}" is officially trading. place your bets (sim $ only)`,
  ]);
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
  const amount = dollars(p.points);
  const subject = voiceName(p.subjectFirst);
  if (p.isSubject && p.side === "fade")
    return voiceLine("shortme.stake.self", [
      `${who} bought ${amount} of insurance on themself. respect.`,
      `${who} just hedged ${amount} against themself. risk management king.`,
      `${who} shorted themself for ${amount}. respect the hedge.`,
    ]);
  if (p.side === "back")
    return voiceLine("shortme.stake.back", [
      `${who}'s in for ${amount} backing ${subject}.`,
      `${who} put ${amount} on ${subject}. believer.`,
      `${who} is long ${subject} for ${amount}.`,
    ]);
  return voiceLine("shortme.stake.fade", [
    `${who} put ${amount} against ${subject}. cold.`,
    `${who} is short ${subject} for ${amount}. brutal.`,
    `${who} bet ${amount} against ${subject}. no loyalty.`,
  ]);
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

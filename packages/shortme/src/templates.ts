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

// Over/under markets are still yes/no underneath: BACK means the question comes true. These read the
// line out of a question such as "Will {subject} finish the marathon under 4 hours?".
export interface OverUnder {
  direction: "under" | "over";
  line: string; // "4 hours"
  topic: string; // "finish the marathon"
}

export function overUnderOf(question: string): OverUnder | null {
  // Greedy topic so the last keyword sets the line ("at least 1 interview within 2 weeks" -> 2 weeks).
  const match =
    /^will \S+ (.+) (under|over|at least|more than|less than|within|before) (\d[\d.:,%]*(?:\s?(?!(?:on|in|at|by|for|the|to|of|this|next|before|after)\b)[a-z]+)?)(?: (.+?))?\??$/i.exec(
      question.trim(),
    );
  if (!match) return null;
  const word = match[2]!.toLowerCase();
  const direction = ["over", "at least", "more than"].includes(word) ? "over" : "under";
  const topic = match[4] ? `${match[1]!.trim()} ${match[4].trim()}` : match[1]!.trim();
  return { direction, line: match[3]!.trim(), topic };
}

function sides(ou: OverUnder): string {
  const other = ou.direction === "under" ? "over" : "under";
  return `back = ${ou.direction} ${ou.line}, fade = the ${other}`;
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
    return `want me to open a private market${audience}: "${p.question}"?`;
  }
  const ou = overUnderOf(fillSubject(p.question, p.first));
  if (ou) {
    const first = voiceName(p.first);
    return voiceLine("shortme.open.overunder", [
      `${first} wants to ${ou.topic}? over/under ${ou.line}. i'll set the line, who's taking the ${ou.direction === "under" ? "over" : "under"}?`,
      `ok bookie hours. ${first} to ${ou.topic}: over/under ${ou.line}. want me to open it?`,
      `line is set: ${ou.line} for ${first} to ${ou.topic}. over or under, place your bets?`,
      `${first} to ${ou.topic}... i'm putting the line at ${ou.line}. who's hammering the ${ou.direction === "under" ? "over" : "under"}?`,
    ]);
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
    }.`;
  const ou = overUnderOf(p.question);
  if (ou)
    return voiceLine("shortme.created.overunder", [
      `market's live: "${p.question}" ${sides(ou)}.`,
      `market approved: "${p.question}" ${sides(ou)}. pick a side.`,
      `line's open: "${p.question}" ${sides(ou)}. get your picks in.`,
      `"${p.question}" is trading. ${sides(ou)}.`,
    ]);
  if (p.subjectStakePoints && p.subjectStakePoints > 0) {
    const what = p.category === "dating" ? "on the line" : "insurance for sale";
    const amount = `${dollars(p.subjectStakePoints)} ${what}`;
    return voiceLine("shortme.created.stake", [
      `Market created: "${p.question}" ${amount}`,
      `market's live: "${p.question}" ${amount}`,
      `market approved: "${p.question}" ${amount}. the boys are officially invested`,
      `done. "${p.question}" is open, ${amount}`,
      `"${p.question}" is officially trading. ${amount}`,
    ]);
  }
  return voiceLine("shortme.created", [
    `Market created: "${p.question}" Anyone wanna get in on this?`,
    `market's live: "${p.question}" who's getting in?`,
    `market approved: "${p.question}" ur friends can now profit off ur life choices`,
    `done. "${p.question}" is open for business. anyone?`,
    `"${p.question}" is officially trading. place your bets`,
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
  const ou = overUnderOf(p.question);
  if (ou) {
    const other = ou.direction === "under" ? "over" : "under";
    return `${s}'s got an over/under: "${p.question}" you've got ${dollars(p.points)} to play. BACK $200 ${p.code} for the ${ou.direction} ${ou.line}, FADE $200 ${p.code} for the ${other}, or PASS ${p.code}.`;
  }
  return `${s}'s got a market: "${p.question}" you've got ${dollars(p.points)} to play. BACK $200 ${p.code} if ${s} makes it, FADE $200 ${p.code} if not, or PASS ${p.code}.`;
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
      `${who} just hedged ${amount} against urself. that's called risk management`,
    ]);
  if (p.side === "back")
    return voiceLine("shortme.stake.back", [
      `${who}'s in for ${amount} backing ${subject}.`,
      `${who} put ${amount} on ${subject}. believer.`,
      `${who} is long ${subject} for ${amount}.`,
      `${who} put ${amount} on ${subject}. a true believer in the underlying asset`,
    ]);
  return voiceLine("shortme.stake.fade", [
    `${who} put ${amount} against ${subject}. cold.`,
    `${who} is short ${subject} for ${amount}. brutal.`,
    `${who} bet ${amount} against ${subject}. no loyalty.`,
    `${who} just shorted ${subject} for ${amount}. no loyalty in this chat`,
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
  return `"${question}" is disputed. payouts frozen till an admin sorts it out.`;
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

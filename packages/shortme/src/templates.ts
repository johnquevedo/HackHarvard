// Canonical ShortMe message templates (Section 8.9), used verbatim. `{code}` stays literal: the
// approval service substitutes the short code. Invite codes are substituted by this module.

export const TEMPLATE_VERSION = "v1";

export function publishMarketPrompt(p: {
  first: string;
  question: string;
  names: string[];
}): string {
  const names = p.names.length > 0 ? p.names.join(", ") : "no friends yet";
  return `Dennis for ${p.first}: that sounded like a ShortMe moment. Want a private, free-to-play market for friends: "${p.question}"? Invited: ${names}. Points only, no money, no prizes. Reply YES {code} to publish or NO {code} to drop it.`;
}

export function marketInviteText(p: {
  subjectFirst: string;
  question: string;
  points: number;
  code: string;
}): string {
  return `ShortMe from ${p.subjectFirst}'s agent: "${p.question}" Fictional points only, you have ${p.points}. Reply BACK <pts> ${p.code} (${p.subjectFirst} gets it), FADE <pts> ${p.code} (${p.subjectFirst} doesn't), or PASS ${p.code}.`;
}

export function confirmResolutionPrompt(p: {
  question: string;
  outcome: "yes" | "no";
}): string {
  return `ShortMe: proposed outcome for "${p.question}" is ${p.outcome.toUpperCase()}. Reply CONFIRM {code} or DISPUTE {code}.`;
}

export function outcomeSentence(p: {
  subjectFirst: string;
  outcome: "yes" | "no" | "void";
}): string {
  if (p.outcome === "void")
    return `The market about ${p.subjectFirst} was voided and every stake was refunded.`;
  return p.outcome === "yes"
    ? `${p.subjectFirst} got it.`
    : `${p.subjectFirst} did not get it this time.`;
}

export function formatDelta(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export function deltaLine(rows: { firstName: string; net: number }[]): string {
  return rows.map((r) => `${r.firstName} ${formatDelta(r.net)}`).join(", ");
}

export function fillSubject(template: string, first: string): string {
  return template.split("{subject}").join(first);
}

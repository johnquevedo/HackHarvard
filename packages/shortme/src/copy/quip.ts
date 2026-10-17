export const QUIP_FALLBACK = "Ouch and congratulations, in that order.";
export const QUIP_MAX_LENGTH = 140;

const FORBIDDEN_CHARS = /[0-9$€£¥₿@#<>{}[\]\\|]|https?:|www\./i;
const BLOCKED_WORDS = [
  "dollar",
  "dollars",
  "cash",
  "money",
  "bucks",
  "paid",
  "payout",
  "bet",
  "bets",
  "betting",
  "gamble",
  "gambling",
  "wager",
  "odds",
  "casino",
  "prize",
  "venmo",
  "zelle",
  "paypal",
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "hundred",
  "thousand",
  "stupid",
  "idiot",
  "loser",
  "ugly",
  "fat",
  "dumb",
];

// The quip is LLM text. It may contain at most the subject's first name as a proper noun, no digits,
// no currency, no gambling or money words, and nothing that looks like a link or a code.
// The quip prompt never receives names, so a name can only appear by hallucination; `blockedNames`
// (every participant except the subject) closes the sentence-start gap of the proper-noun guard.
export interface QuipNameRules {
  allowedNames?: string[];
  blockedNames?: string[];
}

export function validateQuip(quip: string, opts: QuipNameRules = {}): boolean {
  if (typeof quip !== "string") return false;
  const q = quip.trim();
  if (q.length < 3 || q.length > QUIP_MAX_LENGTH) return false;
  if (/[\r\n\t]/.test(q) || FORBIDDEN_CHARS.test(q)) return false;
  const words = q.match(/[A-Za-z][A-Za-z'\-]*/g) ?? [];
  const lower = words.map((w) => w.toLowerCase());
  if (lower.some((w) => BLOCKED_WORDS.includes(w))) return false;
  const allowed = new Set((opts.allowedNames ?? []).map((n) => n.toLowerCase()));
  const blocked = (opts.blockedNames ?? [])
    .map((n) => n.toLowerCase())
    .filter((n) => n && !allowed.has(n));
  if (lower.some((w) => blocked.includes(w))) return false;
  // Proper-noun guard: a capitalized word is allowed only at a sentence start, as "I", or as an allowed name.
  const tokens = q.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i]!.replace(/^[^A-Za-z]+|[^A-Za-z'\-]+$/g, "");
    if (!word || word[0] !== word[0]!.toUpperCase() || word[0] === word[0]!.toLowerCase()) continue;
    const sentenceStart = i === 0 || /[.!?]$/.test(tokens[i - 1]!);
    if (sentenceStart || word === "I" || word.startsWith("I'") || allowed.has(word.toLowerCase()))
      continue;
    return false;
  }
  return true;
}

// Template market_result (Section 8.9). Numbers, names, and codes come from code, never from the LLM.
export function renderResultMessage(
  input: { outcomeSentence: string; deltaLine: string },
  quip: string | null,
  opts: QuipNameRules = {},
): string {
  const safe = quip !== null && validateQuip(quip, opts) ? quip.trim() : QUIP_FALLBACK;
  return `ShortMe result: ${input.outcomeSentence} ${safe} Points: ${input.deltaLine}. (Fictional points, no value.)`;
}

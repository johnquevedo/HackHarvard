import type { MilestoneExtractionT } from "./schema";

// Deterministic milestone policy. The order and the outcomes match
// services/chalk-eval/src/dennis_eval/milestone.py apply_gates so Chalk measures the real policy.

export interface MilestoneGates {
  minConfidence: number;
  enabledTemplates: string[];
  blockedCategories: string[];
  blockHighSensitivity: boolean;
  requireSubjectIsAuthor: boolean;
  requireOutcomeUncertain: boolean;
  blockThirdPartyExposure: boolean;
  redactEmployerNames: boolean;
  dollarsPerPoint: number;
  maxStake: number;
  starterPoints: number;
  approvalTtlMinutes: number;
  approvalTtlMinutesNonDemo: number;
  inviteTtlMinutes: number;
  defaultResolvesWithinDays: number;
}

export type GateReason =
  | "not_an_intent"
  | "low_confidence"
  | "category_disabled"
  | "sensitive"
  | "not_subject_owned"
  | "policy_blocked";

export type GateResult =
  | { pass: true; questionTemplate: string; redactions: string[] }
  | {
      pass: false;
      reason: GateReason;
      detail: string;
      evalDecision: "no_market" | "blocked_policy";
    };

const FALLBACK_QUESTIONS: Record<string, string> = {
  recruiting: "Will {subject} get the offer?",
  academics: "Will {subject} pass?",
  dating: "Will {subject} get ghosted?",
  friend_event: "Will {subject} make it?",
};
const GENERIC_QUESTION = "Will it work out for {subject}?";
const REDACTION_REPLACEMENT = "the company";
const FORBIDDEN_IN_QUESTION = /[0-9@$€£#<>[\]]|https?:|www\./i;

function block(reason: GateReason, detail: string): GateResult {
  return { pass: false, reason, detail, evalDecision: "blocked_policy" };
}
function skip(reason: GateReason, detail: string): GateResult {
  return { pass: false, reason, detail, evalDecision: "no_market" };
}

// `allowedProper` holds lowercase words the author themself named (employers, schools) that may stay
// capitalized when redaction is off; every other capitalized word after the first is refused.
function questionOk(q: string, allowedProper: Set<string>): boolean {
  if (!q.includes("{subject}") || q.length > 120 || !q.endsWith("?")) return false;
  if (FORBIDDEN_IN_QUESTION.test(q)) return false;
  const rest = q.split("{subject}").join("");
  if (rest.includes("{") || rest.includes("}")) return false;
  // Conservative proper-noun guard: only the first word may be capitalized.
  const words = rest.match(/[A-Za-z][A-Za-z'\-]*/g) ?? [];
  return words
    .slice(1)
    .every((w) => w[0] !== w[0]!.toUpperCase() || allowedProper.has(w.toLowerCase()));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeQuestion(
  template: string,
  category: string,
  employerMentions: string[],
  redact: boolean,
): { questionTemplate: string; redactions: string[] } {
  let q = template.trim().split(/\s+/).join(" ");
  const redactions: string[] = [];
  if (redact) {
    const names = [
      ...new Set(employerMentions.map((m) => m.trim()).filter((m) => m.length >= 2)),
    ].sort((a, b) => b.length - a.length);
    for (const name of names) {
      const re = new RegExp(escapeRegex(name), "gi");
      if (re.test(q)) {
        q = q.replace(new RegExp(escapeRegex(name), "gi"), REDACTION_REPLACEMENT);
        if (!redactions.includes("employer")) redactions.push("employer");
      }
    }
  }
  q = q.split(/\s+/).join(" ");
  const allowedProper = new Set(
    redact ? [] : employerMentions.flatMap((m) => m.toLowerCase().match(/[a-z][a-z'\-]*/g) ?? []),
  );
  if (!questionOk(q, allowedProper)) {
    q = FALLBACK_QUESTIONS[category] ?? GENERIC_QUESTION;
    redactions.push("fallback_question");
  }
  return { questionTemplate: q, redactions: redactions.slice(0, 5) };
}

export function applyMilestoneGates(x: MilestoneExtractionT, gates: MilestoneGates): GateResult {
  if (x.minorIndicated) return block("policy_blocked", "minor_indicated");
  if (x.injectionAttempt) return block("policy_blocked", "injection_attempt");
  if (!x.isMilestone || x.hyperbole)
    return skip("not_an_intent", x.hyperbole ? "hyperbole" : "not_a_milestone");
  if (gates.blockedCategories.includes(x.category))
    return block("policy_blocked", `category_blocked:${x.category}`);
  if (gates.blockHighSensitivity && x.sensitivity === "high")
    return block("sensitive", "high_sensitivity");
  if (gates.requireSubjectIsAuthor && !x.subjectIsAuthor)
    return block("not_subject_owned", "subject_is_not_author");
  if (gates.blockThirdPartyExposure && x.mentionsThirdParty)
    return block("policy_blocked", "third_party_exposure");
  if (gates.requireOutcomeUncertain && !x.outcomeUncertain)
    return skip("not_an_intent", "outcome_already_known");
  if (x.confidence < gates.minConfidence)
    return skip("low_confidence", `confidence ${x.confidence.toFixed(2)}`);
  if (!gates.enabledTemplates.includes(x.category))
    return skip("category_disabled", `template_disabled:${x.category}`);
  const s = sanitizeQuestion(
    x.questionTemplate,
    x.category,
    x.employerMentions,
    gates.redactEmployerNames,
  );
  return {
    pass: true,
    questionTemplate: s.questionTemplate,
    redactions: s.redactions,
  };
}

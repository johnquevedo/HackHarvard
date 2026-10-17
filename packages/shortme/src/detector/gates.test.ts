import { describe, expect, it } from "vitest";
import gatesJson from "../../rules/milestone-gates.json" with { type: "json" };
import {
  applyMilestoneGates,
  sanitizeQuestion,
  type MilestoneGates,
} from "./gates";
import { MilestoneExtraction, type MilestoneExtractionT } from "./schema";

const gates = gatesJson as unknown as MilestoneGates;

const BASE: MilestoneExtractionT = {
  isMilestone: true,
  subjectIsAuthor: true,
  outcomeUncertain: true,
  hyperbole: false,
  injectionAttempt: false,
  minorIndicated: false,
  mentionsThirdParty: false,
  category: "recruiting",
  milestoneKind: "final_round_interview",
  questionTemplate: "Will {subject} get the offer after the final round?",
  resolvesWithinDays: 14,
  sensitivity: "none",
  employerMentions: [],
  confidence: 0.9,
  rationale: "own interview",
};

describe("rules file", () => {
  it("has the specified values", () => {
    expect(gates).toMatchObject({
      minConfidence: 0.75,
      enabledTemplates: ["recruiting"],
      blockedCategories: ["dating"],
      blockHighSensitivity: true,
      requireSubjectIsAuthor: true,
      maxStake: 100,
      starterPoints: 1000,
      approvalTtlMinutes: 30,
      approvalTtlMinutesNonDemo: 1440,
    });
  });
});

describe("applyMilestoneGates (same table as the Python eval)", () => {
  it.each([
    [{}, "pass", null],
    [{ minorIndicated: true }, "blocked_policy", "policy_blocked"],
    [
      { injectionAttempt: true, isMilestone: false },
      "blocked_policy",
      "policy_blocked",
    ],
    [{ isMilestone: false }, "no_market", "not_an_intent"],
    [{ hyperbole: true }, "no_market", "not_an_intent"],
    [{ category: "dating" }, "blocked_policy", "policy_blocked"],
    [{ sensitivity: "high" }, "blocked_policy", "sensitive"],
    [{ subjectIsAuthor: false }, "blocked_policy", "not_subject_owned"],
    [{ mentionsThirdParty: true }, "blocked_policy", "policy_blocked"],
    [{ outcomeUncertain: false }, "no_market", "not_an_intent"],
    [{ confidence: 0.74 }, "no_market", "low_confidence"],
    [{ confidence: 0.75 }, "pass", null],
    [{ category: "academics" }, "no_market", "category_disabled"],
    [{ category: "friend_event" }, "no_market", "category_disabled"],
    [{ sensitivity: "low" }, "pass", null],
  ] as [Partial<MilestoneExtractionT>, string, string | null][])(
    "%o",
    (over, decision, reason) => {
      const r = applyMilestoneGates(
        MilestoneExtraction.parse({ ...BASE, ...over }),
        gates,
      );
      if (r.pass) {
        expect(decision).toBe("pass");
      } else {
        expect([r.evalDecision, r.reason]).toEqual([decision, reason]);
      }
    },
  );
});

describe("sanitizeQuestion", () => {
  it.each([
    [
      "Will {subject} get the offer from Jane Street?",
      ["Jane Street"],
      "Will {subject} get the offer from the company?",
      ["employer"],
    ],
    ["Will {subject} get the offer?", [], "Will {subject} get the offer?", []],
    [
      "Will {subject} make $200k?",
      [],
      "Will {subject} get the offer?",
      ["fallback_question"],
    ],
    [
      "Will Alice get the offer?",
      [],
      "Will {subject} get the offer?",
      ["fallback_question"],
    ],
    [
      "Will {subject} beat Bob for the role?",
      [],
      "Will {subject} get the offer?",
      ["fallback_question"],
    ],
    [
      "Will {subject} call 617-555-0142?",
      [],
      "Will {subject} get the offer?",
      ["fallback_question"],
    ],
    [
      "Will {subject} get it",
      [],
      "Will {subject} get the offer?",
      ["fallback_question"],
    ],
    [
      "Will {subject} see https://x.co?",
      [],
      "Will {subject} get the offer?",
      ["fallback_question"],
    ],
  ] as [string, string[], string, string[]][])(
    "%s",
    (template, mentions, expected, redactions) => {
      expect(sanitizeQuestion(template, "recruiting", mentions, true)).toEqual({
        questionTemplate: expected,
        redactions,
      });
    },
  );

  it("schema rejects extra keys and out-of-range values", () => {
    expect(MilestoneExtraction.safeParse({ ...BASE, extra: 1 }).success).toBe(
      false,
    );
    expect(
      MilestoneExtraction.safeParse({ ...BASE, confidence: 1.5 }).success,
    ).toBe(false);
  });
});

import { expect, it } from "vitest";
import { marketCreatedText, marketInviteText, overUnderOf, publishMarketPrompt } from "./templates";

it.each([
  [
    "Will john finish the marathon under 4 hours?",
    { direction: "under", line: "4 hours", topic: "finish the marathon" },
  ],
  [
    "Will john score over 80% on the midterm?",
    { direction: "over", line: "80%", topic: "score on the midterm" },
  ],
  [
    "Will john get at least 1 interview within 2 weeks?",
    { direction: "under", line: "2 weeks", topic: "get at least 1 interview" },
  ],
  [
    "Will john bench at least 225 pounds?",
    { direction: "over", line: "225 pounds", topic: "bench" },
  ],
  ["Will she ghost john?", null],
  ["Will john pass his Meta final round?", null],
] as const)("%s", (question, expected) => {
  expect(overUnderOf(question)).toEqual(expected);
});

it("speaks over/under markets like a bookie and says which side is which", () => {
  const q = "Will john finish the marathon under 4 hours?";
  expect(
    publishMarketPrompt({ first: "John", question: q, category: "other", names: [], mode: "demo" }),
  ).toContain("over/under 4 hours");
  expect(
    marketCreatedText({ question: q, subjectStakePoints: null, category: "other", mode: "demo" }),
  ).toContain("back = under 4 hours, fade = the over");
  expect(
    marketInviteText({ subjectFirst: "John", question: q, points: 1000, code: "ab12" }),
  ).toContain("BACK $200 ab12 for the under 4 hours, FADE $200 ab12 for the over");
});

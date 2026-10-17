import { describe, expect, it } from "vitest";
import { QUIP_FALLBACK, renderResultMessage, validateQuip } from "./quip";

describe("validateQuip", () => {
  it.each([
    ["Shorting yourself is a bold kind of self care.", true],
    ["Somewhere a recruiter is very confused.", true],
    ["Alice called it before anyone else did.", true, ["Alice"]],
    ["I guess the hedge was the real win.", true],
    ["She made 100 points, wow.", false],
    ["Worth $5 of pride.", false],
    ["Bob is crying in the corner.", false, ["Alice"], ["Bob"]],
    ["Then Bob cried.", false],
    ["Call me at the usual place @home", false],
    ["Great bet, collect your cash.", false],
    ["Check https://example.com", false],
    ["Two friends, one outcome.", false],
    ["x".repeat(141), false],
    ["ok", false],
    ["Line one.\nLine two.", false],
  ] as [string, boolean, string[]?, string[]?][])(
    "%s",
    (q, ok, names, blocked) => {
      expect(
        validateQuip(q, {
          allowedNames: names ?? [],
          blockedNames: blocked ?? [],
        }),
      ).toBe(ok);
    },
  );
});

describe("renderResultMessage", () => {
  const input = {
    outcomeSentence: "Alice did not get it this time.",
    deltaLine: "Alice +50, Bob -50",
  };

  it("uses a valid quip", () => {
    expect(
      renderResultMessage(
        input,
        "Shorting yourself is a bold kind of self care.",
      ),
    ).toBe(
      "ShortMe result: Alice did not get it this time. Shorting yourself is a bold kind of self care. Points: Alice +50, Bob -50. (Fictional points, no value.)",
    );
  });

  it.each([null, "You won 50 points!", "Bob owes you."])(
    "falls back for %s",
    (q) => {
      expect(
        renderResultMessage(input, q, {
          allowedNames: ["Alice"],
          blockedNames: ["Bob"],
        }),
      ).toContain(QUIP_FALLBACK);
    },
  );
});

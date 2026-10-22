import { describe, expect, it } from "vitest";

import { authorizePaymentCopy, groupConfirmedCopy, joinGroupCopy } from "./copy.js";

describe("purchasing copy", () => {
  it("keeps the other member anonymous before both join approvals", () => {
    const text = joinGroupCopy({
      first: "Alice",
      productLabel: "27-inch 4K monitor",
      groupCents: 28_499,
      individualCents: 32_999,
      savingsCents: 4_500,
      merchant: "DemoMart (simulated)",
    });
    expect(text).toContain("another Dennis user");
    expect(text).toContain("SIMULATED group offer");
    expect(text).toContain("Nothing is charged yet");
    expect(text).not.toContain("Bob");
  });

  it("labels payment authorization as sandbox money", () => {
    const text = authorizePaymentCopy({
      first: "Alice",
      amountCents: 28_499,
      last4: "1234",
      productLabel: "27-inch 4K monitor",
    });
    expect(text).toContain("SANDBOX transfer");
    expect(text).toContain("Sandbox money only, no real funds");
  });
});

describe("group-chat voice (conversationMode demo)", () => {
  it("asks to coordinate the deal in Dennis's voice and keeps the code token", () => {
    expect(
      joinGroupCopy({
        first: "Isaac",
        productLabel: "27-inch 4K monitor",
        groupCents: 28499,
        individualCents: 32999,
        savingsCents: 4500,
        merchant: "DemoMart (simulated)",
        mode: "demo",
      }),
    ).toBe(
      "wait. found a match. another friend's agent has been tracking the same 27-inch 4k monitor. found a group deal that saves you both $45.00 each ($284.99 instead of $329.99, simulated offer). want me to coordinate? ({code})",
    );
  });

  it("confirms the group and offers the simulated Nessie payment", () => {
    expect(groupConfirmedCopy({ otherFirst: "Isaac", mode: "demo" })).toBe(
      "both approved. group purchase organized. you're buying with isaac.",
    );
    expect(groupConfirmedCopy({ otherFirst: "Isaac" })).toBe("You're buying with Isaac.");
    expect(
      authorizePaymentCopy({
        first: "Isaac",
        amountCents: 28499,
        last4: "4242",
        productLabel: "monitor",
        mode: "demo",
      }),
    ).toBe(
      "simulated Nessie payment ready for confirmation: $284.99 from your demo account ending 4242 to the group pool. sandbox money only. send it? ({code})",
    );
  });
});

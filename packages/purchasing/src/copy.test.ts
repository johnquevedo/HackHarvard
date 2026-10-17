import { describe, expect, it } from "vitest";

import { authorizePaymentCopy, joinGroupCopy } from "./copy.js";

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

import { PurchaseIntentPublic } from "@dennis/contracts";
import { describe, expect, it } from "vitest";

import { transitionGroup, type GroupStatus } from "../../packages/purchasing/src/groups/state-machine.js";

describe("A2 adversarial contracts", () => {
  it("rejects a public intent carrying raw text or a phone number field", () => {
    const parsed = PurchaseIntentPublic.safeParse({
      category: "monitor",
      productKey: "monitor_4k",
      quantity: 1,
      budgetBandMaxCents: 35_000,
      window: { from: "2026-10-17", to: "2026-10-18" },
      regionCode: "boston-cambridge",
      rawText: "Call 617-555-0199",
    });
    expect(parsed.success).toBe(false);
  });

  it.each([
    "proposed",
    "awaiting_join_approvals",
    "confirmed",
    "awaiting_payment_approvals",
    "ready_to_settle",
  ] as GroupStatus[])("cancels %s when consent is revoked before settlement", (status) => {
    expect(transitionGroup(status, "consent_revoked")).toBe("cancelled");
  });

  it("refuses revocation cancellation after settlement starts", () => {
    expect(() => transitionGroup("settling", "consent_revoked")).toThrow("Invalid group transition");
  });
});

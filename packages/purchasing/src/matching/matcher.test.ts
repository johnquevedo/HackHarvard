import type { PurchaseIntentPublicT } from "@dennis/contracts";
import { describe, expect, it } from "vitest";

import { isCompatible, type MatchingRules } from "./matcher.js";

const rules: MatchingRules = {
  version: 1,
  minSavingsCents: 1_000,
  minSavingsPercent: 5,
  windowOverlapDays: 1,
  requireSameRegion: true,
  requireProductMatch: "same_or_generic",
};

const base: PurchaseIntentPublicT = {
  category: "monitor",
  productKey: "monitor_27in_4k",
  quantity: 1,
  budgetBandMaxCents: 35_000,
  window: { from: "2026-10-17", to: "2026-10-18" },
  regionCode: "boston-cambridge",
};

describe("isCompatible", () => {
  it("matches the Alice and Bob demo monitor variants", () => {
    const decision = isCompatible(base, { ...base, productKey: "monitor_4k", budgetBandMaxCents: null }, rules);
    expect(decision.compatible).toBe(true);
    expect(decision.checks.every((check) => check.passed)).toBe(true);
  });

  it.each([
    {
      name: "product mismatch",
      other: { ...base, category: "moving_service" as const, productKey: "moving_service_generic" },
      rule: "product_match",
    },
    {
      name: "budget mismatch",
      other: { ...base, budgetBandMaxCents: 0 },
      rule: "budget_overlap",
    },
    {
      name: "window mismatch",
      other: { ...base, window: { from: "2026-11-01", to: "2026-11-02" } },
      rule: "window_overlap",
    },
    {
      name: "region mismatch",
      other: { ...base, regionCode: "new-york-city" },
      rule: "region_match",
    },
  ])("explains $name", ({ other, rule }) => {
    const decision = isCompatible(base, other, rules);
    expect(decision.compatible).toBe(false);
    expect(decision.checks.find((check) => check.rule === rule)).toMatchObject({ passed: false });
  });

  it("enforces same_only product matching", () => {
    const decision = isCompatible(base, { ...base, productKey: "monitor_4k" }, { ...rules, requireProductMatch: "same_only" });
    expect(decision.compatible).toBe(false);
    expect(decision.checks[0]).toMatchObject({ rule: "product_match", passed: false });
  });

  it("accepts a one day window tolerance", () => {
    const decision = isCompatible(
      base,
      { ...base, window: { from: "2026-10-19", to: "2026-10-20" } },
      rules,
    );
    expect(decision.compatible).toBe(true);
  });
});

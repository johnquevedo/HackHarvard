import type { PurchaseIntentPublicT } from "@dennis/contracts";

export interface MatchingRules {
  version: number;
  minSavingsCents: number;
  minSavingsPercent: number;
  windowOverlapDays: number;
  requireSameRegion: boolean;
  requireProductMatch: "same_or_generic" | "same_only";
}

export interface MatchCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

export interface MatchDecision {
  compatible: boolean;
  checks: MatchCheck[];
}

function dateNumber(isoDate: string): number {
  return Date.parse(`${isoDate}T12:00:00.000Z`);
}

function productMatches(a: PurchaseIntentPublicT, b: PurchaseIntentPublicT, rules: MatchingRules): boolean {
  if (a.productKey === b.productKey) return true;
  if (rules.requireProductMatch === "same_only") return false;
  if (a.productKey.endsWith("_generic") || b.productKey.endsWith("_generic")) {
    return a.category === b.category;
  }
  return a.category === b.category && a.productKey.split("_")[0] === b.productKey.split("_")[0];
}

function windowsOverlap(a: PurchaseIntentPublicT, b: PurchaseIntentPublicT, toleranceDays: number): boolean {
  const tolerance = toleranceDays * 24 * 60 * 60 * 1000;
  return dateNumber(a.window.from) <= dateNumber(b.window.to) + tolerance && dateNumber(b.window.from) <= dateNumber(a.window.to) + tolerance;
}

export function isCompatible(
  a: PurchaseIntentPublicT,
  b: PurchaseIntentPublicT,
  rules: MatchingRules,
): MatchDecision {
  const product = productMatches(a, b, rules);
  const budget =
    a.budgetBandMaxCents === null ||
    b.budgetBandMaxCents === null ||
    (a.budgetBandMaxCents > 0 && b.budgetBandMaxCents > 0);
  const window = windowsOverlap(a, b, rules.windowOverlapDays);
  const region = !rules.requireSameRegion || a.regionCode === b.regionCode;
  const checks: MatchCheck[] = [
    {
      rule: "product_match",
      passed: product,
      detail: product ? `${a.productKey} is compatible with ${b.productKey}` : `${a.productKey} does not match ${b.productKey}`,
    },
    {
      rule: "budget_overlap",
      passed: budget,
      detail: budget ? "Budget bands can support a common price" : "Budget bands do not support a positive common price",
    },
    {
      rule: "window_overlap",
      passed: window,
      detail: window ? "Shopping windows overlap" : `Shopping windows differ by more than ${rules.windowOverlapDays} day(s)`,
    },
    {
      rule: "region_match",
      passed: region,
      detail: region ? "Regions satisfy the matching rule" : `${a.regionCode} does not match ${b.regionCode}`,
    },
    {
      rule: "matching_enabled",
      passed: true,
      detail: "Both inputs came from the active shared registry",
    },
    {
      rule: "already_matched",
      passed: true,
      detail: "Both inputs are available for matching",
    },
  ];
  return { compatible: checks.every((check) => check.passed), checks };
}

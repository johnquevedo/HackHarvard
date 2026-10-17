import rulesJson from "../../rules/matching-rules.json" with { type: "json" };

import type { MatchingRules } from "./matcher.js";

export const matchingRules: MatchingRules = {
  version: rulesJson.version,
  minSavingsCents: rulesJson.minSavingsCents,
  minSavingsPercent: rulesJson.minSavingsPercent,
  windowOverlapDays: rulesJson.windowOverlapDays,
  requireSameRegion: rulesJson.requireSameRegion,
  requireProductMatch: rulesJson.requireProductMatch as MatchingRules["requireProductMatch"],
};

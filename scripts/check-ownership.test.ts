import { describe, expect, it } from "vitest";
import {
  globMatch,
  isPathAllowed,
  findBranchViolations,
  type OwnershipMap,
} from "./check-ownership";

const ownership: OwnershipMap = {
  agents: {
    a1: ["packages/platform/**", "packages/contracts/**"],
    a4: ["apps/web/**", "package.json", "scripts/check-ownership.ts"],
  },
};

describe("ownership globs", () => {
  it("allows a file inside the agent glob", () => {
    expect(globMatch("apps/web/**", "apps/web/src/app/page.tsx")).toBe(true);
    expect(isPathAllowed("a4", "apps/web/src/app/page.tsx", "M", ownership)).toBe(true);
  });

  it("rejects a file outside the agent glob", () => {
    expect(isPathAllowed("a4", "packages/platform/src/index.ts", "M", ownership)).toBe(false);
    expect(isPathAllowed("a1", "apps/web/src/app/page.tsx", "A", ownership)).toBe(false);
  });

  it("lets any agent append contract requests and add cross tests", () => {
    expect(isPathAllowed("a2", "docs/CONTRACT_REQUESTS.md", "M", ownership)).toBe(true);
    expect(isPathAllowed("a2", "docs/CONTRACT_REQUESTS.md", "D", ownership)).toBe(false);
    expect(isPathAllowed("a3", "tests/cross/a3-flow.test.ts", "A", ownership)).toBe(true);
    expect(isPathAllowed("a3", "tests/cross/a1-flow.test.ts", "M", ownership)).toBe(false);
  });
});

it("scopes cross-owner authorization to the exact recorded review branch and still rejects unowned paths", () => {
  const review: OwnershipMap = {
    ...ownership,
    reviewBranches: {
      "a1/review": { agents: ["a1", "a4"], reason: "Human-authorized integration review" },
    },
  };
  expect(
    findBranchViolations("a1/review", [{ status: "M", file: "package.json" }], review),
  ).toEqual([]);
  expect(
    findBranchViolations("a1/ordinary", [{ status: "M", file: "package.json" }], review),
  ).toEqual(["M package.json"]);
  expect(findBranchViolations("a1/review", [{ status: "A", file: "unowned.ts" }], review)).toEqual([
    "A unowned.ts",
  ]);
});

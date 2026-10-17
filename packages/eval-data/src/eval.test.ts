import { describe, expect, it } from "vitest";
import { loadCases } from "./loader";
import { EvalReport } from "./schema";
import { computeMetrics } from "./metrics";
import { keywordDecision, runLocalEval } from "./local-runner";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeReport } from "./report";

describe("eval dataset", () => {
  const cases = loadCases();

  it("parses every case and matches section 10.3 counts", () => {
    expect(cases).toHaveLength(66);
    expect(cases.every((item) => item.synthetic)).toBe(true);
    const count = (suite: string, label?: string) =>
      cases.filter((item) => item.suite === suite && (!label || item.label === label)).length;
    expect(count("purchase_extraction")).toBe(24);
    expect(count("purchase_extraction", "positive")).toBe(8);
    expect(count("purchase_extraction", "negative")).toBe(6);
    expect(count("purchase_extraction", "ambiguous")).toBe(5);
    expect(count("purchase_extraction", "privacy_restricted")).toBe(5);
    expect(count("milestone_extraction", "positive")).toBe(8);
    expect(count("milestone_extraction", "negative")).toBe(6);
    expect(count("milestone_extraction", "ambiguous")).toBe(5);
    expect(count("milestone_extraction", "privacy_restricted")).toBe(5);
    expect(count("pair_match")).toBe(18);
    expect(
      cases.filter((item) => item.suite === "pair_match" && item.expected.decision === "match"),
    ).toHaveLength(6);
    expect(
      cases.filter((item) => item.suite === "pair_match" && item.expected.decision === "no_match"),
    ).toHaveLength(12);
    const holdout = cases.filter((item) => item.id.startsWith("holdout_")).length;
    expect(holdout).toBeGreaterThanOrEqual(12);
    expect(holdout / cases.length).toBeGreaterThan(0.15);
    expect(cases.filter((item) => item.suite === "pair_match" && item.textB === null)).toHaveLength(
      0,
    );
    expect(cases.filter((item) => item.suite !== "pair_match" && item.textB !== null)).toHaveLength(
      0,
    );
  });
});

describe("computeMetrics", () => {
  it("scores handmade rows", () => {
    const [row] = computeMetrics([
      {
        caseId: "a",
        suite: "purchase_extraction",
        label: "positive",
        expected: "create_intent",
        actual: "create_intent",
        leaked: false,
      },
      {
        caseId: "b",
        suite: "purchase_extraction",
        label: "negative",
        expected: "no_intent",
        actual: "create_intent",
        leaked: false,
      },
      {
        caseId: "c",
        suite: "purchase_extraction",
        label: "privacy_restricted",
        expected: "blocked",
        actual: "create_intent",
        leaked: true,
      },
    ]);
    expect(row?.falsePositives).toBe(2);
    expect(row?.privacyLeaks).toBe(1);
    expect(row?.precision).toBeLessThan(1);
  });
});

describe("local runner", () => {
  it("writes a report that parses as EvalReport", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dennis-eval-"));
    const report = await runLocalEval();
    const file = await writeReport(report, dir);
    expect(file.endsWith("local-latest.json")).toBe(true);
    expect(EvalReport.parse(report).provider).toBe("local");
    expect(keywordDecision(loadCases("purchase_extraction")[0]!).decision).toBeTypeOf("string");
  });
});

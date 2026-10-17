import {
  POSITIVE_DECISION,
  type EvalLabelT,
  type EvalSuiteResultT,
  type EvalSuiteT,
} from "./schema";

export interface MetricRow {
  caseId: string;
  suite: EvalSuiteT;
  label: EvalLabelT;
  expected: string;
  actual: string;
  leaked: boolean;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function computeMetrics(rows: MetricRow[]): EvalSuiteResultT[] {
  const suites: EvalSuiteT[] = ["purchase_extraction", "milestone_extraction", "pair_match"];
  return suites
    .map((suite) => {
      const items = rows.filter((row) => row.suite === suite);
      let tp = 0;
      let fp = 0;
      let fn = 0;
      let falsePositives = 0;
      let privacyLeaks = 0;
      const positive = POSITIVE_DECISION[suite];
      for (const row of items) {
        const expectedPos = row.expected === positive;
        const actualPos = row.actual === positive;
        if (expectedPos && actualPos) tp += 1;
        else if (!expectedPos && actualPos) fp += 1;
        else if (expectedPos && !actualPos) fn += 1;
        if (row.leaked) privacyLeaks += 1;
        const restricted =
          row.label === "negative" ||
          row.label === "ambiguous" ||
          row.label === "privacy_restricted";
        if (actualPos && restricted) falsePositives += 1;
      }
      const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
      const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
      const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
      return {
        suite,
        total: items.length,
        precision: round(precision),
        recall: round(recall),
        f1: round(f1),
        falsePositives,
        privacyLeaks,
      };
    })
    .filter((result) => result.total > 0);
}

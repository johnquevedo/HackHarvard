import { z } from "zod";

export const EvalSuite = z.enum(["purchase_extraction", "milestone_extraction", "pair_match"]);
export const EvalLabel = z.enum(["positive", "negative", "ambiguous", "privacy_restricted"]);

export const EvalCase = z.object({
  id: z.string(),
  suite: EvalSuite,
  label: EvalLabel,
  synthetic: z.literal(true),
  textA: z.string(),
  textB: z.string().nullable(),
  expected: z.object({
    decision: z.enum([
      "create_intent",
      "no_intent",
      "blocked",
      "propose_market",
      "no_market",
      "blocked_policy",
      "match",
      "no_match",
    ]),
    category: z.string().nullable(),
    mustNotLeak: z.array(z.string()),
  }),
  note: z.string(),
});

export const EvalSuiteResult = z.object({
  suite: EvalSuite,
  total: z.number().int(),
  precision: z.number(),
  recall: z.number(),
  f1: z.number(),
  falsePositives: z.number().int(),
  privacyLeaks: z.number().int(),
});

export const EvalExample = z.object({
  caseId: z.string(),
  suite: EvalSuite,
  label: EvalLabel,
  expected: z.string(),
  actual: z.string(),
  note: z.string(),
});

export const EvalReport = z.object({
  provider: z.enum(["chalk", "local"]),
  runId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  datasetVersion: z.string(),
  dashboardUrl: z.string().nullable(),
  suites: z.array(EvalSuiteResult),
  successes: z.array(EvalExample),
  failures: z.array(EvalExample),
});

export type EvalSuiteT = z.infer<typeof EvalSuite>;
export type EvalLabelT = z.infer<typeof EvalLabel>;
export type EvalCaseT = z.infer<typeof EvalCase>;
export type EvalSuiteResultT = z.infer<typeof EvalSuiteResult>;
export type EvalReportT = z.infer<typeof EvalReport>;

export const POSITIVE_DECISION: Record<EvalSuiteT, string> = {
  purchase_extraction: "create_intent",
  milestone_extraction: "propose_market",
  pair_match: "match",
};

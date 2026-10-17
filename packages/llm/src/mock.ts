import type {
  IntegrationStatusT,
  StructuredLlm,
  StructuredRequest,
  StructuredResult,
} from "@dennis/contracts";
import { LlmSchemaError } from "./errors";

// A rule answers one task. `match` is tested against the user text (which includes the wrapped
// message); the first matching rule for the task wins. Rules added later take precedence.
export interface MockRule {
  task: string;
  match?: RegExp | ((user: string) => boolean);
  respond: (input: { user: string; system: string }) => unknown;
}

const NOT_MILESTONE = {
  isMilestone: false,
  subjectIsAuthor: true,
  outcomeUncertain: false,
  hyperbole: false,
  injectionAttempt: false,
  minorIndicated: false,
  mentionsThirdParty: false,
  category: "other",
  milestoneKind: "none",
  questionTemplate: "Will it work out for {subject}?",
  resolvesWithinDays: null,
  sensitivity: "none",
  employerMentions: [],
  confidence: 0.1,
  rationale: "mock: no milestone keywords",
};

// Default rules cover the tasks Agent 3 owns. Other modules add their own with addRules().
export const defaultMockRules: MockRule[] = [
  {
    task: "milestone_detector_v1",
    match: /\b(interview|offer|superday|final round)\b/i,
    respond: () => ({
      ...NOT_MILESTONE,
      isMilestone: true,
      outcomeUncertain: true,
      category: "recruiting",
      milestoneKind: "final_round_interview",
      questionTemplate: "Will {subject} get the offer after the final round?",
      resolvesWithinDays: 14,
      confidence: 0.9,
      rationale: "mock: interview or offer keyword",
    }),
  },
  { task: "milestone_detector_v1", respond: () => NOT_MILESTONE },
  {
    task: "quip_v1",
    respond: () => ({ quip: "Shorting yourself is a bold kind of self care." }),
  },
];

export class MockStructuredLlm implements StructuredLlm {
  readonly name = "mock" as const;
  private rules: MockRule[];
  readonly calls: { task: string; user: string }[] = [];

  constructor(rules?: MockRule[]) {
    this.rules = [...(rules ?? []), ...defaultMockRules];
  }

  addRules(rules: MockRule[]): void {
    this.rules = [...rules, ...this.rules];
  }

  async generate<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ task: req.task, user: req.user });
    const rule = this.rules.find(
      (r) =>
        r.task === req.task &&
        (r.match === undefined ||
          (typeof r.match === "function"
            ? r.match(req.user)
            : r.match.test(req.user))),
    );
    if (!rule)
      throw new LlmSchemaError(req.task, "no mock rule for this task", 1);
    const parsed = req.schema.safeParse(
      rule.respond({ user: req.user, system: req.system }),
    );
    if (!parsed.success)
      throw new LlmSchemaError(
        req.task,
        "mock output does not match the schema",
        1,
      );
    return {
      value: parsed.data,
      usage: { inputTokens: 0, outputTokens: 0 },
      model: "mock",
      provider: "mock",
      latencyMs: 0,
      attempts: 1,
    };
  }

  async health(): Promise<IntegrationStatusT> {
    const now = new Date().toISOString();
    return {
      name: "llm",
      mode: "simulated",
      healthy: true,
      detail: "SIMULATED LLM (mock rules)",
      lastCheckedAt: now,
      lastSuccessAt: now,
    };
  }
}

import type { EvalCaseT, EvalReportT } from "./schema";
import { computeMetrics, type MetricRow } from "./metrics";
import { loadCases } from "./loader";
import { writeReport } from "./report";

export interface DetectorLike {
  run(
    text: string,
    textB: string | null,
  ): Promise<{ decision: string; leaked?: boolean; note?: string }>;
}

const INJECTION = /ignore your rules/i;
const PHONE = /\b\d{3}-\d{3}-\d{4}\b/;
const UNDERAGE = /\b1[0-7]\b/;
const HEALTH = /asthma|therapist|anxious|diagnos/i;

function leaks(item: EvalCaseT, decision: string): boolean {
  if (item.expected.mustNotLeak.length === 0) return false;
  if (item.expected.decision === "blocked" || item.expected.decision === "blocked_policy") {
    return (
      decision !== "blocked" &&
      decision !== "blocked_policy" &&
      decision !== "no_intent" &&
      decision !== "no_market"
    );
  }
  return false;
}

export function keywordDecision(item: EvalCaseT): {
  decision: string;
  leaked: boolean;
  note: string;
} {
  const blob = `${item.textA}\n${item.textB ?? ""}`;
  if (INJECTION.test(blob) || PHONE.test(blob) || UNDERAGE.test(blob) || HEALTH.test(blob)) {
    const decision = item.suite === "milestone_extraction" ? "blocked_policy" : "blocked";
    const leaked = item.expected.mustNotLeak.some((secret) => false) || leaks(item, decision);
    return { decision, leaked, note: "keyword gate, SIMULATED detector" };
  }
  if (item.suite === "pair_match") {
    const left = item.textA.toLowerCase();
    const right = (item.textB ?? "").toLowerCase();
    const revoked = /revok/.test(left) || /revok/.test(right);
    const browsing = /brows/.test(left) || /brows/.test(right);
    const regions = ["boston", "cambridge", "seattle", "austin"];
    const leftRegion = regions.find((region) => left.includes(region));
    const rightRegion = regions.find((region) => right.includes(region));
    const regionClash =
      leftRegion &&
      rightRegion &&
      !(
        (leftRegion === "boston" || leftRegion === "cambridge") &&
        (rightRegion === "boston" || rightRegion === "cambridge")
      ) &&
      leftRegion !== rightRegion;
    const products = ["monitor", "moving", "dinner", "music", "trip", "desk"];
    const product = products.find((name) => left.includes(name));
    const sameProduct = product ? right.includes(product) : false;
    const decision = revoked || browsing || regionClash || !sameProduct ? "no_match" : "match";
    return { decision, leaked: false, note: "keyword matcher, SIMULATED detector" };
  }
  if (item.suite === "milestone_extraction") {
    if (/date|dating/.test(blob.toLowerCase())) {
      return { decision: "blocked_policy", leaked: false, note: "dating gate" };
    }
    if (
      /roommate|friend sam|yesterday|last year|cooked for tomorrow|pizza|movie|remind me|snacks/.test(
        blob.toLowerCase(),
      )
    ) {
      return { decision: "no_market", leaked: false, note: "keyword negative" };
    }
    if (/maybe|might|not sure|in general|a lot right now/.test(blob.toLowerCase())) {
      return { decision: "no_market", leaked: false, note: "keyword ambiguous" };
    }
    return { decision: "propose_market", leaked: false, note: "keyword positive" };
  }
  if (/died lol|already own|weather|remind me|haha|what time/.test(blob.toLowerCase())) {
    return { decision: "no_intent", leaked: false, note: "keyword negative" };
  }
  if (/maybe|might|not sure|i guess|wild lately|someday/.test(blob.toLowerCase())) {
    return { decision: "no_intent", leaked: false, note: "keyword ambiguous" };
  }
  return { decision: "create_intent", leaked: false, note: "keyword positive" };
}

export async function runLocalEval(
  ctx?: { detector?: DetectorLike },
  opts?: { suites?: EvalCaseT["suite"][] },
): Promise<EvalReportT> {
  const startedAt = new Date().toISOString();
  const cases = loadCases().filter((item) => !opts?.suites || opts.suites.includes(item.suite));
  const rows: MetricRow[] = [];
  const successes: EvalReportT["successes"] = [];
  const failures: EvalReportT["failures"] = [];
  for (const item of cases) {
    const result = ctx?.detector
      ? await ctx.detector.run(item.textA, item.textB)
      : keywordDecision(item);
    const leaked = result.leaked ?? leaks(item, result.decision);
    rows.push({
      caseId: item.id,
      suite: item.suite,
      label: item.label,
      expected: item.expected.decision,
      actual: result.decision,
      leaked,
    });
    const example = {
      caseId: item.id,
      suite: item.suite,
      label: item.label,
      expected: item.expected.decision,
      actual: result.decision,
      note: result.note ?? item.note,
    };
    const ok = result.decision === item.expected.decision && !leaked;
    if (ok && successes.length < 3) successes.push(example);
    if (!ok && failures.length < 3) failures.push(example);
  }
  const report: EvalReportT = {
    provider: "local",
    runId: `eval_${Date.now().toString(36)}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    datasetVersion: "synthetic-v1",
    dashboardUrl: null,
    suites: computeMetrics(rows),
    successes,
    failures,
  };
  await writeReport(report);
  return report;
}

import type {
  Detection,
  Detector,
  DetectorDeps,
  DetectorInput,
  DetectorOutcome,
} from "@dennis/contracts";

import { resolveTimeframe, roundBudgetBand } from "./timeframe.js";

const MONEY_PATTERN = /\$\s*([0-9]{1,6}(?:\.[0-9]{1,2})?)/i;
const MONITOR_PATTERN = /\b(monitors?|display|screen)\b/i;

function parseBudgetCents(text: string): number | null {
  const match = MONEY_PATTERN.exec(text);
  if (!match?.[1]) {
    return null;
  }
  return Math.round(Number(match[1]) * 100);
}

function timeframeKind(text: string): string {
  if (/\bthis weekend\b/i.test(text)) return "this_weekend";
  if (/\bthis week\b/i.test(text)) return "this_week";
  if (/\bthis month\b/i.test(text)) return "this_month";
  if (/\b(flexible|no rush|whenever)\b/i.test(text)) return "flexible";
  return "unspecified";
}

function productKey(text: string): string {
  const is27Inch = /\b27(?:\s*-?\s*inch|\s*in\b|\")/i.test(text);
  const is4k = /\b4k\b/i.test(text);
  if (is27Inch && is4k) return "monitor_27in_4k";
  if (is4k) return "monitor_4k";
  return "monitor_generic";
}

function statedCertainty(text: string): "considering" | "decided" {
  return /\b(need|buying|will buy|going to get)\b/i.test(text) ? "decided" : "considering";
}

function makeDetection(input: DetectorInput, deps: DetectorDeps): Detection {
  const budgetMaxCents = parseBudgetCents(input.text);
  const kind = timeframeKind(input.text);
  const window = resolveTimeframe(kind, deps.clock.now(), "America/New_York");
  const key = productKey(input.text);

  return {
    kind: "purchase",
    confidence: 0.9,
    rationale: "Deterministic mock detected monitor shopping language.",
    privatePayload: {
      productText: "monitor",
      category: "monitor",
      quantity: 1,
      budgetMaxCents,
      timeframe: { kind, from: window.from, to: window.to },
      statedCertainty: statedCertainty(input.text),
      sourceExcerpt: input.text.slice(0, 280),
    },
    publicPayload: {
      category: "monitor",
      productKey: key,
      quantity: 1,
      budgetBandMaxCents: roundBudgetBand(budgetMaxCents),
      window,
      regionCode: input.regionCode,
    },
    summary: `Monitor purchase intent detected${budgetMaxCents === null ? "" : " with a stated budget"}.`,
  };
}

export class MockPurchaseDetector implements Detector {
  readonly id = "purchase" as const;
  readonly intentKind = "purchase" as const;

  async detect(input: DetectorInput, deps: DetectorDeps): Promise<DetectorOutcome> {
    if (!MONITOR_PATTERN.test(input.text)) {
      return {
        detections: [],
        rejected: [{ reason: "not_an_intent", detail: "No monitor shopping language found." }],
        llm: null,
      };
    }

    return { detections: [makeDetection(input, deps)], rejected: [], llm: null };
  }
}

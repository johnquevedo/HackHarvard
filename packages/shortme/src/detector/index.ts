import type {
  Detection,
  Detector,
  DetectorDeps,
  DetectorInput,
  DetectorOutcome,
} from "@dennis/contracts";
import { LlmSchemaError, loadPrompt, todayIn, wrapContext, wrapUserText } from "@dennis/llm";
import { GATES } from "../rules";
import { applyMilestoneGates, type MilestoneGates } from "./gates";
import { MilestoneExtraction } from "./schema";

export {
  applyMilestoneGates,
  sanitizeQuestion,
  type GateResult,
  type MilestoneGates,
} from "./gates";
export { MilestoneExtraction, QuipOutput, type MilestoneExtractionT } from "./schema";

const PROMPT_URL = new URL("../../prompts/milestone_detector_v1.md", import.meta.url);
export const MILESTONE_TASK = "milestone_detector_v1";
const EXCERPT_MAX = 280;

function excerpt(text: string, employers: string[]): string {
  let out = text;
  for (const e of employers.filter((x) => x.trim().length >= 2)) {
    out = out.replace(new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[employer]");
  }
  return out.slice(0, EXCERPT_MAX);
}

// LLM-backed milestone detector with deterministic policy gates (A3-04). The LLM only describes the
// message; applyMilestoneGates decides. Milestones never have a public payload.
export function createMilestoneDetector(
  gates: MilestoneGates = GATES,
  opts: { timeZone?: string } = {},
): Detector {
  return {
    id: "milestone",
    intentKind: "milestone",
    async detect(input: DetectorInput, deps: DetectorDeps): Promise<DetectorOutcome> {
      const tz = opts.timeZone ?? "America/New_York";
      const enabled = gates.enabledTemplates.filter(
        (c) => input.enabledCategories.length === 0 || input.enabledCategories.includes(c),
      );
      const system = loadPrompt(PROMPT_URL, {
        today: todayIn(tz, deps.clock.now()),
        timezone: tz,
        region: input.regionCode,
        enabledCategories: enabled.join(", ") || "none",
      });
      const user = wrapUserText(input.text) + wrapContext(input.recentContext.slice(-3));
      let result;
      try {
        result = await deps.llm.generate({
          task: MILESTONE_TASK,
          system,
          user,
          schema: MilestoneExtraction,
          temperature: 0,
          maxTokens: 600,
          traceId: input.messageId,
        });
      } catch (err) {
        const reason = err instanceof LlmSchemaError ? "schema_invalid" : "llm_unavailable";
        deps.log.warn("milestone.detect_failed", {
          messageId: input.messageId,
          reason,
        });
        return {
          detections: [],
          rejected: [{ reason, detail: err instanceof Error ? err.name : "error" }],
          llm: null,
        };
      }
      const llm = {
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
      };
      const x = result.value;
      const gate = applyMilestoneGates(x, {
        ...gates,
        enabledTemplates: enabled,
      });
      if (!gate.pass) {
        return {
          detections: [],
          rejected: [{ reason: gate.reason, detail: gate.detail }],
          llm,
        };
      }
      const privatePayload = {
        category: x.category,
        milestoneKind: x.milestoneKind.slice(0, 40),
        proposedQuestion: gate.questionTemplate,
        resolvesWithinDays: x.resolvesWithinDays ?? gates.defaultResolvesWithinDays,
        sensitivity: x.sensitivity,
        redactions: gate.redactions,
        // Group-chat rules keep employer names (redactEmployerNames false); only redact when the rules say so.
        sourceExcerpt: excerpt(input.text, gates.redactEmployerNames ? x.employerMentions : []),
      };
      const detection: Detection = {
        kind: "milestone",
        confidence: x.confidence,
        rationale: x.rationale.slice(0, 300),
        privatePayload,
        publicPayload: null,
        summary: `ShortMe moment: ${x.category} (${x.milestoneKind}), confidence ${x.confidence.toFixed(2)}`,
      };
      return { detections: [detection], rejected: [], llm };
    },
  };
}

export const milestoneDetector: Detector = createMilestoneDetector();

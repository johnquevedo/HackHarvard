import { z } from "zod";

// What the LLM returns for milestone_detector_v1: facts only, never a decision.
// Mirrors services/chalk-eval/src/dennis_eval/milestone.py EXTRACTION_SCHEMA.
export const MilestoneCategoryValues = [
  "recruiting",
  "academics",
  "dating",
  "friend_event",
  "other",
] as const;

export const MilestoneExtraction = z
  .object({
    isMilestone: z.boolean(),
    subjectIsAuthor: z.boolean(),
    outcomeUncertain: z.boolean(),
    hyperbole: z.boolean(),
    injectionAttempt: z.boolean(),
    minorIndicated: z.boolean(),
    mentionsThirdParty: z.boolean(),
    category: z.enum(MilestoneCategoryValues),
    milestoneKind: z.string().max(40),
    questionTemplate: z.string().max(160),
    resolvesWithinDays: z.number().int().min(1).max(60).nullable(),
    sensitivity: z.enum(["none", "low", "high"]),
    employerMentions: z.array(z.string().max(80)).max(10),
    confidence: z.number().min(0).max(1),
    rationale: z.string().max(300),
  })
  .strict();
export type MilestoneExtractionT = z.infer<typeof MilestoneExtraction>;

export const QuipOutput = z.object({ quip: z.string().max(200) }).strict();
export type QuipOutputT = z.infer<typeof QuipOutput>;

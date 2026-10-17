import { z } from "zod";

export const PurchaseExtraction = z
  .object({
    isPurchaseIntent: z.boolean(),
    subjectOwned: z.boolean(),
    category: z.enum(["monitor", "moving_service", "trip", "subscription", "dining", "other"]),
    productText: z.string().max(200),
    productKeyCandidate: z.string().max(60),
    quantity: z.number().int().min(1).max(10),
    budgetMaxCents: z.number().int().min(0).max(10_000_000).nullable(),
    timeframeKind: z.enum(["this_weekend", "this_week", "this_month", "flexible", "unspecified"]),
    statedCertainty: z.enum(["considering", "decided"]),
    sensitive: z.boolean(),
    confidence: z.number().min(0).max(1),
    rationale: z.string().max(300),
  })
  .strict();

export type PurchaseExtractionT = z.infer<typeof PurchaseExtraction>;

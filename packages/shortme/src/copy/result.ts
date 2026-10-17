import type { PlatformContext } from "@dennis/platform";
import { loadPrompt } from "@dennis/llm";
import { QuipOutput } from "../detector/schema";
import { renderResultMessage, validateQuip } from "./quip";

const QUIP_PROMPT = new URL("../../prompts/quip_v1.md", import.meta.url);

// LLM quip with a 4 second budget; any failure, timeout, or invalid text yields null and the fixed
// fallback line is used. The LLM never sees names, numbers, or codes.
export async function generateQuip(
  ctx: PlatformContext,
  input: {
    outcome: "yes" | "no" | "void";
    selfShort: boolean;
    subjectFirst: string;
    otherNames: string[];
  },
): Promise<string | null> {
  if (input.outcome === "void") return null;
  try {
    const r = await ctx.llm.generate({
      task: "quip_v1",
      system: loadPrompt(QUIP_PROMPT, {
        outcome: input.outcome === "yes" ? "the subject got it" : "the subject did not get it",
        selfShort: input.selfShort ? "yes" : "no",
      }),
      user: `<context>outcome=${input.outcome}; selfShort=${input.selfShort}</context>`,
      schema: QuipOutput,
      temperature: 0.7,
      maxTokens: 120,
      timeoutMs: 4000,
    });
    const quip = r.value.quip.trim();
    return validateQuip(quip, {
      allowedNames: [input.subjectFirst],
      blockedNames: input.otherNames,
    })
      ? quip
      : null;
  } catch {
    return null;
  }
}

export function buildResultText(p: {
  outcomeSentence: string;
  deltaLine: string;
  quip: string | null;
  subjectFirst: string;
  otherNames: string[];
}): string {
  return renderResultMessage(
    { outcomeSentence: p.outcomeSentence, deltaLine: p.deltaLine },
    p.quip,
    { allowedNames: [p.subjectFirst], blockedNames: p.otherNames },
  );
}

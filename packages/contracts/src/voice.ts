// Dennis's lines come in variants. The first variant is the canonical copy (the recorded demo wording
// and what tests assert); live runs pick one of the others at random and never repeat the last pick
// for the same key, so re-sending a scripted message gets a similar but different reply.
const lastPick = new Map<string, number>();

function deterministic(): boolean {
  return process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
}

export function voiceLine(key: string, variants: readonly string[]): string {
  if (variants.length === 0) throw new Error(`no voice variants for ${key}`);
  if (variants.length === 1 || deterministic()) return variants[0]!;
  const choices = variants
    .map((_, index) => index)
    .filter((i) => i !== 0 && i !== lastPick.get(key));
  const pick = choices[Math.floor(Math.random() * choices.length)] ?? 0;
  lastPick.set(key, pick);
  return variants[pick]!;
}

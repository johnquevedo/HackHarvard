import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { seedCases } from "./seed-cases";

const dir = path.resolve("packages/eval-data/cases");
mkdirSync(dir, { recursive: true });
const groups = {
  purchase_extraction: "purchase_extraction.jsonl",
  milestone_extraction: "milestone_extraction.jsonl",
  pair_match: "pair_match.jsonl",
} as const;

for (const [suite, file] of Object.entries(groups)) {
  const lines = seedCases
    .filter((item) => item.suite === suite)
    .map((item) => JSON.stringify(item));
  writeFileSync(path.join(dir, file), `${lines.join("\n")}\n`, "utf8");
  console.log(`${file} ${lines.length}`);
}

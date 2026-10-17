import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvalCase, type EvalCaseT, type EvalSuiteT } from "./schema";

const here = path.dirname(fileURLToPath(import.meta.url));

export function casesDir(): string {
  return path.resolve(here, "../cases");
}

export function loadCases(suite?: EvalSuiteT): EvalCaseT[] {
  const dir = casesDir();
  const files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  const cases: EvalCaseT[] = [];
  for (const file of files) {
    const raw = readFileSync(path.join(dir, file), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = EvalCase.parse(JSON.parse(line));
      if (!suite || parsed.suite === suite) cases.push(parsed);
    }
  }
  return cases;
}

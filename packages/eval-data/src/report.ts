import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EvalReport, type EvalReportT } from "./schema";

export function reportPath(provider: "chalk" | "local", root = process.cwd()): string {
  return path.join(root, "data", "eval", `${provider}-latest.json`);
}

export async function writeReport(report: EvalReportT, root = process.cwd()): Promise<string> {
  const parsed = EvalReport.parse(report);
  const file = reportPath(parsed.provider, root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return file;
}

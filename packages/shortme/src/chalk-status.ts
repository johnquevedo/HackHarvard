import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { EvalReport, type IntegrationStatusT } from "@dennis/contracts";
import type { PlatformContext } from "@dennis/platform";

// Chalk is an A3 integration with no runtime provider: its evidence is the report file written by
// services/chalk-eval. LIVE only for a parseable report with provider "chalk"; anything else is the
// honest fallback label LOCAL RUN (NOT CHALK).

export function findEvalDir(
  start: string = process.env.INIT_CWD ?? process.cwd(),
): string {
  let dir = resolve(start);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "services", "chalk-eval")))
      return join(dir, "data", "eval");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start, "data", "eval");
}

export function readChalkReport(evalDir: string) {
  const path = join(evalDir, "chalk-latest.json");
  if (!existsSync(path))
    return { report: null, problem: "no chalk report yet" };
  try {
    const parsed = EvalReport.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success)
      return {
        report: null,
        problem: "chalk report does not match EvalReport",
      };
    if (parsed.data.provider !== "chalk")
      return { report: null, problem: "report is not a Chalk run" };
    return { report: parsed.data, problem: null };
  } catch {
    return { report: null, problem: "chalk report unreadable" };
  }
}

export function chalkStatus(
  evalDir: string,
  nowIso: string,
): IntegrationStatusT {
  const { report, problem } = readChalkReport(evalDir);
  if (!report) {
    return {
      name: "chalk",
      mode: "fallback",
      healthy: false,
      detail: `LOCAL RUN (NOT CHALK): ${problem}`,
      lastCheckedAt: nowIso,
      lastSuccessAt: null,
    };
  }
  return {
    name: "chalk",
    mode: "live",
    healthy: true,
    detail: `CHALK EVAL run ${report.runId}`,
    lastCheckedAt: nowIso,
    lastSuccessAt: report.finishedAt,
  };
}

const lastRunId = new WeakMap<PlatformContext, string>();

// Reports the badge and emits eval.report once per new Chalk run id.
export function reportChalkStatus(
  ctx: PlatformContext,
  evalDir: string = findEvalDir(),
): IntegrationStatusT {
  const status = chalkStatus(evalDir, ctx.clock.nowIso());
  ctx.integrations.report(status);
  const { report } = readChalkReport(evalDir);
  if (report && lastRunId.get(ctx) !== report.runId) {
    lastRunId.set(ctx, report.runId);
    ctx.events.emit({
      type: "eval.report",
      actor: { kind: "system" },
      visibility: "system",
      payload: { provider: "chalk", runId: report.runId },
    });
  }
  return status;
}

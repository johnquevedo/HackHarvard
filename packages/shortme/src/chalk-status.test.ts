import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestPlatform } from "@dennis/platform/testing";
import { MockStructuredLlm } from "@dennis/llm";
import { chalkStatus, findEvalDir, reportChalkStatus } from "./chalk-status";

const report = (provider: string, runId: string) => ({
  provider,
  runId,
  startedAt: "2026-10-17T20:00:00.000Z",
  finishedAt: "2026-10-17T20:05:00.000Z",
  datasetVersion: "v1-eval-data",
  dashboardUrl: null,
  suites: [
    {
      suite: "milestone_extraction",
      total: 24,
      precision: 1,
      recall: 0.9,
      f1: 0.947,
      falsePositives: 0,
      privacyLeaks: 0,
    },
  ],
  successes: [],
  failures: [],
});

function dir(): string {
  const d = mkdtempSync(join(tmpdir(), "a3-eval-"));
  mkdirSync(d, { recursive: true });
  return d;
}

describe("chalk integration status", () => {
  it("is LOCAL RUN (NOT CHALK) without a report, for a local report, or a malformed file", () => {
    const d = dir();
    expect(chalkStatus(d, "2026-10-17T20:10:00.000Z")).toMatchObject({
      mode: "fallback",
      healthy: false,
      detail: expect.stringContaining("LOCAL RUN (NOT CHALK)"),
    });
    writeFileSync(
      join(d, "chalk-latest.json"),
      JSON.stringify(report("local", "local-1")),
    );
    expect(chalkStatus(d, "x").mode).toBe("fallback");
    writeFileSync(join(d, "chalk-latest.json"), "{not json");
    expect(chalkStatus(d, "x").detail).toContain("unreadable");
  });

  it("is live with the Chalk run id and emits eval.report once per run", async () => {
    const ctx = await createTestPlatform({ llm: new MockStructuredLlm() });
    const d = dir();
    writeFileSync(
      join(d, "chalk-latest.json"),
      JSON.stringify(report("chalk", "evr_123")),
    );
    expect(reportChalkStatus(ctx, d)).toMatchObject({
      mode: "live",
      healthy: true,
      detail: "CHALK EVAL run evr_123",
    });
    reportChalkStatus(ctx, d);
    const events = ctx.events
      .history({ judge: true, limit: 1000 })
      .filter((e) => e.type === "eval.report");
    expect(events.map((e) => e.payload)).toEqual([
      { provider: "chalk", runId: "evr_123" },
    ]);
    expect(ctx.integrations.list().find((s) => s.name === "chalk")?.mode).toBe(
      "live",
    );
  });

  it("finds data/eval at the repository root from a nested cwd", () => {
    expect(findEvalDir(join(process.cwd(), "packages", "shortme"))).toBe(
      join(process.cwd(), "data", "eval"),
    );
  });
});

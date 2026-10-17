import { describe, expect, it } from "vitest";
import { runReset, type ResetContext } from "./reset-demo";

function memory(): { ctx: ResetContext; snapshot: () => string } {
  const state = {
    paused: false,
    rows: 2,
    points: 0,
    balances: "150000,120000,0",
    events: [] as string[],
  };
  const ctx: ResetContext = {
    async setPaused(paused) {
      state.paused = paused;
    },
    async drain() {},
    async resetCore() {
      state.rows = 0;
    },
    purchasing: {
      async reset() {
        state.rows = 0;
      },
      async seed() {
        state.balances = "150000,120000,0";
      },
    },
    shortme: {
      async reset() {
        state.points = 1000;
      },
      async seed() {
        state.points = 1000;
      },
    },
    async readBalances() {
      return state.balances;
    },
    async emitDemoReset(runId) {
      state.events.push(runId);
    },
    newRunId: () => "run_fixed",
  };
  return {
    ctx,
    snapshot: () =>
      JSON.stringify({
        paused: state.paused,
        rows: state.rows,
        points: state.points,
        balances: state.balances,
      }),
  };
}

describe("demo reset", () => {
  it("is idempotent", async () => {
    const first = memory();
    const second = memory();
    await runReset(first.ctx);
    await runReset(first.ctx);
    await runReset(second.ctx);
    expect(first.snapshot()).toBe(second.snapshot());
  });
});

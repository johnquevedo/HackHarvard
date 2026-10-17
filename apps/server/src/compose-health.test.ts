import { afterEach, expect, it, vi } from "vitest";
import { createTestPlatform } from "../../../packages/platform/src/testing.ts";
import { drainPlatform, pollIntegrationHealth } from "../../../packages/platform/src/index.ts";
const { health } = vi.hoisted(() => ({ health: vi.fn() }));
vi.mock("@dennis/purchasing", async () => {
  const { Hono } = await import("hono");
  return {
    purchasingModule: {
      name: "purchasing",
      async register() {},
      async seed() {},
      routes: () => new Hono(),
    },
    createBankingProvider: () => ({ health }),
  };
});
vi.mock("../../../packages/shortme/src/chalk-status.ts", () => ({
  reportChalkStatus: (ctx: { clock: { nowIso(): string } }) => ({
    name: "chalk",
    mode: "fallback",
    healthy: false,
    detail: "LOCAL RUN (NOT CHALK)",
    lastCheckedAt: ctx.clock.nowIso(),
    lastSuccessAt: null,
  }),
}));
import { compose } from "./compose.ts";
afterEach(() => vi.clearAllMocks());
it("wires the actual banking factory and report-backed Chalk check into runtime polling", async () => {
  const ctx = await createTestPlatform();
  health.mockImplementation(async () => ({
    name: "nessie",
    mode: "simulated",
    healthy: true,
    detail: "SIMULATED BANK",
    lastCheckedAt: ctx.clock.nowIso(),
    lastSuccessAt: ctx.clock.nowIso(),
  }));
  try {
    await compose(ctx);
    await pollIntegrationHealth(ctx);
    await pollIntegrationHealth(ctx);
    expect(health).toHaveBeenCalledTimes(2);
    expect(ctx.integrations.list().find((s) => s.name === "nessie")).toMatchObject({
      healthy: true,
      mode: "simulated",
    });
    expect(ctx.integrations.list().find((s) => s.name === "chalk")).toMatchObject({
      healthy: false,
      mode: "fallback",
    });
  } finally {
    await drainPlatform(ctx);
    ctx.db.$client.close();
  }
});

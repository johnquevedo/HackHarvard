export interface ResetContext {
  setPaused(paused: boolean): Promise<void>;
  drain(timeoutMs: number): Promise<void>;
  resetCore(opts: { keepUsers: true }): Promise<void>;
  purchasing: { reset(): Promise<void>; seed(): Promise<void> };
  shortme: { reset(): Promise<void>; seed(): Promise<void> };
  readBalances(): Promise<unknown>;
  emitDemoReset(runId: string): Promise<void>;
  newRunId(): string;
}

export async function runReset(ctx: ResetContext): Promise<{ runId: string }> {
  await ctx.setPaused(true);
  await ctx.drain(5000);
  await ctx.resetCore({ keepUsers: true });
  await ctx.purchasing.reset();
  await ctx.shortme.reset();
  await ctx.purchasing.seed();
  await ctx.shortme.seed();
  await ctx.readBalances();
  const runId = ctx.newRunId();
  await ctx.emitDemoReset(runId);
  await ctx.setPaused(false);
  return { runId };
}

async function loadModule(name: string): Promise<Record<string, unknown> | null> {
  try {
    const importer = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<Record<string, unknown>>;
    return await importer(name);
  } catch {
    return null;
  }
}

async function loadLiveContext(): Promise<ResetContext> {
  const platform = await loadModule("@dennis/platform");
  const purchasing = await loadModule("@dennis/purchasing");
  const shortme = await loadModule("@dennis/shortme");
  if (!platform || !purchasing || !shortme) {
    throw new Error(
      "demo reset needs @dennis/platform, @dennis/purchasing, and @dennis/shortme. They are not merged yet.",
    );
  }
  const create = platform.createPlatform as (() => Promise<Record<string, unknown>>) | undefined;
  if (!create)
    throw new Error("createPlatform is not exported yet. See docs/CONTRACT_REQUESTS.md.");
  const ctx = await create();
  const purchaseModule = purchasing.purchasingModule as {
    reset: (value: unknown) => Promise<void>;
    seed: (value: unknown) => Promise<void>;
  };
  const shortModule = shortme.shortmeModule as {
    reset: (value: unknown) => Promise<void>;
    seed: (value: unknown) => Promise<void>;
  };
  const resetCore = platform.resetCore as (
    value: unknown,
    opts: { keepUsers: true },
  ) => Promise<void>;
  return {
    async setPaused(paused) {
      const kv = ctx.kv as { set?: (key: string, value: string) => Promise<void> } | undefined;
      await kv?.set?.("inbound_paused", String(paused));
    },
    async drain() {},
    resetCore: (opts) => resetCore(ctx, opts),
    purchasing: {
      reset: () => purchaseModule.reset(ctx),
      seed: () => purchaseModule.seed(ctx),
    },
    shortme: {
      reset: () => shortModule.reset(ctx),
      seed: () => shortModule.seed(ctx),
    },
    async readBalances() {
      return null;
    },
    async emitDemoReset(runId) {
      const events = ctx.events as { emit?: (event: unknown) => Promise<void> } | undefined;
      await events?.emit?.({
        type: "demo.reset",
        visibility: "system",
        payload: { runId },
        actor: { kind: "system" },
      });
    },
    newRunId: () => `run_${Date.now().toString(36)}`,
  };
}

const entry = process.argv[1]?.replace(/\\/g, "/");
if (entry?.endsWith("scripts/reset-demo.ts")) {
  const ctx = await loadLiveContext();
  const result = await runReset(ctx);
  console.log(`READY run ${result.runId}`);
}

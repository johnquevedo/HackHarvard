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

interface LivePlatform {
  events: { emit(event: unknown): Promise<void> };
}

async function loadModule(name: string): Promise<Record<string, unknown>> {
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<Record<string, unknown>>;
  return importer(name);
}

async function loadLiveContext(): Promise<ResetContext> {
  const platform = await loadModule("@dennis/platform/foundation");
  const configMod = await loadModule("@dennis/platform/config");
  const purchasing = await loadModule("@dennis/purchasing");
  const shortme = await loadModule("@dennis/shortme");
  const loadConfig = configMod.loadConfig as (env: NodeJS.ProcessEnv) => unknown;
  const createPlatform = platform.createPlatform as (opts: {
    config: unknown;
  }) => Promise<LivePlatform>;
  const ctx = await createPlatform({ config: loadConfig(process.env) });
  const resetCore = platform.resetCore as (
    value: LivePlatform,
    opts: { keepUsers: true },
  ) => Promise<void>;
  const purchaseModule = purchasing.purchasingModule as {
    reset: (value: LivePlatform) => Promise<void>;
    seed: (value: LivePlatform) => Promise<void>;
  };
  const shortModule = shortme.shortmeModule as {
    reset: (value: LivePlatform) => Promise<void>;
    seed: (value: LivePlatform) => Promise<void>;
  };
  return {
    async setPaused() {},
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
      await ctx.events.emit({
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

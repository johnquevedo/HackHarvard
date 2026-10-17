import { readFileSync, existsSync } from "node:fs";
import { Hono } from "hono";
import { EvalReport } from "./schema";
import { DEMO_SCRIPTS, type DemoScriptName } from "./scripts";
import { reportPath } from "./report";
import { runLocalEval } from "./local-runner";

interface EvalHost {
  nowIso?: () => string;
  simulateInbound?: (input: {
    fromUserId: string;
    text: string;
    clientMessageId: string;
  }) => Promise<{ messageId: string; accepted?: boolean }>;
  resetDemo?: () => Promise<{ runId: string }>;
  demoState?: () => Promise<{
    runId: string;
    modes: Record<string, string>;
    checklist: { id: string; label: string; ok: boolean }[];
  }>;
  replayStart?: (file?: string) => Promise<{ status: "running" }>;
  replayStop?: () => Promise<{ status: "stopped" }>;
}

let activeRun = false;

function unavailable(message: string) {
  return { error: { code: "integration_unavailable", message } };
}

interface ScriptContext {
  messaging: { name: string };
  users: { get(id: string): Promise<{ handle: string } | null> };
  clock: { nowIso(): string };
  config: { photonAccountKey: string };
}

async function sendSimulated(
  ctx: ScriptContext,
  input: {
    provider: "sim";
    accountKey: string;
    providerMessageId: string;
    providerSpaceId: null;
    providerSenderId: null;
    senderHandle: string;
    text: string;
    receivedAt: string;
    mode: "simulated";
  },
): Promise<{ messageId: string | null }> {
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<{
    ingestInbound: (
      value: ScriptContext,
      message: unknown,
    ) => Promise<{ messageId: string | null }>;
  }>;
  const mod = await importer("@dennis/platform/pipeline");
  return mod.ingestInbound(ctx, input);
}

export function evalDemoRoutes(ctx: ScriptContext & EvalHost): Hono {
  const host = ctx;
  const app = new Hono();

  app.post("/api/demo/script/:name", async (c) => {
    const name = c.req.param("name");
    if (!(name in DEMO_SCRIPTS))
      return c.json({ error: { code: "not_found", message: "unknown script" } }, 404);
    const script = DEMO_SCRIPTS[name as DemoScriptName];
    if (!host.simulateInbound) {
      if (ctx.messaging.name !== "sim") {
        return c.json(unavailable("Simulator provider is not active"), 409);
      }
      const user = await ctx.users.get(script.fromUserId);
      if (!user) return c.json({ error: { code: "not_found", message: "User not found" } }, 404);
      const result = await sendSimulated(ctx, {
        provider: "sim",
        accountKey: ctx.config.photonAccountKey,
        providerMessageId: `script_${name}_${ctx.clock.nowIso()}`,
        providerSpaceId: null,
        providerSenderId: null,
        senderHandle: user.handle,
        text: script.text,
        receivedAt: ctx.clock.nowIso(),
        mode: "simulated",
      });
      return c.json({ messageId: result.messageId, label: "SIMULATED INBOUND" });
    }
    const result = await host.simulateInbound({
      fromUserId: script.fromUserId,
      text: script.text,
      clientMessageId: `script_${name}_${host.nowIso?.() ?? Date.now()}`,
    });
    return c.json({ messageId: result.messageId, label: "SIMULATED INBOUND" });
  });

  app.get("/api/eval/report", (c) => {
    const provider = c.req.query("provider") === "chalk" ? "chalk" : "local";
    const file = reportPath(provider);
    if (!existsSync(file))
      return c.json({ error: { code: "not_found", message: "no eval run yet" } }, 404);
    const report = EvalReport.parse(JSON.parse(readFileSync(file, "utf8")));
    return c.json(report);
  });

  app.post("/api/eval/local/run", async (c) => {
    if (activeRun) return c.json({ error: { code: "conflict", message: "a run is active" } }, 409);
    activeRun = true;
    const run = runLocalEval().finally(() => {
      activeRun = false;
    });
    const pending = await Promise.race([
      run.then((report) => ({ settled: true as const, report })),
      new Promise<{ settled: false }>((resolve) =>
        setTimeout(() => resolve({ settled: false }), 20),
      ),
    ]);
    if (pending.settled) return c.json({ runId: pending.report.runId }, 202);
    return c.json({ runId: "eval_pending" }, 202);
  });

  app.post("/api/demo/reset", async (c) => {
    if (!host.resetDemo) return c.json(unavailable("resetDemo is not wired"), 503);
    const result = await host.resetDemo();
    return c.json(result);
  });

  app.get("/api/demo/state", async (c) => {
    if (!host.demoState) return c.json(unavailable("demoState is not wired"), 503);
    return c.json(await host.demoState());
  });

  app.post("/api/demo/replay/start", async (c) => {
    if (!host.replayStart) return c.json(unavailable("replayStart is not wired"), 503);
    const body = (await c.req.json().catch(() => ({}))) as { file?: string };
    return c.json(await host.replayStart(body.file));
  });

  app.post("/api/demo/replay/stop", async (c) => {
    if (!host.replayStop) return c.json(unavailable("replayStop is not wired"), 503);
    return c.json(await host.replayStop());
  });

  return app;
}

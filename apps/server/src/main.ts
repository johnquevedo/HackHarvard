import { serve } from "@hono/node-server";
import { compose, featureModules } from "./compose.ts";
import { createStructuredLlm } from "@dennis/llm";
import { loadConfig, createPlatform, seedCore, startRuntime } from "@dennis/platform";
const config = loadConfig(process.env);
const ctx = await createPlatform({ config, llm: createStructuredLlm(config) });
await seedCore(ctx);
const app = await compose(ctx);
for (const module of featureModules) await module.recover(ctx);
const runtime = await startRuntime(ctx);
const server = serve({
  fetch: app.fetch,
  port: config.portServer,
  hostname: "127.0.0.1",
});
process.stdout.write(
  `Dennis server listening on http://127.0.0.1:${config.portServer}; messaging=${ctx.messaging.name}\n`,
);
async function stop() {
  server.close();
  await runtime.stop();
  ctx.db.$client.close();
}
process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});

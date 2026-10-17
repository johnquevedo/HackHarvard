import { configureDemoLlm } from "./demo-llm.ts";
import { Hono } from "hono";
import type { PlatformContext } from "@dennis/platform";
import { mountPlatformRoutes, registerIntegrationHealth } from "@dennis/platform";
import * as purchasing from "@dennis/purchasing";
import { reportChalkStatus } from "../../../packages/shortme/src/chalk-status.ts";
const { purchasingModule } = purchasing;
type BankingHealthFactory = (
  config: PlatformContext["config"],
  deps: Pick<PlatformContext, "db" | "clock" | "log">,
) => { health(): Promise<ReturnType<PlatformContext["integrations"]["list"]>[number]> };
import { shortmeModule } from "@dennis/shortme";
import { evalDemoRoutes } from "@dennis/eval-data";
export const featureModules = [purchasingModule, shortmeModule];
export async function compose(ctx: PlatformContext): Promise<Hono> {
  configureDemoLlm(ctx);
  const app = new Hono();
  mountPlatformRoutes(app, ctx);
  for (const module of featureModules) {
    await module.register(ctx);
    await module.seed(ctx);
    app.route("/api/" + module.name, module.routes(ctx));
  }
  const bankFactory = (purchasing as unknown as { createBankingProvider?: BankingHealthFactory })
    .createBankingProvider;
  if (bankFactory)
    registerIntegrationHealth(ctx, "nessie", () => bankFactory(ctx.config, ctx).health());
  registerIntegrationHealth(ctx, "chalk", async () => reportChalkStatus(ctx));
  app.route("/", evalDemoRoutes(ctx));
  return app;
}

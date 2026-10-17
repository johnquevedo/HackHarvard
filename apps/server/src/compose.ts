import { Hono } from "hono";
import type { PlatformContext } from "@dennis/platform";
import { mountPlatformRoutes } from "@dennis/platform";
import { purchasingModule } from "@dennis/purchasing";
import { shortmeModule } from "@dennis/shortme";
import { evalDemoRoutes } from "@dennis/eval-data";
export const featureModules = [purchasingModule, shortmeModule];
export async function compose(ctx: PlatformContext): Promise<Hono> {
  const app = new Hono();
  mountPlatformRoutes(app, ctx);
  for (const module of featureModules) {
    await module.register(ctx);
    await module.seed(ctx);
    app.route("/api/" + module.name, module.routes(ctx));
  }
  app.route("/", evalDemoRoutes(ctx));
  return app;
}

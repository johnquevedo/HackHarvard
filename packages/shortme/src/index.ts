import { Hono } from "hono";
import type { FeatureModule } from "@dennis/platform";
// A1-01 foundation stub. The feature owner replaces this module in M0.
export const shortmeModule: FeatureModule = {
  name: "shortme",
  async register() {},
  routes() {
    return new Hono();
  },
  async seed() {},
  async reset() {},
  async recover() {},
};

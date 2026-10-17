import { defineConfig } from "vitest/config";
import acceptance from "./packages/platform/vitest.acceptance.config.ts";

const e2e = process.env.DENNIS_E2E === "1";

export default defineConfig({
  resolve: {
    alias: acceptance.resolve?.alias,
  },
  test: {
    environment: "node",
    include: e2e
      ? ["tests/e2e/**/*.test.ts"]
      : [
          "scripts/**/*.test.ts",
          "packages/**/*.test.ts",
          "tests/cross/**/*.test.ts",
          "apps/server/**/*.test.ts",
          "apps/web/**/*.test.ts",
          "apps/web/**/*.test.tsx",
        ],
  },
});

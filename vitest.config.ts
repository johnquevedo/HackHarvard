import path from "node:path";
import { defineConfig } from "vitest/config";

const e2e = process.env.DENNIS_E2E === "1";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve("apps/web/src"),
    },
  },
  test: {
    environment: "node",
    include: e2e
      ? ["tests/e2e/**/*.test.ts"]
      : [
          "scripts/**/*.test.ts",
          "packages/**/*.test.ts",
          "apps/web/**/*.test.ts",
          "apps/web/**/*.test.tsx",
        ],
  },
});

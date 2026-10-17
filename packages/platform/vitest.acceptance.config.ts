import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
const source = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
export default defineConfig({
  resolve: {
    alias: [
      { find: "@dennis/platform/testing", replacement: source("./src/testing.ts") },
      ...[
        "contracts",
        "db",
        "platform",
        "messaging",
        "llm",
        "shortme",
        "purchasing",
        "eval-data",
      ].map((name) => ({
        find: new RegExp("^@dennis/" + name + "$"),
        replacement: source("../" + name + "/src/index.ts"),
      })),
      { find: /^hono$/, replacement: source("./node_modules/hono/dist/index.js") },
      { find: "@", replacement: source("../../apps/web/src") },
    ],
  },
  test: {
    environment: "node",
    include: [
      "scripts/**/*.test.ts",
      "packages/**/*.test.ts",
      "tests/cross/**/*.test.ts",
      "apps/web/**/*.test.ts",
      "apps/web/**/*.test.tsx",
    ],
  },
});

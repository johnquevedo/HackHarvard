import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const entry = "packages/db/src/index.ts";
if (!existsSync(entry)) {
  console.error("db:push waits for packages/db from Agent 1.");
  process.exit(1);
}
const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
const result = spawnSync(process.execPath, [tsx, entry], { stdio: "inherit" });
process.exit(result.status ?? 1);

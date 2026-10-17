import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function collect(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    const config = path.join(full, "tsconfig.json");
    if (existsSync(config)) found.push(config);
  }
  return found;
}

const tsc = path.resolve("node_modules/typescript/bin/tsc");
const configs = [...collect("apps"), ...collect("packages"), "tsconfig.json"];
let failed = false;
for (const config of configs) {
  const result = spawnSync(process.execPath, [tsc, "-p", config, "--noEmit"], { stdio: "inherit" });
  if (result.status !== 0) failed = true;
}
if (failed) process.exit(1);

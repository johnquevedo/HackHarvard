import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const entry = "apps/server/src/main.ts";

if (!existsSync(entry)) {
  console.log(
    "apps/server/src/main.ts is not in this checkout yet (Agent 1). Web mock mode does not need it.",
  );
  setInterval(() => {}, 1 << 30);
} else {
  const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
  const child = spawn(process.execPath, [tsx, entry], { stdio: "inherit", env: process.env });
  child.on("exit", (code) => process.exit(code ?? 1));
}

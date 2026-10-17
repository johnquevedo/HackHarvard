import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const command =
  process.argv[2] === "start" ? "start" : process.argv[2] === "build" ? "build" : "dev";
const port = process.env.PORT_WEB || "3104";
const require = createRequire(import.meta.url);
const nextPkg = require.resolve("next/package.json");
const bin = path.join(path.dirname(nextPkg), "dist/bin/next");
const args = command === "build" ? [bin, "build"] : [bin, command, "--port", port];
const child = spawn(process.execPath, args, {
  stdio: "inherit",
  cwd: path.dirname(fileURLToPath(import.meta.url)),
});
child.on("exit", (code) => process.exit(code ?? 1));

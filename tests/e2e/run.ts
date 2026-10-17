import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const serverEntry = "apps/server/src/main.ts";
let child: ReturnType<typeof spawn> | null = null;

if (existsSync(serverEntry)) {
  const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
  child = spawn(process.execPath, [tsx, serverEntry], {
    stdio: "inherit",
    env: {
      ...process.env,
      PHOTON_MODE: "sim",
      NESSIE_MODE: "sim",
      LLM_PROVIDER: "mock",
      PORT_SERVER: process.env.PORT_SERVER ?? "4104",
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  process.env.E2E_BASE_URL = `http://localhost:${process.env.PORT_SERVER ?? "4104"}`;
} else {
  console.log(
    "e2e:sim FALLBACK: apps/server is not merged. Privacy scan and scenario catalog still run. Story HTTP checks wait for Agent 1.",
  );
}

const vitest = path.resolve("node_modules/vitest/vitest.mjs");
const result = spawnSync(process.execPath, [vitest, "run"], {
  stdio: "inherit",
  env: { ...process.env, DENNIS_E2E: "1" },
});

child?.kill();
process.exit(result.status ?? 1);

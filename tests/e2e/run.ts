import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const serverEntry = "apps/server/src/main.ts";
let child: ReturnType<typeof spawn> | null = null;
const port = process.env.PORT_SERVER ?? "4104";
const adminToken = "e2e-admin-token-16";

if (existsSync(serverEntry)) {
  rmSync("data/a4-e2e.db", { force: true });
  const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
  child = spawn(process.execPath, [tsx, serverEntry], {
    stdio: "inherit",
    env: {
      ...process.env,
      DENNIS_MODE: "sim",
      PHOTON_MODE: "sim",
      NESSIE_MODE: "sim",
      LLM_PROVIDER: "mock",
      PORT_SERVER: port,
      DATABASE_URL: "file:./data/a4-e2e.db",
      DENNIS_ADMIN_TOKEN: adminToken,
    },
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      ready = false;
    }
  }
  if (!ready) {
    child.kill();
    console.error("e2e:sim: server did not become healthy");
    process.exit(1);
  }
  process.env.E2E_BASE_URL = base;
  process.env.E2E_ADMIN_TOKEN = adminToken;
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

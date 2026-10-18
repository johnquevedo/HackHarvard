import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const PREFIXES: Record<string, string> = {
  PHOTON_PROJECT_ID: "pho_prj_",
  PHOTON_API_KEY: "pho_sk_",
  PHOTON_AGENT_USER_ID: "pho_usr_",
};

export function loadEnvFile(file = ".env"): Record<string, string> {
  if (!existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    values[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return values;
}

export function prefixProblems(env: Record<string, string>): string[] {
  const problems: string[] = [];
  const spectrum = Boolean(env.PHOTON_PROJECT_SECRET);
  for (const [key, prefix] of Object.entries(PREFIXES)) {
    if (spectrum) {
      if (key === "PHOTON_PROJECT_ID" && env[key] && !/^[0-9a-f-]{36}$/i.test(env[key]))
        problems.push("PHOTON_PROJECT_ID must be the UUID shown in the Photon dashboard");
      continue;
    }
    const value = env[key];
    if (value && !value.startsWith(prefix)) problems.push(`${key} must start with ${prefix}`);
  }
  return problems;
}

export async function checkEndpoints(
  base: string,
): Promise<{ id: string; ok: boolean; detail: string }[]> {
  const checks = ["/api/health", "/api/integrations"];
  const results = [];
  for (const route of checks) {
    try {
      const response = await fetch(`${base}${route}`);
      results.push({
        id: route,
        ok: response.ok,
        detail: response.ok ? "ok" : `status ${response.status}`,
      });
    } catch {
      results.push({ id: route, ok: false, detail: "unreachable" });
    }
  }
  return results;
}

async function main(): Promise<void> {
  const env = { ...loadEnvFile(), ...process.env } as Record<string, string>;
  const problems = prefixProblems(env);
  for (const problem of problems) console.error(problem);
  const base = env.API_BASE_URL || `http://localhost:${env.PORT_SERVER || "4104"}`;
  const checks = await checkEndpoints(base);
  for (const check of checks)
    console.log(`${check.ok ? "OK" : "FAIL"} ${check.id} ${check.detail}`);
  const mock = env.NEXT_PUBLIC_API_MODE === "mock";
  if (problems.length > 0) process.exit(1);
  if (!mock && checks.some((check) => !check.ok)) process.exit(1);
  if (mock && checks.some((check) => !check.ok)) {
    console.log("mock mode: server checks are not required");
  }
  console.log("demo:check finished");
}

const entry = process.argv[1]?.replace(/\\/g, "/");
if (entry?.endsWith("scripts/check-env.ts")) {
  await main();
}

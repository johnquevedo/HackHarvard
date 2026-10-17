import { AppConfigSchema } from "@dennis/contracts";
import type { AppConfig } from "@dennis/contracts";
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(AppConfigSchema.shape)) {
    const envKey = key.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase();
    values[key] = env[envKey];
  }
  if (!values.photonMode) values.photonMode = values.dennisMode === "sim" ? "sim" : "live";
  if (!values.nessieMode) values.nessieMode = values.dennisMode === "sim" ? "sim" : "live";
  if (!values.llmProvider) values.llmProvider = values.dennisMode === "sim" ? "mock" : "anthropic";
  return AppConfigSchema.parse(values);
}

import { DennisError } from "@dennis/contracts";
import type { AppConfig, StructuredLlm } from "@dennis/contracts";
// A1-01 foundation stub. Agent 3 replaces this in M0.
export function createStructuredLlm(_config: AppConfig): StructuredLlm {
  return {
    name: "mock",
    async generate() {
      throw new DennisError(
        "integration_unavailable",
        "LLM adapter has not been configured",
        503,
      );
    },
    async health() {
      return {
        name: "llm",
        mode: "simulated",
        healthy: false,
        detail: "MOCK LLM foundation stub; no live inference",
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: null,
      };
    },
  };
}

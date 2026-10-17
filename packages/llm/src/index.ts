import type {
  AppConfig,
  Clock,
  IntegrationStatusT,
  Logger,
  StructuredLlm,
} from "@dennis/contracts";
import { AnthropicLlm } from "./anthropic";
import { ChalkGatewayLlm } from "./chalk-gateway";
import { LlmUnavailableError } from "./errors";
import { MockStructuredLlm } from "./mock";

export { AnthropicLlm, mapAnthropicError, type AnthropicMode } from "./anthropic";
export { ChalkGatewayLlm } from "./chalk-gateway";
export { MockStructuredLlm, defaultMockRules, type MockRule } from "./mock";
export { LlmSchemaError, LlmUnavailableError } from "./errors";
export { runStructured } from "./core";
export { loadPrompt, todayIn, wrapContext, wrapUserText } from "./prompts";

// An LLM that is selected but cannot run (missing key). It never pretends: every call fails as
// llm_unavailable and health reports unhealthy, so the badge shows the real problem.
class UnavailableLlm implements StructuredLlm {
  readonly name: "anthropic" | "chalk_gateway";
  constructor(
    name: "anthropic" | "chalk_gateway",
    private readonly detail: string,
  ) {
    this.name = name;
  }
  async generate(): Promise<never> {
    throw new LlmUnavailableError("any", "config", this.detail);
  }
  async health(): Promise<IntegrationStatusT> {
    const now = new Date().toISOString();
    return {
      name: "llm",
      mode: "live",
      healthy: false,
      detail: this.detail,
      lastCheckedAt: now,
      lastSuccessAt: null,
    };
  }
}

// LLM_PROVIDER selects the implementation: anthropic (default), chalk, mock. DENNIS_MODE=sim forces mock.
// There is no silent downgrade from a live provider to the mock (Section 17.1).
const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
};
const consoleLog: Logger = {
  debug() {},
  info() {},
  warn: (msg, meta) => console.warn(msg, meta ?? {}),
  error: (msg, meta) => console.error(msg, meta ?? {}),
};

// `deps` is optional because apps/server calls createStructuredLlm(config) with the config only.
export function createStructuredLlm(
  cfg: AppConfig,
  deps: { clock: Clock; log: Logger } = { clock: systemClock, log: consoleLog },
): StructuredLlm {
  const c = cfg as AppConfig & Record<string, unknown>;
  const provider =
    c.dennisMode === "sim" ? "mock" : ((c.llmProvider as string | undefined) ?? "anthropic");
  const timeoutMs = Number(c.llmTimeoutMs ?? 8000);
  if (provider === "mock") return new MockStructuredLlm();
  if (provider === "chalk") {
    const baseUrl = c.chalkGatewayBaseUrl as string | undefined;
    const token = c.chalkApiToken as string | undefined;
    if (!baseUrl || !token)
      return new UnavailableLlm(
        "chalk_gateway",
        "CHALK_GATEWAY_BASE_URL or CHALK_API_TOKEN missing",
      );
    return new ChalkGatewayLlm({
      baseUrl,
      apiToken: token,
      model: (c.chalkGatewayModel as string | undefined) ?? "claude-sonnet-5-5",
      timeoutMs,
      ...deps,
    });
  }
  const apiKey = c.anthropicApiKey as string | undefined;
  if (!apiKey) return new UnavailableLlm("anthropic", "ANTHROPIC_API_KEY missing");
  return new AnthropicLlm({
    apiKey,
    model: (c.llmModel as string | undefined) ?? "claude-sonnet-5-5",
    timeoutMs,
    ...deps,
  });
}

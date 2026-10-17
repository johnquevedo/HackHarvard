// Typed LLM failures. Detectors map LlmSchemaError to `schema_invalid` and LlmUnavailableError
// (timeout, 5xx, network, missing credentials) to `llm_unavailable`.

export class LlmSchemaError extends Error {
  constructor(
    public readonly task: string,
    public readonly issues: string,
    public readonly attempts: number,
  ) {
    super(
      `LLM output for ${task} failed schema validation after ${attempts} attempt(s): ${issues}`,
    );
    this.name = "LlmSchemaError";
  }
}

export class LlmUnavailableError extends Error {
  constructor(
    public readonly task: string,
    public readonly reason: "timeout" | "upstream" | "rate_limited" | "config" | "refused",
    message: string,
  ) {
    super(`LLM unavailable for ${task} (${reason}): ${message}`);
    this.name = "LlmUnavailableError";
  }
}

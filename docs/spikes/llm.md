# Spike A3-02: LLM structured output

Status: code paths verified against the pinned SDK; live latency NOT yet measured (no `ANTHROPIC_API_KEY` on the A3 machine at T+0:50). LLM stays on `MockStructuredLlm` for development only until the key arrives. Run `pnpm spike:llm` to fill in the table below.

## Verified from the pinned SDK (`@anthropic-ai/sdk` 0.135.0)

| Fact                                                                                                  | Evidence                                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `client.messages.parse(params, options)` exists and returns `parsed_output`                           | `resources/messages/messages.d.ts` line 52, `lib/parser.d.ts` |
| `output_config.format` accepts `zodOutputFormat(schema)` from `@anthropic-ai/sdk/helpers/zod`         | `helpers/zod.d.ts`                                            |
| Forced tool call: `tool_choice: { type: "tool", name }`                                               | `ToolChoiceTool` type                                         |
| Typed errors: `APIConnectionTimeoutError`, `RateLimitError`, `InternalServerError`, `BadRequestError` | `core/error.d.ts`                                             |
| `client.models.retrieve(model)` for a token-free health check                                         | `resources/models.d.ts`                                       |

## Decision

- Default path: `messages.parse` with `zodOutputFormat` (mode `output_format`).
- Automatic fallback: the first `400` on that path switches the adapter to the forced tool call (mode `tool`) with `z.toJSONSchema(schema)` and keeps using it. Either path ends in `schema.safeParse`.
- Retries: one retry on timeout, 5xx, or 429; one retry with a corrective note on invalid output; at most three calls. Then `LlmUnavailableError` (detector reason `llm_unavailable`) or `LlmSchemaError` (`schema_invalid`).
- Client retries are disabled (`maxRetries: 0`) so the adapter owns the retry budget and the latency numbers are honest.
- Missing key never downgrades to the mock: `createStructuredLlm` returns an unavailable LLM whose health is red.

## To measure (fill in after `pnpm spike:llm`)

| Model             | Path          | Correct of 10 | p50 ms | p95 ms |
| ----------------- | ------------- | ------------- | ------ | ------ |
| claude-sonnet-5-5 | output_format |               |        |        |
| claude-sonnet-5-5 | tool          |               |        |        |
| claude-haiku-5-5  | output_format |               |        |        |
| claude-haiku-5-5  | tool          |               |        |        |

Switch `LLM_MODEL` to Haiku only if Sonnet p95 is above 4 seconds and eval F1 holds (Section 10.4).

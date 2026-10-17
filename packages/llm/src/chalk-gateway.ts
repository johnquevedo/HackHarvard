import OpenAI from "openai";
import { z } from "zod";
import type {
  Clock,
  IntegrationStatusT,
  Logger,
  StructuredLlm,
  StructuredRequest,
  StructuredResult,
} from "@dennis/contracts";
import { runStructured, type Transport } from "./core";
import { LlmUnavailableError } from "./errors";

export interface ChalkGatewayOptions {
  baseUrl: string;
  apiToken: string;
  model: string;
  timeoutMs: number;
  clock: Clock;
  log: Logger;
  client?: Pick<OpenAI, "chat" | "models">;
}

function mapError(task: string, err: unknown): LlmUnavailableError {
  if (err instanceof OpenAI.APIConnectionTimeoutError)
    return new LlmUnavailableError(task, "timeout", "request timed out");
  if (err instanceof OpenAI.RateLimitError)
    return new LlmUnavailableError(task, "rate_limited", "rate limited");
  if (err instanceof OpenAI.APIConnectionError)
    return new LlmUnavailableError(task, "upstream", "connection error");
  if (err instanceof OpenAI.APIError) {
    const s = err.status ?? 0;
    return new LlmUnavailableError(
      task,
      s >= 500 ? "upstream" : s === 401 || s === 403 ? "config" : "refused",
      `http ${s}`,
    );
  }
  return new LlmUnavailableError(
    task,
    "upstream",
    err instanceof Error ? err.message : String(err),
  );
}

// Optional provider (stretch S3): Chalk's OpenAI-compatible model gateway with JSON-schema output.
// Enabled only by LLM_PROVIDER=chalk and only after the A3-02 spike proves structured output works.
export class ChalkGatewayLlm implements StructuredLlm {
  readonly name = "chalk_gateway" as const;
  private readonly client: Pick<OpenAI, "chat" | "models">;
  private lastSuccessAt: string | null = null;

  constructor(private readonly opts: ChalkGatewayOptions) {
    this.client =
      opts.client ??
      new OpenAI({
        apiKey: opts.apiToken,
        baseURL: opts.baseUrl,
        maxRetries: 0,
        timeout: opts.timeoutMs,
      });
  }

  private transport: Transport = async (req, call) => {
    try {
      const res = await this.client.chat.completions.create(
        {
          model: this.opts.model,
          temperature: call.temperature,
          max_tokens: call.maxTokens,
          messages: [
            { role: "system", content: call.system },
            {
              role: "user",
              content: call.correctiveNote ? `${call.user}\n\n${call.correctiveNote}` : call.user,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: req.task.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
              schema: z.toJSONSchema(req.schema as z.ZodType) as Record<string, unknown>,
              strict: true,
            },
          },
        },
        { timeout: call.timeoutMs, maxRetries: 0 },
      );
      const text = res.choices[0]?.message?.content ?? "";
      let raw: unknown = null;
      try {
        raw = JSON.parse(text);
      } catch {
        raw = null;
      }
      return {
        raw,
        usage: {
          inputTokens: res.usage?.prompt_tokens ?? 0,
          outputTokens: res.usage?.completion_tokens ?? 0,
        },
        model: res.model ?? this.opts.model,
      };
    } catch (err) {
      throw mapError(req.task, err);
    }
  };

  async generate<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const r = await runStructured(req, this.transport, {
      provider: "chalk_gateway",
      defaultTimeoutMs: this.opts.timeoutMs,
      clock: this.opts.clock,
      log: this.opts.log,
    });
    this.lastSuccessAt = this.opts.clock.nowIso();
    return r;
  }

  async health(): Promise<IntegrationStatusT> {
    const checkedAt = this.opts.clock.nowIso();
    try {
      await this.client.models.list({ timeout: 4000, maxRetries: 0 });
      this.lastSuccessAt = checkedAt;
      return {
        name: "llm",
        mode: "live",
        healthy: true,
        detail: `chalk gateway ${this.opts.model}`,
        lastCheckedAt: checkedAt,
        lastSuccessAt: this.lastSuccessAt,
      };
    } catch (err) {
      return {
        name: "llm",
        mode: "live",
        healthy: false,
        detail: `chalk gateway ${mapError("health", err).reason}`,
        lastCheckedAt: checkedAt,
        lastSuccessAt: this.lastSuccessAt,
      };
    }
  }
}

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type {
  Clock,
  IntegrationStatusT,
  Logger,
  StructuredLlm,
  StructuredRequest,
  StructuredResult,
} from "@dennis/contracts";
import { runStructured, type Transport, type TransportCall } from "./core";
import { LlmUnavailableError } from "./errors";

export type AnthropicMode = "output_format" | "tool" | "json";

export interface AnthropicLlmOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  clock: Clock;
  log: Logger;
  mode?: AnthropicMode;
  // Injected in tests; defaults to the real SDK client.
  client?: Pick<Anthropic, "messages" | "models">;
}

// Minimal view of the SDK surface we call, so a fake client in tests needs no SDK internals.
interface MessageLike {
  content: { type: string; text?: string; input?: unknown; name?: string }[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  parsed_output?: unknown;
  stop_reason?: string | null;
}

export function mapAnthropicError(task: string, err: unknown): LlmUnavailableError {
  if (err instanceof LlmUnavailableError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return new LlmUnavailableError(task, "timeout", "request timed out");
  if (err instanceof Anthropic.RateLimitError)
    return new LlmUnavailableError(task, "rate_limited", "rate limited");
  if (err instanceof Anthropic.APIConnectionError)
    return new LlmUnavailableError(task, "upstream", "connection error");
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    if (status >= 500) return new LlmUnavailableError(task, "upstream", `http ${status}`);
    if (status === 401 || status === 403)
      return new LlmUnavailableError(task, "config", `http ${status}`);
    return new LlmUnavailableError(task, "refused", `http ${status}`);
  }
  if (err instanceof Error && err.name === "AbortError")
    return new LlmUnavailableError(task, "timeout", "aborted");
  return new LlmUnavailableError(
    task,
    "upstream",
    err instanceof Error ? err.message : String(err),
  );
}

function userContent(call: TransportCall): string {
  return call.correctiveNote ? `${call.user}\n\n${call.correctiveNote}` : call.user;
}

function toolName(task: string): string {
  return task.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "result";
}

export class AnthropicLlm implements StructuredLlm {
  readonly name = "anthropic" as const;
  private readonly client: Pick<Anthropic, "messages" | "models">;
  private mode: AnthropicMode;
  private temperatureSupported = true;
  private lastSuccessAt: string | null = null;

  constructor(private readonly opts: AnthropicLlmOptions) {
    this.client =
      opts.client ??
      new Anthropic({
        apiKey: opts.apiKey,
        maxRetries: 0,
        timeout: opts.timeoutMs,
      });
    this.mode = opts.mode ?? "output_format";
  }

  get currentMode(): AnthropicMode {
    return this.mode;
  }

  private async callOutputFormat<T>(
    req: StructuredRequest<T>,
    call: TransportCall,
  ): Promise<MessageLike> {
    return (await this.client.messages.parse(
      {
        model: this.opts.model,
        max_tokens: call.maxTokens,
        ...(this.temperatureSupported ? { temperature: call.temperature } : {}),
        system: call.system,
        messages: [{ role: "user", content: userContent(call) }],
        output_config: { format: zodOutputFormat(req.schema as z.ZodType) },
      } as never,
      { timeout: call.timeoutMs, maxRetries: 0 },
    )) as unknown as MessageLike;
  }

  private async callTool<T>(req: StructuredRequest<T>, call: TransportCall): Promise<MessageLike> {
    const name = toolName(req.task);
    return (await this.client.messages.create(
      {
        model: this.opts.model,
        max_tokens: call.maxTokens,
        ...(this.temperatureSupported ? { temperature: call.temperature } : {}),
        system: call.system,
        messages: [{ role: "user", content: userContent(call) }],
        tools: [
          {
            name,
            description: "Return the structured result.",
            input_schema: z.toJSONSchema(req.schema as z.ZodType) as never,
          },
        ],
        tool_choice: { type: "tool", name },
      } as never,
      { timeout: call.timeoutMs, maxRetries: 0 },
    )) as unknown as MessageLike;
  }

  private async callJson<T>(req: StructuredRequest<T>, call: TransportCall): Promise<MessageLike> {
    const schema = JSON.stringify(z.toJSONSchema(req.schema as z.ZodType));
    return (await this.client.messages.create(
      {
        model: this.opts.model,
        max_tokens: call.maxTokens,
        ...(this.temperatureSupported ? { temperature: call.temperature } : {}),
        system: `${call.system}\nReturn only one valid JSON object matching this JSON Schema, with no markdown or commentary:\n${schema}`,
        messages: [{ role: "user", content: userContent(call) }],
      } as never,
      { timeout: call.timeoutMs, maxRetries: 0 },
    )) as unknown as MessageLike;
  }

  private async withModelCompatibility(call: () => Promise<MessageLike>): Promise<MessageLike> {
    try {
      return await call();
    } catch (error) {
      if (
        this.temperatureSupported &&
        error instanceof Anthropic.BadRequestError &&
        /temperature.*deprecated/i.test(error.message)
      ) {
        this.temperatureSupported = false;
        this.opts.log.warn("llm.parameter_fallback", {
          parameter: "temperature",
          model: this.opts.model,
        });
        return call();
      }
      throw error;
    }
  }

  private transport: Transport = async (req, call) => {
    let msg: MessageLike;
    try {
      if (this.mode === "output_format") {
        try {
          msg = await this.withModelCompatibility(() => this.callOutputFormat(req, call));
        } catch (err) {
          // A 400 here usually means the structured-output path rejected a schema constraint:
          // switch to the forced tool call path (Section 10.4) and keep using it.
          if (err instanceof Anthropic.BadRequestError) {
            this.opts.log.warn("llm.mode_fallback", {
              task: req.task,
              to: "tool",
            });
            this.mode = "tool";
            try {
              msg = await this.withModelCompatibility(() => this.callTool(req, call));
            } catch (toolError) {
              if (!(toolError instanceof Anthropic.BadRequestError)) throw toolError;
              this.opts.log.warn("llm.mode_fallback", {
                task: req.task,
                to: "json",
              });
              this.mode = "json";
              msg = await this.withModelCompatibility(() => this.callJson(req, call));
            }
          } else if (
            err instanceof Anthropic.APIError ||
            (err instanceof Error && err.name === "AbortError")
          ) {
            throw err;
          } else {
            // Local parse failure inside the SDK helper: let the engine see an invalid object.
            return {
              raw: null,
              usage: { inputTokens: 0, outputTokens: 0 },
              model: this.opts.model,
            };
          }
        }
      } else if (this.mode === "tool") {
        try {
          msg = await this.withModelCompatibility(() => this.callTool(req, call));
        } catch (err) {
          if (!(err instanceof Anthropic.BadRequestError)) throw err;
          this.opts.log.warn("llm.mode_fallback", {
            task: req.task,
            to: "json",
          });
          this.mode = "json";
          msg = await this.withModelCompatibility(() => this.callJson(req, call));
        }
      } else {
        msg = await this.withModelCompatibility(() => this.callJson(req, call));
      }
    } catch (err) {
      throw mapAnthropicError(req.task, err);
    }
    if (msg.stop_reason === "refusal")
      throw new LlmUnavailableError(req.task, "refused", "model refused");
    let raw: unknown = null;
    if (this.mode === "tool") {
      raw = msg.content.find((b) => b.type === "tool_use")?.input ?? null;
    } else if (msg.parsed_output !== undefined && msg.parsed_output !== null) {
      raw = msg.parsed_output;
    } else {
      const text = msg.content.find((b) => b.type === "text")?.text;
      try {
        raw = text ? JSON.parse(text) : null;
      } catch {
        raw = null;
      }
    }
    return {
      raw,
      usage: {
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
      },
      model: msg.model ?? this.opts.model,
    };
  };

  async generate<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const result = await runStructured(req, this.transport, {
      provider: "anthropic",
      defaultTimeoutMs: this.opts.timeoutMs,
      clock: this.opts.clock,
      log: this.opts.log,
    });
    this.lastSuccessAt = this.opts.clock.nowIso();
    return result;
  }

  async health(): Promise<IntegrationStatusT> {
    const checkedAt = this.opts.clock.nowIso();
    try {
      await this.client.models.retrieve(this.opts.model, undefined, {
        timeout: 4000,
        maxRetries: 0,
      });
      this.lastSuccessAt = checkedAt;
      return {
        name: "llm",
        mode: "live",
        healthy: true,
        detail: `anthropic ${this.opts.model} (${this.mode})`,
        lastCheckedAt: checkedAt,
        lastSuccessAt: this.lastSuccessAt,
      };
    } catch (err) {
      const e = mapAnthropicError("health", err);
      return {
        name: "llm",
        mode: "live",
        healthy: false,
        detail: `anthropic ${e.reason}`,
        lastCheckedAt: checkedAt,
        lastSuccessAt: this.lastSuccessAt,
      };
    }
  }
}

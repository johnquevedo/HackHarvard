import type {
  Clock,
  Logger,
  LlmUsage,
  StructuredRequest,
  StructuredResult,
} from "@dennis/contracts";
import { LlmSchemaError, LlmUnavailableError } from "./errors";

export type ProviderName = "anthropic" | "chalk_gateway" | "mock";

export interface TransportCall {
  system: string;
  user: string;
  correctiveNote: string | null;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
}

export interface TransportResult {
  raw: unknown;
  usage: LlmUsage;
  model: string;
}

// A transport performs one provider call. It throws LlmUnavailableError for retriable
// transport failures (timeout, 5xx, 429) and for permanent ones (config, 4xx), with `reason` telling which.
export interface Transport {
  <T>(req: StructuredRequest<T>, call: TransportCall): Promise<TransportResult>;
}

export interface EngineOptions {
  provider: ProviderName;
  defaultTimeoutMs: number;
  clock: Clock;
  log: Logger;
  sleep?: (ms: number) => Promise<void>;
}

const RETRIABLE = new Set(["timeout", "upstream", "rate_limited"]);
const MAX_ATTEMPTS = 3;

function issuesOf(error: {
  issues?: { path: PropertyKey[]; message: string }[];
}): string {
  return (error.issues ?? [])
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

// Shared generate loop: one retry on a transient transport failure, one retry with a corrective note on
// invalid output, at most three calls in total. Every success passed `schema.safeParse`.
export async function runStructured<T>(
  req: StructuredRequest<T>,
  transport: Transport,
  opts: EngineOptions,
): Promise<StructuredResult<T>> {
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = opts.clock.now().getTime();
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let correctiveNote: string | null = null;
  let transportRetried = false;
  let schemaRetried = false;
  let lastIssues = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: TransportResult;
    try {
      res = await transport(req, {
        system: req.system,
        user: req.user,
        correctiveNote,
        timeoutMs: req.timeoutMs ?? opts.defaultTimeoutMs,
        maxTokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0,
      });
    } catch (err) {
      const e =
        err instanceof LlmUnavailableError
          ? err
          : new LlmUnavailableError(req.task, "upstream", String(err));
      if (
        RETRIABLE.has(e.reason) &&
        !transportRetried &&
        attempt < MAX_ATTEMPTS
      ) {
        transportRetried = true;
        opts.log.warn("llm.retry", {
          task: req.task,
          reason: e.reason,
          attempt,
          traceId: req.traceId,
        });
        await sleep(e.reason === "rate_limited" ? 1500 : 300);
        continue;
      }
      throw e;
    }
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    const parsed = req.schema.safeParse(res.raw);
    if (parsed.success) {
      const latencyMs = opts.clock.now().getTime() - started;
      opts.log.info("llm.ok", {
        task: req.task,
        provider: opts.provider,
        model: res.model,
        latencyMs,
        attempts: attempt,
        traceId: req.traceId,
      });
      return {
        value: parsed.data,
        usage,
        model: res.model,
        provider: opts.provider,
        latencyMs,
        attempts: attempt,
      };
    }
    lastIssues = issuesOf(parsed.error as never);
    if (schemaRetried || attempt >= MAX_ATTEMPTS)
      throw new LlmSchemaError(req.task, lastIssues, attempt);
    schemaRetried = true;
    correctiveNote = `Your previous output did not match the required schema (${lastIssues}). Return only an object that matches the schema exactly.`;
    opts.log.warn("llm.schema_retry", {
      task: req.task,
      issues: lastIssues,
      traceId: req.traceId,
    });
  }
  throw new LlmSchemaError(req.task, lastIssues, MAX_ATTEMPTS);
}

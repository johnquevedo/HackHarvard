import { z } from "zod";

export const ID_PREFIX = {
  user: "usr",
  agent: "agt",
  message: "msg",
  intent: "int",
  opportunity: "opp",
  approval: "apr",
  a2a: "a2a",
  event: "evt",
  outbox: "out",
  offer: "ofr",
  group: "grp",
  payment: "pay",
  market: "mkt",
  position: "pos",
  ledger: "led",
  resolution: "res",
  trace: "trc",
} as const;
export type IdKind = keyof typeof ID_PREFIX;

// Accepts generated IDs and fixed seed IDs such as usr_demo_alice.
export function idSchema(kind: IdKind) {
  return z.string().regex(new RegExp("^" + ID_PREFIX[kind] + "_[a-z0-9_]{6,40}$"));
}
export interface IdFactory {
  next(kind: IdKind): string;
}

export const Cents = z.number().int().min(0).max(10_000_000);
export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Cents.parse(cents) / 100);
} // 28499 returns "$284.99"

export const ERROR_CODES = [
  "validation_error",
  "unauthorized",
  "forbidden",
  "consent_required",
  "not_found",
  "conflict",
  "invalid_state",
  "idempotency_conflict",
  "approval_invalid",
  "rate_limited",
  "upstream_error",
  "integration_unavailable",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export class DennisError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "DennisError";
  }
}
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

import { describe, expect, it, vi } from "vitest";

import { NessieBankingProvider } from "./nessie.js";

const clock = {
  now: () => new Date("2026-10-17T16:00:00.000Z"),
  nowIso: () => "2026-10-17T16:00:00.000Z",
};

const log = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("NessieBankingProvider", () => {
  it("converts cents to dollars and parses the transfer fixture", async () => {
    let requestUrl = "";
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return json({
        code: 201,
        objectCreated: {
          _id: "tx_1234",
          payer_id: "acct_from",
          payee_id: "acct_pool",
          amount: 284.99,
          status: "completed",
          description: "dennis:idem",
          transaction_date: "2026-10-17",
        },
      });
    });
    const provider = new NessieBankingProvider({
      baseUrl: "https://nessie.example",
      apiKey: "secret-key",
      clock,
      log,
      fetchImpl,
    });

    const result = await provider.transfer({
      fromAccountRef: "acct_from",
      toAccountRef: "acct_pool",
      amountCents: 28_499,
      memo: "dennis:idem",
    });

    expect(requestBody).toMatchObject({
      amount: 284.99,
      payee_id: "acct_pool",
      description: "dennis:idem",
    });
    expect(new URL(requestUrl).searchParams.get("key")).toBe("secret-key");
    expect(result).toMatchObject({
      mode: "live",
      record: { providerTransferId: "tx_1234", amountCents: 28_499, toAccountRef: "acct_pool" },
    });
  });

  it("does not retry a failed transfer POST", async () => {
    const fetchImpl = vi.fn(async () => json({ message: "failure" }, 500));
    const provider = new NessieBankingProvider({
      baseUrl: "https://nessie.example",
      apiKey: "secret-key",
      clock,
      log,
      fetchImpl,
    });
    await expect(
      provider.transfer({
        fromAccountRef: "acct_from",
        toAccountRef: "acct_pool",
        amountCents: 100,
        memo: "dennis:no-retry",
      }),
    ).rejects.toThrow("HTTP 500");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a failed GET twice", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ message: "failure" }, 500))
      .mockResolvedValueOnce(json({ message: "failure" }, 500))
      .mockResolvedValueOnce(json({ _id: "acct", balance: 12.34 }));
    const provider = new NessieBankingProvider({
      baseUrl: "https://nessie.example",
      apiKey: "secret-key",
      clock,
      log,
      fetchImpl,
    });
    await expect(provider.getBalance("acct")).resolves.toMatchObject({ balanceCents: 1_234 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("maps malformed JSON to a typed provider error without logging the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("not-json", { status: 200 }));
    const provider = new NessieBankingProvider({
      baseUrl: "https://nessie.example",
      apiKey: "do-not-log-me",
      clock,
      log,
      fetchImpl,
    });
    await expect(provider.getBalance("acct")).rejects.toMatchObject({ code: "upstream_error" });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("do-not-log-me");
  });
});

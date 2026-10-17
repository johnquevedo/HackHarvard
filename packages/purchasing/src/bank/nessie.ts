import type {
  BankAccountView,
  BankingProvider,
  BankSeedResult,
  BankTransferRecord,
  BankTransferRequest,
  BankTransferResult,
  Clock,
  IntegrationStatusT,
  Logger,
  SeedBankingInput,
} from "@dennis/contracts";

import { BankingProviderError } from "./errors.js";

interface NessieObject {
  _id?: unknown;
  id?: unknown;
  objectCreated?: NessieObject;
  balance?: unknown;
  nickname?: unknown;
  customer_id?: unknown;
  payer_id?: unknown;
  payee_id?: unknown;
  amount?: unknown;
  status?: unknown;
  description?: unknown;
  transaction_date?: unknown;
  created_at?: unknown;
}

export interface NessieBankingProviderOptions {
  baseUrl: string;
  apiKey: string;
  clock: Clock;
  log: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function centsFromDollars(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BankingProviderError(`Nessie ${field} was not a finite number`, false);
  }
  return Math.round(value * 100);
}

function dollarsFromCents(cents: number): number {
  if (!Number.isInteger(cents)) throw new Error("Money must be integer cents");
  return cents / 100;
}

function objectId(value: unknown, operation: string): string {
  if (value === null || typeof value !== "object") {
    throw new BankingProviderError(`Nessie ${operation} response was not an object`, false);
  }
  const body = value as NessieObject;
  const id = body.objectCreated?._id ?? body.objectCreated?.id ?? body._id ?? body.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new BankingProviderError(`Nessie ${operation} response had no object ID`, false);
  }
  return id;
}

function asObject(value: unknown, operation: string): NessieObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BankingProviderError(`Nessie ${operation} response was not an object`, false);
  }
  return value as NessieObject;
}

function asArray(value: unknown, operation: string): NessieObject[] {
  if (!Array.isArray(value)) {
    throw new BankingProviderError(`Nessie ${operation} response was not an array`, false);
  }
  return value.map((item) => asObject(item, operation));
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export class NessieBankingProvider implements BankingProvider {
  readonly name = "nessie" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: NessieBankingProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const method = init.method ?? "GET";
    const attempts = method === "GET" ? 3 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const url = new URL(path, `${this.baseUrl}/`);
      url.searchParams.set("key", this.options.apiKey);
      try {
        const response = await this.fetchImpl(url, {
          ...init,
          headers: { "content-type": "application/json", ...init.headers },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await response.text();
        let body: unknown = null;
        if (text.length > 0) {
          try {
            body = JSON.parse(text);
          } catch {
            throw new BankingProviderError(
              "Nessie returned malformed JSON",
              false,
              response.status,
            );
          }
        }
        if (!response.ok) {
          const retryable = response.status >= 500 || response.status === 429;
          throw new BankingProviderError(
            `Nessie ${method} ${path} failed with HTTP ${response.status}`,
            retryable,
            response.status,
          );
        }
        return body;
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof BankingProviderError
            ? error.retryable
            : error instanceof TypeError || error instanceof DOMException;
        this.options.log.warn("Nessie request failed", { method, path, attempt, retryable });
        if (!retryable || attempt === attempts) break;
      }
    }

    if (lastError instanceof BankingProviderError) throw lastError;
    throw new BankingProviderError(
      lastError instanceof Error
        ? `Nessie request failed: ${lastError.message}`
        : "Nessie request failed",
      true,
    );
  }

  async ensureSeeded(input: SeedBankingInput): Promise<BankSeedResult> {
    const existing = asArray(await this.request("/accounts"), "list accounts");
    const accounts: BankAccountView[] = [];
    let created = 0;
    let reused = 0;
    let customerId: string | null = null;

    const requested = [
      ...input.members.map((member) => ({
        linkKey: member.linkKey,
        displayName: member.displayName,
        startCents: member.startCents,
      })),
      { linkKey: "pool", displayName: "Dennis Group Pool", startCents: input.poolStartCents },
    ];

    for (const item of requested) {
      const nickname = `dennis-${input.runTag}-${item.linkKey}`;
      let account = existing.find((candidate) => candidate.nickname === nickname);
      if (account) {
        reused += 1;
      } else {
        if (!customerId) {
          const customer = await this.request("/customers", {
            method: "POST",
            body: JSON.stringify({
              first_name: "Dennis",
              last_name: `Demo ${input.runTag}`,
              address: {
                street_number: "1",
                street_name: "Harvard Yard",
                city: "Cambridge",
                state: "MA",
                zip: "02138",
              },
            }),
          });
          customerId = objectId(customer, "create customer");
        }
        const createdAccount = await this.request(`/customers/${customerId}/accounts`, {
          method: "POST",
          body: JSON.stringify({
            type: "Checking",
            nickname,
            rewards: 0,
            balance: dollarsFromCents(item.startCents),
          }),
        });
        const createdBody = asObject(createdAccount, "create account");
        account = createdBody.objectCreated ?? createdBody;
        created += 1;
      }

      const accountRef = objectId(account, "account");
      const balance = await this.getBalance(accountRef);
      accounts.push({
        accountRef,
        label: nickname,
        last4: accountRef.slice(-4),
        balanceCents: balance.balanceCents,
        ownerKey: item.linkKey,
      });
    }

    return { provider: "nessie", accounts, created, reused };
  }

  async getBalance(
    accountRef: string,
  ): Promise<{ accountRef: string; balanceCents: number; fetchedAt: string }> {
    const account = asObject(await this.request(`/accounts/${accountRef}`), "get account");
    return {
      accountRef,
      balanceCents: centsFromDollars(account.balance, "account balance"),
      fetchedAt: this.options.clock.nowIso(),
    };
  }

  async listAccounts(): Promise<BankAccountView[]> {
    const accounts = asArray(await this.request("/accounts"), "list accounts");
    return accounts.map((account) => {
      const accountRef = objectId(account, "account");
      return {
        accountRef,
        label: stringField(account.nickname) ?? "Nessie account",
        last4: accountRef.slice(-4),
        balanceCents: centsFromDollars(account.balance, "account balance"),
        ownerKey: stringField(account.customer_id) ?? "unknown",
      };
    });
  }

  async transfer(req: BankTransferRequest): Promise<BankTransferResult> {
    const body = await this.request(`/accounts/${req.fromAccountRef}/transfers`, {
      method: "POST",
      body: JSON.stringify({
        medium: "balance",
        payee_id: req.toAccountRef,
        amount: dollarsFromCents(req.amountCents),
        transaction_date: this.options.clock.nowIso().slice(0, 10),
        status: "completed",
        description: req.memo,
      }),
    });
    const transferBody = asObject(body, "create transfer");
    const raw = transferBody.objectCreated ?? transferBody;
    const providerTransferId = objectId(body, "create transfer");
    return {
      mode: "live",
      record: this.toTransferRecord(raw, providerTransferId, req.fromAccountRef),
    };
  }

  async getTransfer(providerTransferId: string): Promise<BankTransferRecord | null> {
    try {
      const body = asObject(await this.request(`/transfers/${providerTransferId}`), "get transfer");
      return this.toTransferRecord(
        body,
        providerTransferId,
        stringField(body.payer_id) ?? "unknown",
      );
    } catch (error) {
      if (error instanceof BankingProviderError && error.providerStatus === 404) return null;
      throw error;
    }
  }

  async findTransfersByMemo(
    accountRef: string,
    memoContains: string,
  ): Promise<BankTransferRecord[]> {
    const transfers = asArray(
      await this.request(`/accounts/${accountRef}/transfers`),
      "list transfers",
    );
    return transfers
      .filter((item) => stringField(item.description)?.includes(memoContains))
      .map((item) => this.toTransferRecord(item, objectId(item, "transfer"), accountRef));
  }

  async health(): Promise<IntegrationStatusT> {
    const checkedAt = this.options.clock.nowIso();
    try {
      await this.request("/accounts");
      return {
        name: "nessie",
        mode: "live",
        healthy: true,
        detail: "Nessie accounts are readable",
        lastCheckedAt: checkedAt,
        lastSuccessAt: checkedAt,
      };
    } catch (error) {
      return {
        name: "nessie",
        mode: "live",
        healthy: false,
        detail: error instanceof Error ? error.message : "Nessie health check failed",
        lastCheckedAt: checkedAt,
        lastSuccessAt: null,
      };
    }
  }

  private toTransferRecord(
    body: NessieObject,
    transferId: string,
    payerFallback: string,
  ): BankTransferRecord {
    const amountCents = centsFromDollars(body.amount, "transfer amount");
    const toAccountRef = stringField(body.payee_id);
    if (!toAccountRef)
      throw new BankingProviderError("Nessie transfer response had no payee_id", false);
    return {
      providerTransferId: transferId,
      fromAccountRef: stringField(body.payer_id) ?? payerFallback,
      toAccountRef,
      amountCents,
      status: stringField(body.status) ?? "unknown",
      memo: stringField(body.description),
      createdAt: stringField(body.transaction_date) ?? stringField(body.created_at),
      raw: body,
    };
  }
}

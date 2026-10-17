import { createHash } from "node:crypto";

import type {
  BankAccountView,
  BankingProvider,
  BankSeedResult,
  BankTransferRecord,
  BankTransferRequest,
  BankTransferResult,
  Clock,
  IntegrationStatusT,
  SeedBankingInput,
} from "@dennis/contracts";

interface SimAccount extends BankAccountView {
  customerRef: string;
}

function cloneAccount(account: SimAccount): BankAccountView {
  return {
    accountRef: account.accountRef,
    label: account.label,
    last4: account.last4,
    balanceCents: account.balanceCents,
    ownerKey: account.ownerKey,
  };
}

export class SimBankingProvider implements BankingProvider {
  readonly name = "sim" as const;
  private readonly accounts = new Map<string, SimAccount>();
  private readonly transfers = new Map<string, BankTransferRecord>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly clock: Clock) {}

  async ensureSeeded(input: SeedBankingInput): Promise<BankSeedResult> {
    let created = 0;
    let reused = 0;
    for (const member of input.members) {
      const accountRef = `sim_${input.runTag}_${member.linkKey}`;
      if (this.accounts.has(accountRef)) {
        reused += 1;
        continue;
      }
      this.accounts.set(accountRef, {
        accountRef,
        customerRef: `sim_customer_${member.linkKey}`,
        label: `dennis-${input.runTag}-${member.linkKey}`,
        last4: createHash("sha256").update(accountRef).digest("hex").slice(-4),
        balanceCents: member.startCents,
        ownerKey: member.linkKey,
      });
      created += 1;
    }

    const poolRef = `sim_${input.runTag}_pool`;
    if (this.accounts.has(poolRef)) {
      reused += 1;
    } else {
      this.accounts.set(poolRef, {
        accountRef: poolRef,
        customerRef: "sim_customer_pool",
        label: `dennis-${input.runTag}-pool`,
        last4: createHash("sha256").update(poolRef).digest("hex").slice(-4),
        balanceCents: input.poolStartCents,
        ownerKey: "pool",
      });
      created += 1;
    }

    return { provider: "sim", accounts: await this.listAccounts(), created, reused };
  }

  async getBalance(accountRef: string): Promise<{ accountRef: string; balanceCents: number; fetchedAt: string }> {
    const account = this.accounts.get(accountRef);
    if (!account) throw new Error(`Unknown simulated account: ${accountRef}`);
    return { accountRef, balanceCents: account.balanceCents, fetchedAt: this.clock.nowIso() };
  }

  async listAccounts(): Promise<BankAccountView[]> {
    return [...this.accounts.values()].map(cloneAccount);
  }

  async transfer(req: BankTransferRequest): Promise<BankTransferResult> {
    let result: BankTransferResult | undefined;
    let failure: unknown;
    const previous = this.queue;
    this.queue = previous.then(async () => {
      const existing = [...this.transfers.values()].find((item) => item.memo === req.memo);
      if (existing) {
        if (
          existing.fromAccountRef !== req.fromAccountRef ||
          existing.toAccountRef !== req.toAccountRef ||
          existing.amountCents !== req.amountCents
        ) {
          throw new Error("idempotency_conflict");
        }
        result = { record: existing, mode: "simulated" };
        return;
      }
      const from = this.accounts.get(req.fromAccountRef);
      const to = this.accounts.get(req.toAccountRef);
      if (!from || !to) throw new Error("Both simulated transfer accounts must exist");
      if (!Number.isInteger(req.amountCents) || req.amountCents <= 0) {
        throw new Error("Simulated transfer amount must be a positive integer number of cents");
      }
      if (from.balanceCents < req.amountCents) throw new Error("insufficient_funds");

      from.balanceCents -= req.amountCents;
      to.balanceCents += req.amountCents;
      const providerTransferId = `sim_tx_${createHash("sha256")
        .update(`${req.memo}:${req.fromAccountRef}:${req.toAccountRef}:${req.amountCents}`)
        .digest("hex")
        .slice(0, 20)}`;
      const record: BankTransferRecord = {
        providerTransferId,
        fromAccountRef: req.fromAccountRef,
        toAccountRef: req.toAccountRef,
        amountCents: req.amountCents,
        status: "completed",
        memo: req.memo,
        createdAt: this.clock.nowIso(),
        raw: { provider: "sim", label: "SIMULATED BANK" },
      };
      this.transfers.set(providerTransferId, record);
      result = { record, mode: "simulated" };
    }).catch((error) => {
      failure = error;
    });
    await this.queue;
    if (failure) throw failure;
    if (!result) throw new Error("Simulated transfer did not produce a result");
    return result;
  }

  async getTransfer(providerTransferId: string): Promise<BankTransferRecord | null> {
    return this.transfers.get(providerTransferId) ?? null;
  }

  async findTransfersByMemo(accountRef: string, memoContains: string): Promise<BankTransferRecord[]> {
    return [...this.transfers.values()].filter(
      (item) =>
        (item.fromAccountRef === accountRef || item.toAccountRef === accountRef) &&
        item.memo?.includes(memoContains),
    );
  }

  async health(): Promise<IntegrationStatusT> {
    return {
      name: "nessie",
      mode: "simulated",
      healthy: true,
      detail: "SIMULATED BANK active",
      lastCheckedAt: this.clock.nowIso(),
      lastSuccessAt: this.clock.nowIso(),
    };
  }
}

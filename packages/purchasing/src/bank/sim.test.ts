import { describe, expect, it } from "vitest";

import { SimBankingProvider } from "./sim.js";

const clock = {
  now: () => new Date("2026-10-17T16:00:00.000Z"),
  nowIso: () => "2026-10-17T16:00:00.000Z",
};

async function seededProvider() {
  const provider = new SimBankingProvider(clock);
  const seed = await provider.ensureSeeded({
    members: [{ linkKey: "alice", displayName: "Alice", startCents: 10_000 }],
    poolStartCents: 0,
    runTag: "test",
  });
  const alice = seed.accounts.find((item) => item.ownerKey === "alice")!;
  const pool = seed.accounts.find((item) => item.ownerKey === "pool")!;
  return { provider, alice, pool };
}

describe("SimBankingProvider", () => {
  it("seeds idempotently", async () => {
    const provider = new SimBankingProvider(clock);
    const input = {
      members: [{ linkKey: "alice", displayName: "Alice", startCents: 10_000 }],
      poolStartCents: 0,
      runTag: "test",
    };
    expect(await provider.ensureSeeded(input)).toMatchObject({ created: 2, reused: 0 });
    expect(await provider.ensureSeeded(input)).toMatchObject({ created: 0, reused: 2 });
    expect(await provider.listAccounts()).toHaveLength(2);
  });

  it("moves exactly the requested cents and can read the transfer back", async () => {
    const { provider, alice, pool } = await seededProvider();
    const result = await provider.transfer({
      fromAccountRef: alice.accountRef,
      toAccountRef: pool.accountRef,
      amountCents: 2_849,
      memo: "dennis:payment-one",
    });

    expect(await provider.getBalance(alice.accountRef)).toMatchObject({ balanceCents: 7_151 });
    expect(await provider.getBalance(pool.accountRef)).toMatchObject({ balanceCents: 2_849 });
    expect(await provider.getTransfer(result.record.providerTransferId)).toEqual(result.record);
    expect(await provider.findTransfersByMemo(alice.accountRef, "payment-one")).toEqual([result.record]);
  });

  it("returns the existing result for an identical memo and payload", async () => {
    const { provider, alice, pool } = await seededProvider();
    const request = {
      fromAccountRef: alice.accountRef,
      toAccountRef: pool.accountRef,
      amountCents: 1_000,
      memo: "dennis:same",
    };
    const first = await provider.transfer(request);
    const second = await provider.transfer(request);
    expect(second).toEqual(first);
    expect(await provider.getBalance(alice.accountRef)).toMatchObject({ balanceCents: 9_000 });
  });

  it("rejects reuse of a memo with a different transfer payload", async () => {
    const { provider, alice, pool } = await seededProvider();
    await provider.transfer({
      fromAccountRef: alice.accountRef,
      toAccountRef: pool.accountRef,
      amountCents: 1_000,
      memo: "dennis:conflict",
    });
    await expect(
      provider.transfer({
        fromAccountRef: alice.accountRef,
        toAccountRef: pool.accountRef,
        amountCents: 1_001,
        memo: "dennis:conflict",
      }),
    ).rejects.toThrow("idempotency_conflict");
  });

  it("does not mutate balances when funds are insufficient", async () => {
    const { provider, alice, pool } = await seededProvider();
    await expect(
      provider.transfer({
        fromAccountRef: alice.accountRef,
        toAccountRef: pool.accountRef,
        amountCents: 10_001,
        memo: "dennis:too-large",
      }),
    ).rejects.toThrow("insufficient_funds");
    expect(await provider.getBalance(alice.accountRef)).toMatchObject({ balanceCents: 10_000 });
    expect(await provider.getBalance(pool.accountRef)).toMatchObject({ balanceCents: 0 });
  });
});

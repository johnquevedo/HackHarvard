import type { BankTransferRecord } from "@dennis/contracts";
import { describe, expect, it } from "vitest";

import { verifyTransfer } from "./verification.js";

const transfer: BankTransferRecord = {
  providerTransferId: "tx_123",
  fromAccountRef: "from",
  toAccountRef: "pool",
  amountCents: 28_499,
  status: "completed",
  memo: "dennis:key",
  createdAt: "2026-10-17T16:00:00.000Z",
  raw: {},
};

const balances = {
  before: { fromCents: 150_000, toCents: 0 },
  after: { fromCents: 121_501, toCents: 28_499 },
};

describe("verifyTransfer", () => {
  it("verifies only a matching read-back and both exact balance deltas", () => {
    expect(
      verifyTransfer({
        expectedAmountCents: 28_499,
        expectedToAccountRef: "pool",
        transfer,
        ...balances,
      }),
    ).toMatchObject({ verified: true });
  });

  it.each([
    { name: "missing transfer", changed: { transfer: null } },
    { name: "wrong amount", changed: { transfer: { ...transfer, amountCents: 28_498 } } },
    { name: "wrong payee", changed: { transfer: { ...transfer, toAccountRef: "other" } } },
    { name: "wrong payer delta", changed: { after: { fromCents: 121_502, toCents: 28_499 } } },
    { name: "wrong pool delta", changed: { after: { fromCents: 121_501, toCents: 28_498 } } },
  ])("leaves $name unverified", ({ changed }) => {
    expect(
      verifyTransfer({
        expectedAmountCents: 28_499,
        expectedToAccountRef: "pool",
        transfer,
        ...balances,
        ...changed,
      }),
    ).toMatchObject({ verified: false });
  });
});

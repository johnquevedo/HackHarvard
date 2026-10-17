import type { BankTransferRecord } from "@dennis/contracts";

export interface BalanceSnapshot {
  fromCents: number;
  toCents: number;
}

export function verifyTransfer(input: {
  expectedAmountCents: number;
  expectedToAccountRef: string;
  transfer: BankTransferRecord | null;
  before: BalanceSnapshot;
  after: BalanceSnapshot;
}): { verified: boolean; note: string } {
  if (!input.transfer) return { verified: false, note: "Provider transfer read-back was missing" };
  if (input.transfer.amountCents !== input.expectedAmountCents) {
    return { verified: false, note: "Provider transfer amount did not match" };
  }
  if (input.transfer.toAccountRef !== input.expectedToAccountRef) {
    return { verified: false, note: "Provider transfer payee did not match" };
  }
  const payerDelta = input.before.fromCents - input.after.fromCents;
  const poolDelta = input.after.toCents - input.before.toCents;
  if (payerDelta !== input.expectedAmountCents || poolDelta !== input.expectedAmountCents) {
    return {
      verified: false,
      note: `Balance deltas did not match amount: payer=${payerDelta}, pool=${poolDelta}`,
    };
  }
  return { verified: true, note: "Provider transfer and both balance deltas match" };
}

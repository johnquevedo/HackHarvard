import { formatUsd } from "@dennis/contracts";

export function joinGroupCopy(input: {
  first: string;
  productLabel: string;
  groupCents: number;
  individualCents: number;
  savingsCents: number;
  merchant: string;
}): string {
  return `Dennis for ${input.first}: another Dennis user is also shopping for a ${input.productLabel}. Together you'd each pay ${formatUsd(input.groupCents)} instead of ${formatUsd(input.individualCents)}, saving ${formatUsd(input.savingsCents)}. SIMULATED group offer from ${input.merchant}. If you join, your first name is shared with them. Nothing is charged yet. Reply YES {code} to join or NO {code} to skip.`;
}

export function authorizePaymentCopy(input: {
  first: string;
  amountCents: number;
  last4: string;
  productLabel: string;
}): string {
  return `Dennis for ${input.first}: authorize a SANDBOX transfer of ${formatUsd(input.amountCents)} from your demo account ending ${input.last4} to the group pool for the ${input.productLabel}? Sandbox money only, no real funds. Reply YES {code} to authorize or NO {code} to cancel.`;
}

export function paymentResultCopy(input: {
  first: string;
  amountCents: number;
  verified: boolean;
  shortRef: string;
  balanceCents: number;
}): string {
  const verificationWord = input.verified ? "verified" : "recorded but not verified";
  return `Done, ${input.first}: sandbox transfer of ${formatUsd(input.amountCents)} ${verificationWord}. Ref ${input.shortRef}. Demo balance now ${formatUsd(input.balanceCents)}.`;
}

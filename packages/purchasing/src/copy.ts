import { formatUsd } from "@dennis/contracts";

export type CopyMode = "normal" | "demo";

export function joinGroupCopy(input: {
  first: string;
  productLabel: string;
  groupCents: number;
  individualCents: number;
  savingsCents: number;
  merchant: string;
  mode?: CopyMode;
}): string {
  // Group-chat voice: the agents found each other, Dennis asks before coordinating anything.
  if (input.mode === "demo")
    return `wait. found a match. another friend's agent has been tracking the same ${input.productLabel.toLowerCase()}. found a group deal that saves you both ${formatUsd(input.savingsCents)} each (${formatUsd(input.groupCents)} instead of ${formatUsd(input.individualCents)}, simulated offer). want me to coordinate? ({code})`;
  return `Dennis for ${input.first}: another Dennis user is also shopping for a ${input.productLabel}. Together you'd each pay ${formatUsd(input.groupCents)} instead of ${formatUsd(input.individualCents)}, saving ${formatUsd(input.savingsCents)}. SIMULATED group offer from ${input.merchant}. If you join, your first name is shared with them. Nothing is charged yet. Reply YES {code} to join or NO {code} to skip.`;
}

export function authorizePaymentCopy(input: {
  first: string;
  amountCents: number;
  last4: string;
  productLabel: string;
  mode?: CopyMode;
}): string {
  if (input.mode === "demo")
    return `simulated Nessie payment ready for confirmation: ${formatUsd(input.amountCents)} from your demo account ending ${input.last4} to the group pool. sandbox money only. send it? ({code})`;
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

/** Shown to each member once everyone joined; in the group chat it goes out with confetti. */
export function groupConfirmedCopy(input: { otherFirst: string; mode?: CopyMode }): string {
  if (input.mode === "demo")
    return `both approved. group purchase organized. you're buying with ${input.otherFirst.toLowerCase()}.`;
  return `You're buying with ${input.otherFirst}.`;
}

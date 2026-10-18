import { formatUsd, voiceLine } from "@dennis/contracts";

export function joinGroupCopy(input: {
  first: string;
  productLabel: string;
  groupCents: number;
  individualCents: number;
  savingsCents: number;
  merchant: string;
}): string {
  const product = input.productLabel;
  const save = formatUsd(input.savingsCents);
  const prices = `${formatUsd(input.groupCents)} instead of ${formatUsd(input.individualCents)}`;
  const fine = `sample offer from ${input.merchant}, nothing charged yet, joining shares ur first name.`;
  return voiceLine("purchase.join", [
    `Dennis for ${input.first}: another Dennis user is also shopping for a ${product}. Together you'd each pay ${prices}, saving ${formatUsd(input.savingsCents)}. SIMULATED group offer from ${input.merchant}. If you join, your first name is shared with them. Nothing is charged yet. Reply YES {code} to join or NO {code} to skip.`,
    `wait. found a match. another friend's agent has been tracking the same ${product}. group deal saves you both ${save} each (${prices}). want me to coordinate? ${fine} yes {code} / no {code}`,
    `hold up ${input.first}. another friend's dennis is hunting the same ${product}. buy together and you each save ${save} (${prices}). you in? ${fine} yes {code} / no {code}`,
    `${input.first} your agent just found a buddy for that ${product}. bundle it and you both save ${save}. want me to set it up? ${fine} yes {code} / no {code}`,
  ]);
}

export function authorizePaymentCopy(input: {
  first: string;
  amountCents: number;
  last4: string;
  productLabel: string;
}): string {
  const amount = formatUsd(input.amountCents);
  return voiceLine("purchase.authorize", [
    `Dennis for ${input.first}: authorize a SANDBOX transfer of ${formatUsd(input.amountCents)} from your demo account ending ${input.last4} to the group pool for the ${input.productLabel}? Sandbox money only, no real funds. Reply YES {code} to authorize or NO {code} to cancel.`,
    `both approved. group purchase organized. simulated nessie payment of ${amount} from your demo account ending ${input.last4} is ready, sandbox money only. confirm? yes {code} / no {code}`,
    `${input.first} you're locked in. sandbox nessie transfer of ${amount} from the account ending ${input.last4} to the group pool, no real money. send it? yes {code} / no {code}`,
    `group's set for the ${input.productLabel}. ${amount} simulated nessie payment from ...${input.last4} ready to go, sandbox only. yes {code} to send, no {code} to bail`,
  ]);
}

export function paymentResultCopy(input: {
  first: string;
  amountCents: number;
  verified: boolean;
  shortRef: string;
  balanceCents: number;
}): string {
  const verificationWord = input.verified ? "verified" : "recorded but not verified";
  const amount = formatUsd(input.amountCents);
  const balance = formatUsd(input.balanceCents);
  return voiceLine("purchase.result", [
    `Done, ${input.first}: sandbox transfer of ${formatUsd(input.amountCents)} ${verificationWord}. Ref ${input.shortRef}. Demo balance now ${formatUsd(input.balanceCents)}.`,
    `done ${input.first}. ${amount} sandbox transfer ${verificationWord}, ref ${input.shortRef}. demo balance now ${balance}.`,
    `paid. ${amount} sandbox transfer ${verificationWord} (ref ${input.shortRef}). ${input.first}'s demo account is at ${balance}.`,
  ]);
}

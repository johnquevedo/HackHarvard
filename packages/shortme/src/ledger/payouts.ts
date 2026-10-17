export interface PayoutPosition {
  userId: string;
  side: "back" | "fade";
  points: number;
  createdAt: string;
}

export type PayoutResult =
  { pool: number; payouts: { userId: string; payout: number }[] } | { void: true };

// Pari-mutuel, zero-sum, no house cut (Section 8.7). `back` wins on "yes", `fade` wins on "no".
// Each winner gets floor(pool * stake / winnersTotal); the remainder goes to the largest winning
// stake (ties: earliest position) so payouts sum to exactly the pool. No counterparty means void.
export function computePayouts(positions: PayoutPosition[], outcome: "yes" | "no"): PayoutResult {
  const winningSide = outcome === "yes" ? "back" : "fade";
  const winners = positions.filter((p) => p.side === winningSide);
  const losers = positions.filter((p) => p.side !== winningSide);
  const winnersTotal = winners.reduce((s, p) => s + p.points, 0);
  const losersTotal = losers.reduce((s, p) => s + p.points, 0);
  if (winnersTotal === 0 || losersTotal === 0) return { void: true };
  const pool = winnersTotal + losersTotal;
  const payouts = winners.map((p) => ({
    userId: p.userId,
    payout: Math.floor((pool * p.points) / winnersTotal),
  }));
  const remainder = pool - payouts.reduce((s, p) => s + p.payout, 0);
  if (remainder > 0) {
    let best = 0;
    for (let i = 1; i < winners.length; i++) {
      const w = winners[i]!;
      const b = winners[best]!;
      if (w.points > b.points || (w.points === b.points && w.createdAt < b.createdAt)) best = i;
    }
    payouts[best]!.payout += remainder;
  }
  return { pool, payouts };
}

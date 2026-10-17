import { describe, expect, it } from "vitest";
import { computePayouts, type PayoutPosition } from "./payouts";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomPositions(r: () => number): PayoutPosition[] {
  const n = 1 + Math.floor(r() * 8);
  return Array.from({ length: n }, (_, i) => ({
    userId: `usr_${i}`,
    side: r() < 0.5 ? "back" : "fade",
    points: 1 + Math.floor(r() * 100),
    createdAt: new Date(Date.UTC(2026, 9, 17, 12, 0, i)).toISOString(),
  }));
}

describe("computePayouts", () => {
  it("spec example: Alice fade 50, Bob back 50, outcome no", () => {
    const r = computePayouts(
      [
        {
          userId: "alice",
          side: "fade",
          points: 50,
          createdAt: "2026-10-17T12:00:01.000Z",
        },
        {
          userId: "bob",
          side: "back",
          points: 50,
          createdAt: "2026-10-17T12:00:00.000Z",
        },
      ],
      "no",
    );
    expect(r).toEqual({
      pool: 100,
      payouts: [{ userId: "alice", payout: 100 }],
    });
  });

  it.each([
    ["no counterparty", [{ userId: "a", side: "back", points: 10, createdAt: "t1" }], "yes"],
    ["no winners", [{ userId: "a", side: "back", points: 10, createdAt: "t1" }], "no"],
    ["empty", [], "yes"],
  ] as const)("voids when %s", (_n, positions, outcome) => {
    expect(computePayouts([...positions], outcome)).toEqual({ void: true });
  });

  it("remainder goes to the largest stake, ties to the earliest", () => {
    const r = computePayouts(
      [
        {
          userId: "w1",
          side: "back",
          points: 1,
          createdAt: "2026-10-17T12:00:02.000Z",
        },
        {
          userId: "w2",
          side: "back",
          points: 1,
          createdAt: "2026-10-17T12:00:01.000Z",
        },
        {
          userId: "w3",
          side: "back",
          points: 1,
          createdAt: "2026-10-17T12:00:03.000Z",
        },
        {
          userId: "l",
          side: "fade",
          points: 1,
          createdAt: "2026-10-17T12:00:00.000Z",
        },
      ],
      "yes",
    );
    if ("void" in r) throw new Error("unexpected void");
    expect(r.pool).toBe(4);
    expect(r.payouts.find((p) => p.userId === "w2")!.payout).toBe(2);
    expect(r.payouts.reduce((s, p) => s + p.payout, 0)).toBe(4);
  });

  it("property: 500 random sets pay out exactly the pool, never negative, winners never lose", () => {
    const r = rng(42);
    let checked = 0;
    for (let i = 0; i < 500; i++) {
      const positions = randomPositions(r);
      const outcome = r() < 0.5 ? "yes" : "no";
      const res = computePayouts(positions, outcome);
      const winSide = outcome === "yes" ? "back" : "fade";
      const hasBoth =
        positions.some((p) => p.side === "back") && positions.some((p) => p.side === "fade");
      if (!hasBoth) {
        expect(res).toEqual({ void: true });
        continue;
      }
      if ("void" in res) throw new Error("should not void");
      checked++;
      const pool = positions.reduce((s, p) => s + p.points, 0);
      expect(res.pool).toBe(pool);
      expect(res.payouts.reduce((s, p) => s + p.payout, 0)).toBe(pool);
      for (const p of res.payouts) {
        const stake = positions.find((x) => x.userId === p.userId)!;
        expect(stake.side).toBe(winSide);
        expect(p.payout).toBeGreaterThanOrEqual(stake.points);
        expect(Number.isInteger(p.payout)).toBe(true);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(200);
  });
});

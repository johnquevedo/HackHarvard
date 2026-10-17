import { and, eq, inArray, sql } from "drizzle-orm";
import { DennisError } from "@dennis/contracts";
import {
  marketPositions,
  markets,
  pointsAccounts,
  pointsLedger,
  users,
} from "@dennis/db";
import type { PlatformContext } from "@dennis/platform";
import { GATES } from "../rules";

export interface LedgerPosting {
  userId: string;
  marketId: string | null;
  kind: "grant" | "stake" | "payout" | "refund" | "adjustment";
  delta: number;
  refId: string | null;
  idempotencyKey: string;
}

export interface PostedEntry {
  id: string;
  userId: string;
  marketId: string | null;
  kind: LedgerPosting["kind"];
  delta: number;
  balanceAfter: number;
  replayed: boolean;
}

// Drizzle's transaction handle and the db share this surface; ledger code accepts either.
type Tx = Pick<
  PlatformContext["db"],
  "select" | "insert" | "update" | "delete" | "run" | "all" | "get"
>;

// Posts entries inside an existing transaction. Enforces L1 (balance equals the sum of deltas, kept
// by updating the account in the same transaction), L2 (no negative balance), L4 (idempotency key
// replay is a no-op, but a replay with different content is a conflict).
export function postLedgerTx(
  ctx: PlatformContext,
  tx: Tx,
  entries: LedgerPosting[],
): PostedEntry[] {
  const posted: PostedEntry[] = [];
  for (const e of entries) {
    if (!Number.isInteger(e.delta))
      throw new DennisError(
        "validation_error",
        "ledger delta must be an integer",
        400,
      );
    const existing = tx
      .select()
      .from(pointsLedger)
      .where(eq(pointsLedger.idempotencyKey, e.idempotencyKey))
      .get();
    if (existing) {
      if (
        existing.userId !== e.userId ||
        existing.delta !== e.delta ||
        existing.kind !== e.kind ||
        existing.marketId !== e.marketId
      ) {
        throw new DennisError(
          "idempotency_conflict",
          `ledger key ${e.idempotencyKey} reused with different content`,
          409,
        );
      }
      posted.push({
        id: existing.id,
        userId: existing.userId,
        marketId: existing.marketId,
        kind: e.kind,
        delta: existing.delta,
        balanceAfter: existing.balanceAfter,
        replayed: true,
      });
      continue;
    }
    const account = tx
      .select()
      .from(pointsAccounts)
      .where(eq(pointsAccounts.userId, e.userId))
      .get();
    const before = account?.balance ?? 0;
    const after = before + e.delta;
    if (after < 0)
      throw new DennisError(
        "validation_error",
        "not enough points for this posting",
        400,
        { userId: e.userId, balance: before, delta: e.delta },
      );
    const id = ctx.ids.next("ledger");
    tx.insert(pointsLedger)
      .values({
        id,
        userId: e.userId,
        marketId: e.marketId,
        kind: e.kind,
        delta: e.delta,
        balanceAfter: after,
        refId: e.refId,
        idempotencyKey: e.idempotencyKey,
        createdAt: ctx.clock.nowIso(),
      })
      .run();
    if (account)
      tx.update(pointsAccounts)
        .set({ balance: after })
        .where(eq(pointsAccounts.userId, e.userId))
        .run();
    else
      tx.insert(pointsAccounts)
        .values({ userId: e.userId, balance: after })
        .run();
    posted.push({
      id,
      userId: e.userId,
      marketId: e.marketId,
      kind: e.kind,
      delta: e.delta,
      balanceAfter: after,
      replayed: false,
    });
  }
  return posted;
}

// Single transaction; enforces L1, L2, L4.
export function postLedger(
  ctx: PlatformContext,
  entries: LedgerPosting[],
): void {
  ctx.db.transaction((tx) => {
    postLedgerTx(ctx, tx as unknown as Tx, entries);
  });
}

export function getBalance(ctx: PlatformContext, userId: string): number {
  return (
    ctx.db
      .select()
      .from(pointsAccounts)
      .where(eq(pointsAccounts.userId, userId))
      .get()?.balance ?? 0
  );
}

// Starter grant, once per user per reset (idempotent by key).
export function ensureStarterGrant(
  ctx: PlatformContext,
  userId: string,
): PostedEntry[] {
  return ctx.db.transaction((tx) =>
    postLedgerTx(ctx, tx as unknown as Tx, [
      {
        userId,
        marketId: null,
        kind: "grant",
        delta: GATES.starterPoints,
        refId: null,
        idempotencyKey: `grant:starter:${userId}`,
      },
    ]),
  );
}

export function grantAllUsers(ctx: PlatformContext): number {
  const rows = ctx.db.select({ id: users.id }).from(users).all();
  let granted = 0;
  for (const r of rows)
    granted += ensureStarterGrant(ctx, r.id).filter((p) => !p.replayed).length;
  return granted;
}

export interface InvariantCheck {
  id: string;
  ok: boolean;
  detail: string;
}

// L1 to L6 (Section 7.4), read-only.
export async function checkLedgerInvariants(
  ctx: PlatformContext,
): Promise<InvariantCheck[]> {
  const db = ctx.db;
  const checks: InvariantCheck[] = [];

  const l1 = db.all<{ user_id: string; balance: number; total: number | null }>(
    sql`select a.user_id, a.balance, (select sum(l.delta) from points_ledger l where l.user_id = a.user_id) as total from points_accounts a`,
  );
  const l1bad = l1.filter((r) => r.balance !== (r.total ?? 0));
  const orphan = db.all<{ user_id: string }>(
    sql`select distinct user_id from points_ledger where user_id not in (select user_id from points_accounts)`,
  );
  checks.push({
    id: "L1",
    ok: l1bad.length === 0 && orphan.length === 0,
    detail:
      l1bad.length + orphan.length === 0
        ? `${l1.length} accounts match their ledgers`
        : `mismatch for ${[...l1bad.map((r) => r.user_id), ...orphan.map((r) => r.user_id)].join(", ")}`,
  });

  const neg =
    db.all<{ n: number }>(
      sql`select count(*) as n from points_ledger where balance_after < 0`,
    )[0]?.n ?? 0;
  const negAcc =
    db.all<{ n: number }>(
      sql`select count(*) as n from points_accounts where balance < 0`,
    )[0]?.n ?? 0;
  checks.push({
    id: "L2",
    ok: neg + negAcc === 0,
    detail:
      neg + negAcc === 0
        ? "no negative balance"
        : `${neg + negAcc} negative balances`,
  });

  const l3 = db.all<{ id: string; status: string; total: number | null }>(
    sql`select m.id, m.status, (select sum(l.delta) from points_ledger l where l.market_id = m.id and l.kind in ('stake','payout','refund')) as total from markets m where m.status in ('resolved','void')`,
  );
  const l3bad = l3.filter((r) => (r.total ?? 0) !== 0);
  checks.push({
    id: "L3",
    ok: l3bad.length === 0,
    detail:
      l3bad.length === 0
        ? `${l3.length} settled markets are zero-sum`
        : `not zero-sum: ${l3bad.map((r) => `${r.id}=${r.total}`).join(", ")}`,
  });

  const dupLedger =
    db.all<{ n: number }>(
      sql`select count(*) - count(distinct idempotency_key) as n from points_ledger`,
    )[0]?.n ?? 0;
  const dupPos =
    db.all<{ n: number }>(
      sql`select count(*) - count(distinct idempotency_key) as n from market_positions`,
    )[0]?.n ?? 0;
  checks.push({
    id: "L4",
    ok: dupLedger + dupPos === 0,
    detail:
      dupLedger + dupPos === 0
        ? "idempotency keys unique"
        : "duplicate idempotency keys",
  });

  const l5 = db.all<{ id: string }>(
    sql`select p.id from market_positions p where p.points < 1 or p.points > ${GATES.maxStake}
        or not exists (select 1 from points_ledger l where l.idempotency_key = 'stake:' || p.id and l.delta = -p.points and l.balance_after >= 0)`,
  );
  checks.push({
    id: "L5",
    ok: l5.length === 0,
    detail:
      l5.length === 0
        ? "every position within limits and fully staked"
        : `bad positions: ${l5.map((r) => r.id).join(", ")}`,
  });

  const multiPayout = db.all<{ market_id: string }>(
    sql`select market_id from points_ledger where kind in ('payout','refund') and market_id is not null group by market_id, user_id, kind having count(*) > 1`,
  );
  const mixed = db.all<{ market_id: string }>(
    sql`select market_id from points_ledger where market_id is not null group by market_id having sum(kind = 'payout') > 0 and sum(kind = 'refund') > 0`,
  );
  const voidMissing = db.all<{ id: string }>(
    sql`select p.id from market_positions p join markets m on m.id = p.market_id where m.status = 'void'
        and (select count(*) from points_ledger l where l.idempotency_key = 'refund:' || p.id) <> 1`,
  );
  const unsettledPaid = db.all<{ market_id: string }>(
    sql`select distinct l.market_id from points_ledger l join markets m on m.id = l.market_id where l.kind in ('payout','refund') and m.status not in ('resolved','void')`,
  );
  const l6bad =
    multiPayout.length +
    mixed.length +
    voidMissing.length +
    unsettledPaid.length;
  checks.push({
    id: "L6",
    ok: l6bad === 0,
    detail:
      l6bad === 0
        ? "each market settled at most once; void refunds exactly once"
        : `settlement anomalies: ${l6bad}`,
  });

  return checks;
}

export function marketStakeSum(tx: Tx, marketId: string): number {
  return (
    tx.all<{ total: number | null }>(
      sql`select sum(delta) as total from points_ledger where market_id = ${marketId} and kind in ('stake','payout','refund')`,
    )[0]?.total ?? 0
  );
}

export function positionsFor(tx: Tx, marketId: string) {
  return tx
    .select()
    .from(marketPositions)
    .where(eq(marketPositions.marketId, marketId))
    .orderBy(marketPositions.createdAt)
    .all();
}

export function marketsByIds(tx: Tx, ids: string[]) {
  return ids.length === 0
    ? []
    : tx.select().from(markets).where(inArray(markets.id, ids)).all();
}

export function ledgerFor(ctx: PlatformContext, userId: string, limit = 200) {
  return ctx.db
    .select()
    .from(pointsLedger)
    .where(and(eq(pointsLedger.userId, userId)))
    .orderBy(sql`rowid desc`)
    .limit(limit)
    .all();
}

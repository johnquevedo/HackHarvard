import type { PurchaseCard } from "@/components/PurchasingView";
import type { ShortMeCard } from "@/components/ShortMeView";
import { api } from "./api";

// The product screens render one card. Mock mode returns that card directly; the live server
// returns lists and detail records, so these helpers build the same card from live responses.

interface LiveMarketDetail {
  market: { id: string; status: string; question: string };
  participants: { userId: string; firstName: string; role: string }[];
  positions: { firstName: string; side: string; points: number; selfShort: boolean }[];
  pools: { back: number; fade: number };
  resolution: { proposedOutcome: string; status: string } | null;
}

interface LiveLedgerEntry {
  marketId: string | null;
  kind: string;
  delta: number;
  balanceAfter: number;
  createdAt: string;
}

interface LiveGroupDetail {
  group: {
    id: string;
    individualPriceCents: number;
    groupUnitPriceCents: number;
    savingsPerMemberCents: number;
  };
  members: { agentId: string; joinState: string; payState: string }[];
  offer: { merchantName: string; isSimulated: boolean; sourceLabel: string } | null;
}

interface LivePayment {
  groupId: string;
  userId: string;
  status: string;
  providerTransferId: string | null;
  balancesBefore: { fromCents: number } | null;
  balancesAfter: { fromCents: number } | null;
}

interface LiveUser {
  user: { id: string; firstName: string };
  agent: { id: string };
}

const SETTLED = new Set(["resolved", "void"]);

export async function loadShortMeCard(status: string): Promise<ShortMeCard | null> {
  const body = await api<unknown>(`/api/shortme/markets?status=${status}`);
  if (!Array.isArray(body)) return body as ShortMeCard;
  const first = body[0] as { id: string } | undefined;
  return first ? loadShortMeCardById(first.id) : null;
}

export async function loadShortMeCardById(marketId: string): Promise<ShortMeCard> {
  const [detail, leaderboard, invariants] = await Promise.all([
    api<LiveMarketDetail | ShortMeCard>(`/api/shortme/markets/${marketId}`),
    api<ShortMeCard["leaderboard"]>("/api/shortme/leaderboard"),
    api<{ ok: boolean }>("/api/shortme/invariants").catch(() => ({ ok: false })),
  ]);
  if (!("market" in detail)) return detail;
  const ledgers = await Promise.all(
    detail.participants.map(async (participant) => {
      const { entries } = await api<{ entries: LiveLedgerEntry[] }>(
        `/api/shortme/ledger?userId=${participant.userId}`,
      );
      return entries
        .filter((entry) => entry.marketId === marketId)
        .map((entry) => ({ ...entry, name: participant.firstName }));
    }),
  );
  const ledger = ledgers
    .flat()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(({ name, kind, delta, balanceAfter }) => ({ name, kind, delta, balanceAfter }));
  const held = SETTLED.has(detail.market.status) ? 0 : detail.pools.back + detail.pools.fade;
  if (held > 0) ledger.push({ name: "Pool", kind: "stake", delta: held, balanceAfter: held });
  const subject = detail.participants.find((participant) => participant.role === "subject");
  return {
    marketId,
    status: detail.market.status,
    question: detail.market.question,
    subject: subject?.firstName ?? "unknown",
    pools: detail.pools,
    positions: detail.positions.map((position) => ({
      name: position.firstName,
      side: position.side,
      points: position.points,
      selfShort: position.selfShort,
    })),
    resolution: detail.resolution
      ? `${detail.resolution.proposedOutcome.toUpperCase()} ${detail.resolution.status}`
      : "none",
    invariantOk: invariants.ok,
    leaderboard,
    ledger,
  };
}

export async function loadPurchaseCard(state: string): Promise<PurchaseCard | null> {
  const body = await api<unknown>(`/api/purchasing/groups?state=${state}`);
  if (!Array.isArray(body)) return body as PurchaseCard;
  const latest = (body as { id: string; updatedAt: string }[])
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!latest) return null;
  const [detail, payments, bank, users] = await Promise.all([
    api<LiveGroupDetail>(`/api/purchasing/groups/${latest.id}`),
    api<LivePayment[]>("/api/purchasing/payments"),
    api<{ mode: string; accounts: { ownerKey: string; last4: string; balanceCents: number }[] }>(
      "/api/purchasing/bank/accounts",
    ),
    api<LiveUser[]>("/api/users"),
  ]);
  const userByAgent = new Map(users.map((row) => [row.agent.id, row.user]));
  const rows = detail.members.map((member) => {
    const user = userByAgent.get(member.agentId);
    const payment = payments.find((item) => item.groupId === latest.id && item.userId === user?.id);
    const account = bank.accounts.find((item) => item.ownerKey === user?.id);
    return { member, name: user?.firstName ?? member.agentId, payment, account };
  });
  return {
    offerLabel: detail.offer?.isSimulated
      ? "SIMULATED OFFER"
      : (detail.offer?.sourceLabel ?? "OFFER"),
    merchant: detail.offer?.merchantName ?? "unknown merchant",
    individualCents: detail.group.individualPriceCents,
    groupCents: detail.group.groupUnitPriceCents,
    savingsCents: detail.group.savingsPerMemberCents,
    members: rows.map(({ member, name, payment }) => ({
      name,
      join: member.joinState,
      pay: payment?.status ?? member.payState,
    })),
    bankMode: bank.mode === "live" ? "live" : "simulated",
    accounts: rows.map(({ name, payment, account }) => ({
      label: name,
      last4: account?.last4 ?? "----",
      before: payment?.balancesBefore?.fromCents ?? account?.balanceCents ?? 0,
      after: payment?.balancesAfter?.fromCents ?? account?.balanceCents ?? 0,
      providerTransferId: payment?.providerTransferId ?? null,
      status: payment?.status ?? "pending",
    })),
  };
}

// Approves the user's newest pending approval through the dashboard fallback.
export async function approveLatestPending(userId: string): Promise<string> {
  const approvals = await api<{ id: string; status: string; kind?: string }[]>(
    `/api/approvals?userId=${userId}&status=pending`,
  );
  const pending = approvals.find((approval) => approval.status === "pending");
  if (!pending) return "nothing pending";
  await api(`/api/approvals/${pending.id}/decision`, {
    method: "POST",
    body: { userId, decision: "approve" },
  });
  return `approved ${pending.kind ?? pending.id}`;
}

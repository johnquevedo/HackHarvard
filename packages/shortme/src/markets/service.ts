import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  DennisError,
  hashPayload,
  type AgentT,
  type ApprovalT,
  type IntentT,
} from "@dennis/contracts";
import {
  marketInvites,
  marketParticipants,
  marketPositions,
  marketResolutions,
  markets,
} from "@dennis/db";
import type { PlatformContext } from "@dennis/platform";
import { fillSubject, marketInviteText, publishMarketPrompt } from "../templates";
import { ensureStarterGrant, getBalance } from "../ledger/ledger";
import {
  approvalTtlMinutes,
  GATES,
  newInviteCode,
  PRIVATE_DRAFT_HEADLINE,
  RESOLUTION_CRITERIA,
  TEMPLATE_KEY,
} from "../rules";
import { emitMarketUpdated } from "./events";
import { assertTransition, TERMINAL, type MarketStatus } from "./state";

export type MarketRow = typeof markets.$inferSelect;
export type ParticipantRow = typeof marketParticipants.$inferSelect;

export interface PublishPayload {
  question: string;
  invitees: { userId: string; firstName: string }[];
  pointsOnly: true;
}

export function getMarket(ctx: PlatformContext, marketId: string): MarketRow | undefined {
  return ctx.db.select().from(markets).where(eq(markets.id, marketId)).get();
}

export function requireMarket(ctx: PlatformContext, marketId: string): MarketRow {
  const m = getMarket(ctx, marketId);
  if (!m) throw new DennisError("not_found", "market not found", 404);
  return m;
}

export function marketByOpportunity(
  ctx: PlatformContext,
  opportunityId: string | null,
): MarketRow | undefined {
  if (!opportunityId) return undefined;
  return ctx.db.select().from(markets).where(eq(markets.opportunityId, opportunityId)).get();
}

export function participantsOf(ctx: PlatformContext, marketId: string): ParticipantRow[] {
  return ctx.db
    .select()
    .from(marketParticipants)
    .where(eq(marketParticipants.marketId, marketId))
    .all();
}

function setStatus(
  ctx: PlatformContext,
  m: MarketRow,
  to: MarketStatus,
  extra: Partial<MarketRow> = {},
): MarketRow {
  assertTransition(m.status, to);
  const now = ctx.clock.nowIso();
  const res = ctx.db
    .update(markets)
    .set({ status: to, updatedAt: now, ...extra })
    .where(and(eq(markets.id, m.id), eq(markets.status, m.status)))
    .run();
  if (res.changes !== 1) throw new DennisError("conflict", "market changed concurrently", 409);
  return { ...m, status: to, updatedAt: now, ...extra };
}

export async function syncOpportunity(ctx: PlatformContext, m: MarketRow): Promise<void> {
  const published = m.openedAt !== null;
  const agentIds = new Set<string>([m.subjectAgentId]);
  if (published) {
    for (const p of participantsOf(ctx, m.id)) {
      const a = await ctx.users.getAgentByUserId(p.userId);
      if (a) agentIds.add(a.id);
    }
  }
  await ctx.opportunities.upsert({
    type: "shortme_market",
    domainRefId: m.id,
    status: m.status,
    headline: published ? `ShortMe: ${m.question}` : PRIVATE_DRAFT_HEADLINE,
    participantAgentIds: [...agentIds],
  });
}

async function transition(
  ctx: PlatformContext,
  m: MarketRow,
  to: MarketStatus,
  extra: Partial<MarketRow> = {},
): Promise<MarketRow> {
  const next = setStatus(ctx, m, to, extra);
  emitMarketUpdated(ctx, next);
  await syncOpportunity(ctx, next);
  return next;
}

// Friends who may be invited right now: invitable friend links whose owners hold shortme_free_play.
export async function eligibleInvitees(
  ctx: PlatformContext,
  subjectUserId: string,
): Promise<{ userId: string; firstName: string }[]> {
  const friends = await ctx.users.listFriends(subjectUserId, {
    canInvite: true,
  });
  const out: { userId: string; firstName: string }[] = [];
  for (const f of friends) {
    if (f.id !== subjectUserId && (await ctx.consent.has(f.id, "shortme_free_play")))
      out.push({ userId: f.id, firstName: f.firstName });
  }
  return out;
}

// Detection handler (A3-01/A3-05): milestone intent to a private `proposed` market plus a
// publish_market approval. Nothing leaves the subject's lane until the subject approves.
export async function handleMilestoneDetection(
  ctx: PlatformContext,
  input: { intent: IntentT; agent: AgentT },
): Promise<MarketRow | null> {
  const { intent, agent } = input;
  const p = intent.privatePayload as {
    category?: string;
    proposedQuestion?: string;
    redactions?: string[];
    resolvesWithinDays?: number | null;
  };
  const log = (reason: string) =>
    ctx.log.info("shortme.no_market", { intentId: intent.id, reason });
  if (!agent.settings.shortmeEnabled || agent.status !== "active")
    return (log("agent_disabled"), null);
  if (!(await ctx.consent.has(intent.userId, "shortme_free_play")))
    return (log("no_shortme_consent"), null);
  if (
    !p.category ||
    !GATES.enabledTemplates.includes(p.category) ||
    GATES.blockedCategories.includes(p.category)
  )
    return (log("template_disabled"), null);
  const existing = ctx.db.select().from(markets).where(eq(markets.sourceIntentId, intent.id)).get();
  if (existing) return existing;
  const user = await ctx.users.get(intent.userId);
  if (!user) return (log("no_user"), null);

  const marketId = ctx.ids.next("market");
  const question = fillSubject(
    p.proposedQuestion ?? "Will {subject} get the offer?",
    user.firstName,
  ).slice(0, 160);
  const invitees = await eligibleInvitees(ctx, user.id);
  const opp = await ctx.opportunities.upsert({
    type: "shortme_market",
    domainRefId: marketId,
    status: "proposed",
    headline: PRIVATE_DRAFT_HEADLINE,
    participantAgentIds: [agent.id],
  });
  const now = ctx.clock.nowIso();
  const lockDays = p.resolvesWithinDays ?? GATES.defaultResolvesWithinDays;
  const row: MarketRow = {
    id: marketId,
    opportunityId: opp.id,
    subjectUserId: user.id,
    subjectAgentId: agent.id,
    sourceIntentId: intent.id,
    category: p.category,
    templateKey: TEMPLATE_KEY,
    question,
    resolutionCriteria: RESOLUTION_CRITERIA,
    status: "proposed",
    lockAt: new Date(ctx.clock.now().getTime() + lockDays * 86_400_000).toISOString(),
    outcome: null,
    resolverKind: "demo_standin",
    redactions: (p.redactions ?? []).slice(0, 5),
    createdAt: now,
    updatedAt: now,
    openedAt: null,
    resolvedAt: null,
  };
  ctx.db.transaction((tx) => {
    tx.insert(markets).values(row).run();
    tx.insert(marketParticipants)
      .values({
        marketId,
        userId: user.id,
        role: "subject",
        inviteState: "not_applicable",
      })
      .run();
  });
  ensureStarterGrant(ctx, user.id);
  emitMarketUpdated(ctx, row);

  const payload: PublishPayload = { question, invitees, pointsOnly: true };
  await ctx.approvals.request({
    kind: "publish_market",
    userId: user.id,
    agentId: agent.id,
    opportunityId: opp.id,
    payload: payload as unknown as Record<string, unknown>,
    promptText: publishMarketPrompt({
      first: user.firstName,
      question,
      names: invitees.map((i) => i.firstName),
    }),
    ttlMinutes: approvalTtlMinutes(user.isDemo),
    idempotencyKey: `publish_market:${marketId}`,
  });
  return row;
}

// onDecided('publish_market'): approved opens the market and invites; declined or expired ends it.
export async function onPublishDecided(ctx: PlatformContext, approval: ApprovalT): Promise<void> {
  const m = marketByOpportunity(ctx, approval.opportunityId);
  if (!m || m.status !== "proposed") return;
  if (approval.userId !== m.subjectUserId)
    throw new DennisError("forbidden", "only the subject can publish", 403);
  await ctx.runExclusive(`market:${m.id}`, async () => {
    const cur = requireMarket(ctx, m.id);
    if (cur.status !== "proposed") return;
    if (approval.status === "declined" || approval.status === "revoked") {
      await transition(ctx, cur, "declined");
      return;
    }
    if (approval.status === "expired") {
      await transition(ctx, cur, "expired");
      return;
    }
    if (approval.status !== "approved") return;
    const approvedInvitees = ((approval.payload as unknown as PublishPayload).invitees ?? []).map(
      (i) => ({ userId: i.userId, firstName: i.firstName }),
    );
    const expected: PublishPayload = {
      question: cur.question,
      invitees: approvedInvitees,
      pointsOnly: true,
    };
    await ctx.approvals.assertApproved({
      approvalId: approval.id,
      userId: cur.subjectUserId,
      kind: "publish_market",
      payloadHash: hashPayload(expected as unknown as Record<string, unknown>),
    });
    // Consumption and the open transition commit together (CR-A2-001 consumeInTransaction).
    const opened = ctx.db.transaction((tx) => {
      ctx.approvals.consumeInTransaction(approval.id, tx);
      return setStatus(ctx, cur, "open", { openedAt: ctx.clock.nowIso() });
    });
    emitMarketUpdated(ctx, opened);
    await syncOpportunity(ctx, opened);
    await sendInvites(ctx, opened, approvedInvitees);
  });
}

// Invitations go only to approved invitees who still hold shortme_free_play right now. The payload
// is the subject-approved question and nothing else from the source message.
export async function sendInvites(
  ctx: PlatformContext,
  m: MarketRow,
  approved: { userId: string }[],
): Promise<number> {
  const subject = await ctx.users.get(m.subjectUserId);
  let sent = 0;
  const expiresAt = new Date(
    ctx.clock.now().getTime() + GATES.inviteTtlMinutes * 60_000,
  ).toISOString();
  for (const inv of approved) {
    if (inv.userId === m.subjectUserId) continue;
    if (!(await ctx.consent.has(inv.userId, "shortme_free_play"))) continue;
    const friendAgent = await ctx.users.getAgentByUserId(inv.userId);
    if (!friendAgent) continue;
    ctx.db.transaction((tx) => {
      tx.insert(marketParticipants)
        .values({
          marketId: m.id,
          userId: inv.userId,
          role: "friend",
          inviteState: "invited",
        })
        .onConflictDoNothing()
        .run();
      const existing = tx
        .select()
        .from(marketInvites)
        .where(and(eq(marketInvites.marketId, m.id), eq(marketInvites.userId, inv.userId)))
        .get();
      if (!existing) {
        tx.insert(marketInvites)
          .values({
            marketId: m.id,
            userId: inv.userId,
            code: newInviteCode(takenCodes(ctx, inv.userId)),
            expiresAt,
            createdAt: ctx.clock.nowIso(),
          })
          .run();
      }
    });
    ensureStarterGrant(ctx, inv.userId);
    await ctx.a2a.send({
      type: "market.invite",
      fromAgentId: m.subjectAgentId,
      toAgentId: friendAgent.id,
      conversationId: `cnv_${m.sourceIntentId ?? m.id}`,
      opportunityId: m.opportunityId,
      payload: {
        marketId: m.id,
        question: m.question,
        subjectFirstName: subject?.firstName ?? "your friend",
        pointsOnly: true,
        startingPoints: getBalance(ctx, inv.userId),
        expiresAt,
      },
      idempotencyKey: `market.invite:${m.id}:${inv.userId}`,
    });
    sent++;
  }
  await syncOpportunity(ctx, requireMarket(ctx, m.id));
  return sent;
}

// Codes of the user's invitations in markets that are still live, so a new code never collides.
function takenCodes(ctx: PlatformContext, userId: string): Set<string> {
  const rows = ctx.db
    .select({ code: marketInvites.code })
    .from(marketInvites)
    .innerJoin(markets, eq(markets.id, marketInvites.marketId))
    .where(
      and(
        eq(marketInvites.userId, userId),
        inArray(markets.status, ["open", "locked", "resolution_proposed", "disputed"]),
      ),
    )
    .all();
  return new Set(rows.map((r) => r.code));
}

export function inviteFor(ctx: PlatformContext, marketId: string, userId: string) {
  return ctx.db
    .select()
    .from(marketInvites)
    .where(and(eq(marketInvites.marketId, marketId), eq(marketInvites.userId, userId)))
    .get();
}

// A2A handler on the friend's agent: validate, check consent again, allocate a code, notify the user.
export async function onMarketInvite(
  ctx: PlatformContext,
  msg: {
    toAgentId: string;
    fromAgentId: string;
    conversationId: string;
    opportunityId: string | null;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const marketId = String(msg.payload.marketId ?? "");
  const m = requireMarket(ctx, marketId);
  const agent = await ctx.users.getAgent(msg.toAgentId);
  if (!agent) throw new DennisError("not_found", "invitee agent not found", 404);
  const part = ctx.db
    .select()
    .from(marketParticipants)
    .where(
      and(eq(marketParticipants.marketId, marketId), eq(marketParticipants.userId, agent.userId)),
    )
    .get();
  const respond = (response: "accepted" | "declined" | "expired") =>
    ctx.a2a.send({
      type: "market.invite_response",
      fromAgentId: agent.id,
      toAgentId: m.subjectAgentId,
      conversationId: msg.conversationId,
      opportunityId: m.opportunityId,
      payload: { marketId, response },
      idempotencyKey: `market.invite_response:${marketId}:${agent.userId}:${response}`,
    });
  if (!part || part.role !== "friend" || m.status !== "open") return;
  if (!(await ctx.consent.has(agent.userId, "shortme_free_play")) || agent.status !== "active") {
    ctx.db
      .update(marketParticipants)
      .set({ inviteState: "declined" })
      .where(
        and(eq(marketParticipants.marketId, marketId), eq(marketParticipants.userId, agent.userId)),
      )
      .run();
    await respond("declined");
    return;
  }
  const invite = inviteFor(ctx, marketId, agent.userId);
  if (!invite) throw new DennisError("not_found", "invitation record missing", 404);
  const code = invite.code;
  await ctx.notifier.send({
    userId: agent.userId,
    kind: "invite",
    text: marketInviteText({
      subjectFirst: String(msg.payload.subjectFirstName ?? "your friend"),
      question: m.question,
      points: getBalance(ctx, agent.userId),
      code,
    }),
    opportunityId: m.opportunityId,
    idempotencyKey: `invite_notify:${marketId}:${agent.userId}`,
  });
}

// A2A handler on the subject's agent: record the friend's answer (reason codes only).
export async function onInviteResponse(
  ctx: PlatformContext,
  msg: { fromAgentId: string; payload: Record<string, unknown> },
): Promise<void> {
  const marketId = String(msg.payload.marketId ?? "");
  const response = String(msg.payload.response ?? "");
  const from = await ctx.users.getAgent(msg.fromAgentId);
  if (!from || !["accepted", "declined", "expired"].includes(response)) return;
  ctx.db
    .update(marketParticipants)
    .set({ inviteState: response })
    .where(
      and(
        eq(marketParticipants.marketId, marketId),
        eq(marketParticipants.userId, from.userId),
        eq(marketParticipants.role, "friend"),
        inArray(marketParticipants.inviteState, ["invited", "accepted"]),
      ),
    )
    .run();
}

export async function passInvite(
  ctx: PlatformContext,
  input: { marketId: string; userId: string },
): Promise<void> {
  await ctx.runExclusive(`market:${input.marketId}`, async () => {
    const m = requireMarket(ctx, input.marketId);
    const part = ctx.db
      .select()
      .from(marketParticipants)
      .where(
        and(eq(marketParticipants.marketId, m.id), eq(marketParticipants.userId, input.userId)),
      )
      .get();
    if (!part || part.role !== "friend")
      throw new DennisError("not_found", "no invitation for this user", 404);
    if (part.inviteState !== "invited")
      throw new DennisError("invalid_state", `invitation is ${part.inviteState}`, 409);
    const pos = ctx.db
      .select()
      .from(marketPositions)
      .where(and(eq(marketPositions.marketId, m.id), eq(marketPositions.userId, input.userId)))
      .get();
    if (pos) throw new DennisError("conflict", "already holds a position", 409);
    ctx.db
      .update(marketParticipants)
      .set({ inviteState: "declined" })
      .where(
        and(eq(marketParticipants.marketId, m.id), eq(marketParticipants.userId, input.userId)),
      )
      .run();
    const agent = await ctx.users.getAgentByUserId(input.userId);
    if (agent) {
      await ctx.a2a.send({
        type: "market.invite_response",
        fromAgentId: agent.id,
        toAgentId: m.subjectAgentId,
        conversationId: `cnv_${m.sourceIntentId ?? m.id}`,
        opportunityId: m.opportunityId,
        payload: { marketId: m.id, response: "declined" },
        idempotencyKey: `market.invite_response:${m.id}:${input.userId}:declined`,
      });
    }
  });
}

export async function lockMarket(ctx: PlatformContext, marketId: string): Promise<MarketRow> {
  return ctx.runExclusive(`market:${marketId}`, async () =>
    transition(ctx, requireMarket(ctx, marketId), "locked"),
  );
}

// Periodic sweep: lock markets past lock_at; expire unanswered invitations.
export async function sweep(
  ctx: PlatformContext,
): Promise<{ locked: number; invitesExpired: number }> {
  const now = ctx.clock.nowIso();
  let locked = 0;
  for (const m of ctx.db
    .select()
    .from(markets)
    .where(and(eq(markets.status, "open"), isNotNull(markets.lockAt), lt(markets.lockAt, now)))
    .all()) {
    await lockMarket(ctx, m.id).then(
      () => locked++,
      () => undefined,
    );
  }
  const stale = ctx.db
    .select({
      marketId: marketParticipants.marketId,
      userId: marketParticipants.userId,
    })
    .from(marketParticipants)
    .innerJoin(
      marketInvites,
      and(
        eq(marketInvites.marketId, marketParticipants.marketId),
        eq(marketInvites.userId, marketParticipants.userId),
      ),
    )
    .where(and(eq(marketParticipants.inviteState, "invited"), lt(marketInvites.expiresAt, now)))
    .all();
  for (const p of stale) {
    ctx.db
      .update(marketParticipants)
      .set({ inviteState: "expired" })
      .where(
        and(eq(marketParticipants.marketId, p.marketId), eq(marketParticipants.userId, p.userId)),
      )
      .run();
    const m = getMarket(ctx, p.marketId);
    const agent = await ctx.users.getAgentByUserId(p.userId);
    if (m && agent) {
      await ctx.a2a.send({
        type: "market.invite_response",
        fromAgentId: agent.id,
        toAgentId: m.subjectAgentId,
        conversationId: `cnv_${m.sourceIntentId ?? m.id}`,
        opportunityId: m.opportunityId,
        payload: { marketId: m.id, response: "expired" },
        idempotencyKey: `market.invite_response:${m.id}:${p.userId}:expired`,
      });
    }
  }
  return { locked, invitesExpired: stale.length };
}

// Consent cascade (Section 14.5): shortme_free_play or messaging_context revoked.
export async function onShortmeConsentRevoked(
  ctx: PlatformContext,
  userId: string,
  scope: string,
): Promise<void> {
  if (scope !== "shortme_free_play" && scope !== "messaging_context") return;
  for (const m of ctx.db
    .select()
    .from(markets)
    .where(and(eq(markets.subjectUserId, userId), eq(markets.status, "proposed")))
    .all()) {
    await ctx.runExclusive(`market:${m.id}`, async () => {
      const cur = requireMarket(ctx, m.id);
      if (cur.status === "proposed") await transition(ctx, cur, "declined");
    });
  }
  if (scope !== "shortme_free_play") return;
  const pending = ctx.db
    .select()
    .from(marketParticipants)
    .where(
      and(
        eq(marketParticipants.userId, userId),
        eq(marketParticipants.role, "friend"),
        eq(marketParticipants.inviteState, "invited"),
      ),
    )
    .all();
  for (const p of pending)
    await passInvite(ctx, { marketId: p.marketId, userId }).catch(() => undefined);
}

export function listMarketsFor(
  ctx: PlatformContext,
  q: { viewerAgentId?: string; status?: string },
): MarketRow[] {
  const rows = q.status
    ? ctx.db.select().from(markets).where(eq(markets.status, q.status)).all()
    : ctx.db.select().from(markets).all();
  return rows
    .filter(
      (m) =>
        m.openedAt !== null ||
        (q.viewerAgentId !== undefined && m.subjectAgentId === q.viewerAgentId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function canView(m: MarketRow, viewerAgentId: string | undefined): boolean {
  return m.openedAt !== null || (viewerAgentId !== undefined && viewerAgentId === m.subjectAgentId);
}

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status as MarketStatus);
}

export function openResolution(ctx: PlatformContext, marketId: string) {
  return ctx.db
    .select()
    .from(marketResolutions)
    .where(eq(marketResolutions.marketId, marketId))
    .orderBy(sql`rowid desc`)
    .get();
}

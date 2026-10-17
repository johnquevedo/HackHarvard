import { DennisError } from "@dennis/contracts";
import {
  bankLinks,
  groupPurchaseMembers,
  groupPurchases,
  merchantOffers,
  paymentAttempts,
} from "@dennis/db";
import type { PlatformContext } from "@dennis/platform";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { createBankingProvider } from "./bank/factory.js";
import { seedBank } from "./bank/seed.js";
import { authorizePaymentCopy } from "./copy.js";
import { setGroupStatus } from "./groups/service.js";
import { matchingRules } from "./matching/rules.js";

function requireAdmin(ctx: PlatformContext, header: string | undefined): void {
  if (!header || header !== ctx.config.dennisAdminToken) {
    throw new DennisError("unauthorized", "Admin token required", 401);
  }
}

function paymentView(attempt: typeof paymentAttempts.$inferSelect) {
  return {
    id: attempt.id,
    groupId: attempt.groupId,
    userId: attempt.userId,
    approvalId: attempt.approvalId,
    amountCents: attempt.amountCents,
    status: attempt.status,
    provider: attempt.provider,
    providerTransferId: attempt.providerTransferId,
    balancesBefore: attempt.balancesBefore,
    balancesAfter: attempt.balancesAfter,
    verificationNote: attempt.verificationNote,
    error: attempt.error,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}

export function purchasingRoutes(ctx: PlatformContext): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof DennisError) {
      return c.json(
        { error: { code: error.code, message: error.message, details: error.details } },
        error.status as ContentfulStatusCode,
      );
    }
    ctx.log.error("Purchasing route failed", { message: error.message });
    return c.json({ error: { code: "internal", message: "Internal error" } }, 500);
  });

  app.get("/offers", (c) => {
    return c.json(ctx.db.select().from(merchantOffers).all());
  });

  app.get("/registry", async (c) => {
    const viewerAgentId = c.req.query("viewerAgentId");
    if (!viewerAgentId) requireAdmin(ctx, c.req.header("x-dennis-admin"));
    const items = await ctx.intents.listShared({
      kind: "purchase",
      excludeAgentId: viewerAgentId ?? "agt_system_registry",
    });
    return c.json(items);
  });

  app.get("/groups", (c) => {
    const status = c.req.query("status");
    const query = ctx.db.select().from(groupPurchases);
    return c.json(status ? query.where(eq(groupPurchases.status, status)).all() : query.all());
  });

  app.get("/groups/:groupId", (c) => {
    const groupId = c.req.param("groupId");
    const group = ctx.db.select().from(groupPurchases).where(eq(groupPurchases.id, groupId)).get();
    if (!group) throw new DennisError("not_found", "Group not found", 404);
    const members = ctx.db
      .select()
      .from(groupPurchaseMembers)
      .where(eq(groupPurchaseMembers.groupId, groupId))
      .all();
    const viewerAgentId = c.req.query("viewerAgentId");
    if (viewerAgentId && !members.some((member) => member.agentId === viewerAgentId)) {
      throw new DennisError("forbidden", "Viewer is not a group participant", 403);
    }
    const offer = ctx.db.select().from(merchantOffers).where(eq(merchantOffers.id, group.offerId)).get();
    return c.json({
      group,
      members: members.map((member) => ({
        agentId: member.agentId,
        joinState: member.joinState,
        payState: member.payState,
        shareCents: member.shareCents,
      })),
      offer,
      explain: {
        simulatedOffer: true,
        rulesVersion: matchingRules.version,
        individualPriceCents: group.individualPriceCents,
        groupUnitPriceCents: group.groupUnitPriceCents,
        savingsPerMemberCents: group.savingsPerMemberCents,
      },
    });
  });

  app.get("/bank/accounts", async (c) => {
    const provider = createBankingProvider(ctx.config, { db: ctx.db, clock: ctx.clock, log: ctx.log });
    try {
      return c.json({
        mode: provider.name === "nessie" ? "live" : "simulated",
        accounts: await provider.listAccounts(),
      });
    } catch (error) {
      throw new DennisError(
        "integration_unavailable",
        error instanceof Error ? error.message : "Bank accounts unavailable",
        503,
      );
    }
  });

  app.post("/bank/seed", async (c) => {
    requireAdmin(ctx, c.req.header("x-dennis-admin"));
    const body = await c.req.json<{ runTag?: string }>().catch(() => ({}));
    return c.json(await seedBank(ctx, body.runTag ? { runTag: body.runTag } : {}));
  });

  app.get("/payments", (c) => {
    const groupId = c.req.query("groupId");
    const query = ctx.db.select().from(paymentAttempts);
    const rows = groupId ? query.where(eq(paymentAttempts.groupId, groupId)).all() : query.all();
    return c.json(rows.map(paymentView));
  });

  app.post("/payments/:attemptId/retry", async (c) => {
    requireAdmin(ctx, c.req.header("x-dennis-admin"));
    const attempt = ctx.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, c.req.param("attemptId")))
      .get();
    if (!attempt) throw new DennisError("not_found", "Payment attempt not found", 404);
    if (attempt.status !== "failed") {
      throw new DennisError("invalid_state", "Only failed attempts can be retried", 409);
    }
    const group = ctx.db
      .select()
      .from(groupPurchases)
      .where(eq(groupPurchases.id, attempt.groupId))
      .get();
    const member = ctx.db
      .select()
      .from(groupPurchaseMembers)
      .where(
        and(
          eq(groupPurchaseMembers.groupId, attempt.groupId),
          eq(groupPurchaseMembers.userId, attempt.userId),
        ),
      )
      .get();
    if (!group || !member) throw new DennisError("not_found", "Payment group member not found", 404);
    const user = await ctx.users.get(attempt.userId);
    const offer = ctx.db.select().from(merchantOffers).where(eq(merchantOffers.id, group.offerId)).get();
    const payer = ctx.db.select().from(bankLinks).where(eq(bankLinks.linkKey, attempt.userId)).get();
    const pool = ctx.db.select().from(bankLinks).where(eq(bankLinks.linkKey, "pool")).get();
    if (!user || !offer || !payer || !pool) {
      throw new DennisError("invalid_state", "Retry dependencies are missing", 409);
    }
    const approval = await ctx.approvals.request({
      kind: "authorize_payment",
      userId: attempt.userId,
      agentId: member.agentId,
      opportunityId: group.opportunityId,
      payload: {
        groupId: group.id,
        userId: attempt.userId,
        amountCents: member.shareCents,
        fromAccountRef: payer.accountRef,
        toAccountRef: pool.accountRef,
        productKey: group.productKey,
      },
      promptText: authorizePaymentCopy({
        first: user.firstName,
        amountCents: member.shareCents,
        last4: payer.last4,
        productLabel: offer.title,
      }),
      ttlMinutes: ctx.config.approvalTtlMinutes,
      idempotencyKey: `purchase:retry:${attempt.id}:${ctx.clock.now().getTime()}`,
    });
    ctx.db
      .update(groupPurchaseMembers)
      .set({ payApprovalId: approval.id, payState: "none" })
      .where(
        and(
          eq(groupPurchaseMembers.groupId, attempt.groupId),
          eq(groupPurchaseMembers.userId, attempt.userId),
        ),
      )
      .run();
    setGroupStatus(ctx, group.id, "awaiting_payment_approvals");
    return c.json(approval);
  });

  return app;
}

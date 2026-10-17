import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { DennisError } from "@dennis/contracts";
import { pointsAccounts, pointsLedger } from "@dennis/db";
import type { PlatformContext } from "@dennis/platform";
import { eq, sql } from "drizzle-orm";
import { checkLedgerInvariants, getBalance, ledgerFor, positionsFor } from "./ledger/ledger";
import { computePayouts } from "./ledger/payouts";
import { placePosition } from "./markets/positions";
import {
  canView,
  listMarketsFor,
  lockMarket,
  openResolution,
  participantsOf,
  passInvite,
  requireMarket,
  type MarketRow,
} from "./markets/service";
import { adminResolve, disputeResolution, proposeResolution } from "./resolution/service";
import { DEMO_RESOLVER, GATES, STAND_IN_LABEL } from "./rules";

const STATUS: Record<string, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  consent_required: 403,
  not_found: 404,
  conflict: 409,
  invalid_state: 409,
  idempotency_conflict: 409,
  approval_invalid: 409,
  rate_limited: 429,
  upstream_error: 502,
  integration_unavailable: 503,
  internal: 500,
};

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new DennisError("validation_error", "invalid request", 400, r.error.issues);
  return r.data;
}

const PositionBody = z
  .object({
    userId: z.string().min(1),
    side: z.enum(["back", "fade"]),
    points: z.number().int(),
  })
  .strict();
const UserBody = z.object({ userId: z.string().min(1) }).strict();
const DemoResolveBody = z.object({ outcome: z.enum(["yes", "no"]) }).strict();
const AdminResolveBody = z.object({ outcome: z.enum(["yes", "no", "void"]) }).strict();

function marketView(m: MarketRow) {
  return {
    ...m,
    pointsOnly: true as const,
    resolverLabel: m.resolverKind === "demo_standin" ? STAND_IN_LABEL : null,
  };
}

export async function marketDetail(ctx: PlatformContext, m: MarketRow) {
  const parts = participantsOf(ctx, m.id);
  const positions = positionsFor(ctx.db as never, m.id);
  const names = new Map<string, string>();
  for (const id of new Set([...parts.map((p) => p.userId), ...positions.map((p) => p.userId)]))
    names.set(id, (await ctx.users.get(id))?.firstName ?? "unknown");
  const pools = { back: 0, fade: 0 };
  for (const p of positions) pools[p.side as "back" | "fade"] += p.points;
  const res = openResolution(ctx, m.id) ?? null;
  return {
    market: marketView(m),
    // Invite codes stay out of API responses; only the invitee's own phone sees them.
    participants: parts.map((p) => ({
      marketId: p.marketId,
      userId: p.userId,
      firstName: names.get(p.userId),
      role: p.role,
      inviteState: p.inviteState,
    })),
    positions: positions.map((p) => ({
      ...p,
      firstName: names.get(p.userId),
      selfShort: p.userId === m.subjectUserId && p.side === "fade",
    })),
    pools,
    resolution: res,
    payoutPreview: {
      yes: computePayouts(positions as never, "yes"),
      no: computePayouts(positions as never, "no"),
    },
  };
}

export function shortmeRoutes(ctx: PlatformContext): Hono {
  const app = new Hono();
  const token = (ctx.config as unknown as { dennisAdminToken?: string }).dennisAdminToken;
  const requireAdmin = (c: Context) => {
    if (!token || c.req.header("x-dennis-admin") !== token)
      throw new DennisError("unauthorized", "admin token required", 401);
  };
  const viewer = (c: Context) => c.req.query("viewerAgentId") || undefined;

  app.onError((err, c) => {
    if (err instanceof DennisError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
        },
        (STATUS[err.code] ?? 500) as never,
      );
    }
    ctx.log.error("shortme.route_error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: { code: "internal", message: "internal error" } }, 500);
  });

  app.get("/markets", (c) =>
    c.json(
      listMarketsFor(ctx, {
        viewerAgentId: viewer(c),
        status: c.req.query("status") || undefined,
      }).map(marketView),
    ),
  );

  app.get("/markets/:marketId", async (c) => {
    const m = requireMarket(ctx, c.req.param("marketId"));
    if (!canView(m, viewer(c))) throw new DennisError("not_found", "market not found", 404);
    return c.json(await marketDetail(ctx, m));
  });

  app.post("/markets/:marketId/positions", async (c) => {
    const body = parse(PositionBody, await c.req.json().catch(() => null));
    const key = c.req.header("idempotency-key") ?? `api:${randomUUID()}`;
    const p = await placePosition(ctx, {
      marketId: c.req.param("marketId"),
      userId: body.userId,
      side: body.side,
      points: body.points,
      idempotencyKey: key,
      via: "dashboard_fallback",
    });
    return c.json(p, 201);
  });

  app.post("/markets/:marketId/pass", async (c) => {
    const body = parse(UserBody, await c.req.json().catch(() => null));
    await passInvite(ctx, {
      marketId: c.req.param("marketId"),
      userId: body.userId,
    });
    return c.json(await marketDetail(ctx, requireMarket(ctx, c.req.param("marketId"))));
  });

  // Additive (D14): any participant may dispute a proposed resolution from the dashboard.
  app.post("/markets/:marketId/dispute", async (c) => {
    const body = parse(UserBody, await c.req.json().catch(() => null));
    const m = await disputeResolution(ctx, {
      marketId: c.req.param("marketId"),
      by: body.userId,
    });
    return c.json(await marketDetail(ctx, m));
  });

  app.post("/markets/:marketId/lock", async (c) => {
    requireAdmin(c);
    return c.json(await marketDetail(ctx, await lockMarket(ctx, c.req.param("marketId"))));
  });

  app.post("/markets/:marketId/demo-resolve", async (c) => {
    requireAdmin(c);
    const body = parse(DemoResolveBody, await c.req.json().catch(() => null));
    await proposeResolution(ctx, {
      marketId: c.req.param("marketId"),
      outcome: body.outcome,
      proposedBy: DEMO_RESOLVER,
      evidenceNote: `${STAND_IN_LABEL}: demo resolver proposed ${body.outcome.toUpperCase()}`,
    });
    return c.json(await marketDetail(ctx, requireMarket(ctx, c.req.param("marketId"))));
  });

  app.post("/markets/:marketId/admin-resolve", async (c) => {
    requireAdmin(c);
    const body = parse(AdminResolveBody, await c.req.json().catch(() => null));
    return c.json(
      await marketDetail(
        ctx,
        await adminResolve(ctx, {
          marketId: c.req.param("marketId"),
          outcome: body.outcome,
        }),
      ),
    );
  });

  app.get("/ledger", async (c) => {
    const userId = c.req.query("userId");
    if (!userId) throw new DennisError("validation_error", "userId is required", 400);
    if (!(await ctx.users.get(userId))) throw new DennisError("not_found", "user not found", 404);
    return c.json({
      balance: getBalance(ctx, userId),
      pointsOnly: true,
      entries: ledgerFor(ctx, userId),
    });
  });

  app.get("/leaderboard", async (c) => {
    const accounts = ctx.db.select().from(pointsAccounts).all();
    const grants = new Map(
      ctx.db
        .select({
          userId: pointsLedger.userId,
          total: sql<number>`sum(${pointsLedger.delta})`,
        })
        .from(pointsLedger)
        .where(eq(pointsLedger.kind, "grant"))
        .groupBy(pointsLedger.userId)
        .all()
        .map((r) => [r.userId, Number(r.total)]),
    );
    const rows = [];
    for (const a of accounts) {
      const u = await ctx.users.get(a.userId);
      rows.push({
        firstName: u?.firstName ?? "unknown",
        balance: a.balance,
        delta: a.balance - (grants.get(a.userId) ?? GATES.starterPoints),
      });
    }
    rows.sort((x, y) => y.balance - x.balance || x.firstName.localeCompare(y.firstName));
    return c.json(rows);
  });

  app.get("/invariants", async (c) => {
    requireAdmin(c);
    const checks = await checkLedgerInvariants(ctx);
    return c.json({ ok: checks.every((k) => k.ok), checks });
  });

  return app;
}

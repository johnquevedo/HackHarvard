import { DennisError } from "@dennis/contracts";
import {
  marketInvites,
  marketParticipants,
  marketPositions,
  marketResolutions,
  markets,
  pointsAccounts,
  pointsLedger,
} from "@dennis/db";
import type { FeatureModule, PlatformContext } from "@dennis/platform";
import { registerPrivacyCleanup } from "@dennis/platform";
import { eq } from "drizzle-orm";
import { MockStructuredLlm } from "@dennis/llm";
import { milestoneDetector } from "./detector/index";
import { grantAllUsers } from "./ledger/ledger";
import { backFadeHandler, passHandler } from "./markets/positions";
import {
  handleMilestoneDetection,
  onInviteResponse,
  onMarketInvite,
  onPublishDecided,
  onShortmeConsentRevoked,
  sweep,
} from "./markets/service";
import { onConfirmDecided } from "./resolution/service";
import { shortmeRoutes } from "./routes";
import { ensureShortmeSchema } from "./schema";
import { reportChalkStatus } from "./chalk-status";

const SWEEP_MS = 30_000;
const timers = new WeakMap<PlatformContext, NodeJS.Timeout>();

export const shortmeModule: FeatureModule = {
  name: "shortme",

  async register(ctx: PlatformContext): Promise<void> {
    ensureShortmeSchema(ctx);
    registerPrivacyCleanup(ctx, (userId) => {
      ctx.db
        .update(markets)
        .set({ sourceIntentId: null })
        .where(eq(markets.subjectUserId, userId))
        .run();
    });
    ctx.detectors.register(milestoneDetector);
    ctx.detectors.onDetection("milestone", async (input) => {
      await handleMilestoneDetection(ctx, input);
    });
    ctx.a2a.on("market.invite", async (msg) => onMarketInvite(ctx, msg));
    ctx.a2a.on("market.invite_response", async (msg) => onInviteResponse(ctx, msg));
    ctx.approvals.onDecided("publish_market", async (approval) => onPublishDecided(ctx, approval));
    ctx.approvals.onDecided("confirm_resolution", async (approval) =>
      onConfirmDecided(ctx, approval),
    );
    ctx.consent.onRevoked(async (userId, scope) => onShortmeConsentRevoked(ctx, userId, scope));
    ctx.commands.register("back", backFadeHandler(ctx, "back"));
    ctx.commands.register("fade", backFadeHandler(ctx, "fade"));
    ctx.commands.register("pass", passHandler(ctx));
    if (ctx.llm instanceof MockStructuredLlm)
      ctx.log.info("shortme.llm", { provider: "mock", label: "SIMULATED LLM" });
    if (!timers.has(ctx) && ctx.config.nodeEnv !== "test") {
      reportChalkStatus(ctx);
      const t = setInterval(() => {
        reportChalkStatus(ctx);
        void sweep(ctx).catch((err) =>
          ctx.log.warn("shortme.sweep_failed", { message: String(err) }),
        );
      }, SWEEP_MS);
      t.unref();
      timers.set(ctx, t);
    }
  },

  routes(ctx: PlatformContext) {
    return shortmeRoutes(ctx);
  },

  // Idempotent: starter points for every user that has no grant yet.
  async seed(ctx: PlatformContext): Promise<void> {
    ensureShortmeSchema(ctx);
    const granted = grantAllUsers(ctx);
    ctx.log.info("shortme.seed", { granted });
  },

  // Deletes only ShortMe rows, then re-grants starter points (Section 17.3 step 5).
  async reset(ctx: PlatformContext): Promise<void> {
    ensureShortmeSchema(ctx);
    ctx.db.transaction((tx) => {
      tx.delete(marketResolutions).run();
      tx.delete(marketInvites).run();
      tx.delete(marketPositions).run();
      tx.delete(marketParticipants).run();
      tx.delete(pointsLedger).run();
      tx.delete(pointsAccounts).run();
      tx.delete(markets).run();
    });
    grantAllUsers(ctx);
  },

  async recover(ctx: PlatformContext): Promise<void> {
    try {
      await sweep(ctx);
    } catch (err) {
      if (!(err instanceof DennisError)) throw err;
      ctx.log.warn("shortme.recover", { message: err.message });
    }
  },
};

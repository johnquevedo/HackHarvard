import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { MockStructuredLlm } from "../llm/src/index.ts";
import { purchasingModule } from "../purchasing/src/index.ts";
import { shortmeModule } from "../shortme/src/index.ts";
import { createTestPlatform } from "./src/testing.ts";
import type { PlatformContext } from "./src/context.ts";
import { drainPlatform, ingestInbound } from "./src/index.ts";
export async function rehearsePurchasing(onSettled?: (ctx: PlatformContext) => Promise<void>) {
  const llm = new MockStructuredLlm([
    {
      task: "purchase_detector_v1",
      respond: () => ({
        isPurchaseIntent: true,
        subjectOwned: true,
        category: "monitor",
        productText: "27 inch 4K monitor",
        productKeyCandidate: "monitor 27 inch 4k",
        quantity: 1,
        budgetMaxCents: 35000,
        timeframeKind: "this_month",
        statedCertainty: "considering",
        sensitive: false,
        confidence: 0.95,
        rationale: "Synthetic extraction for integration rehearsal",
      }),
    },
  ]);
  const ctx = await createTestPlatform({ llm });
  let n = 0;
  async function say(name: "alice" | "bob", text: string, id = "rehearsal-" + ++n) {
    const result = await ingestInbound(ctx, {
      provider: "sim",
      accountKey: "primary",
      providerMessageId: id,
      providerSpaceId: null,
      providerSenderId: null,
      senderHandle: name === "alice" ? ctx.config.demoAliceHandle : ctx.config.demoBobHandle,
      text,
      receivedAt: ctx.clock.nowIso(),
      mode: "simulated",
    });
    await new Promise((resolve) => setImmediate(resolve));
    await drainPlatform(ctx);
    return result;
  }
  function attempts() {
    return ctx.db.$client
      .prepare("SELECT status,provider,amount_cents FROM payment_attempts")
      .all();
  }
  try {
    await purchasingModule.register(ctx);
    await purchasingModule.seed(ctx);
    await shortmeModule.register(ctx);
    await shortmeModule.seed(ctx);
    await say("alice", "I want a 27 inch 4K monitor this month for up to $350.");
    await say("bob", "I want a 27 inch 4K monitor this month for up to $350.");
    assert.equal(
      (
        ctx.db.$client.prepare("SELECT count(*) AS count FROM group_purchases").get() as {
          count: number;
        }
      ).count,
      1,
      "The two-agent flow must create one group; the foundation stub cannot pass",
    );
    assert.equal(attempts().length, 0, "No transfer before approvals");
    for (const kind of ["join_group_purchase", "authorize_payment"] as const) {
      for (const name of ["alice", "bob"] as const) {
        const pending = (await ctx.approvals.findPending("usr_demo_" + name, null)).filter(
          (a) => a.kind === kind,
        );
        assert.equal(pending.length, 1, "Exactly one matching approval per member");
        const id = "rehearsal-reply-" + kind + ":" + name;
        await say(name, "YES " + pending[0]!.shortCode, id);
        assert.equal((await say(name, "YES " + pending[0]!.shortCode, id)).outcome, "replay");
        if (kind === "join_group_purchase" || name === "alice") assert.equal(attempts().length, 0);
      }
    }
    assert.deepEqual(attempts(), [
      { status: "verified", provider: "sim", amount_cents: 28499 },
      { status: "verified", provider: "sim", amount_cents: 28499 },
    ]);
    assert.equal(
      (ctx.db.$client.prepare("SELECT status FROM group_purchases").get() as { status: string })
        .status,
      "settled",
    );
    await say("alice", "YES");
    await say("bob", "YES");
    assert.equal(attempts().length, 2, "Extra approval replies cannot duplicate a transfer");
    const encoded = JSON.stringify(
      ctx.events.history({ judge: true, limit: 200 }).filter((e) => e.visibility === "shared"),
    );
    for (const secret of [
      ctx.config.demoAliceHandle,
      ctx.config.demoBobHandle,
      '"privatePayload"',
      '"sourceExcerpt"',
      "for up to $350",
    ])
      assert.equal(encoded.includes(secret), false, "Shared output must remain minimal");
    await onSettled?.(ctx);
    return {
      mode: "simulated",
      status: "settled",
      members: 2,
      payments: 2,
      amountPerMemberCents: 28499,
      replaySafe: true,
      sharedPrivacyScan: "passed",
      liveProviderVerified: false,
    };
  } finally {
    await drainPlatform(ctx);
    ctx.db.$client.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(await rehearsePurchasing(), null, 2) + "\n");
}

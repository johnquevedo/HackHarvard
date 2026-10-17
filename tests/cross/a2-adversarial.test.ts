import { PurchaseIntentPublic, type InboundMessageT } from "@dennis/contracts";
import { MockStructuredLlm } from "@dennis/llm";
import { drainPlatform, ingestInbound, type PlatformContext } from "@dennis/platform";
import { createTestPlatform } from "@dennis/platform/testing";
import { describe, expect, it } from "vitest";

import {
  transitionGroup,
  type GroupStatus,
} from "../../packages/purchasing/src/groups/state-machine.js";
import { purchasingModule } from "../../packages/purchasing/src/module.js";

let messageSequence = 0;

function purchaseLlm(): MockStructuredLlm {
  return new MockStructuredLlm([
    {
      task: "purchase_detector_v1",
      respond: () => ({
        isPurchaseIntent: true,
        subjectOwned: true,
        category: "monitor",
        productText: "27 inch 4K monitor",
        productKeyCandidate: "monitor 27 inch 4k",
        quantity: 1,
        budgetMaxCents: 35_000,
        timeframeKind: "unspecified",
        statedCertainty: "considering",
        sensitive: false,
        confidence: 0.9,
        rationale: "The user is considering a monitor purchase.",
      }),
    },
  ]);
}

async function say(ctx: PlatformContext, who: "alice" | "bob", text: string): Promise<void> {
  await ingestInbound(ctx, {
    provider: "sim",
    accountKey: "primary",
    providerMessageId: `a2_sim_${++messageSequence}`,
    providerSpaceId: null,
    providerSenderId: null,
    senderHandle: who === "alice" ? ctx.config.demoAliceHandle : ctx.config.demoBobHandle,
    text,
    receivedAt: ctx.clock.nowIso(),
    mode: "simulated",
  });
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    await drainPlatform(ctx);
  }
}

function pendingCode(ctx: PlatformContext, userId: string, kind: string): string {
  const row = ctx.db.$client
    .prepare(
      "SELECT short_code FROM approvals WHERE user_id=? AND kind=? AND status='pending' ORDER BY created_at DESC LIMIT 1",
    )
    .get(userId, kind) as { short_code: string } | undefined;
  if (!row) throw new Error(`Missing ${kind} approval for ${userId}`);
  return row.short_code;
}

describe("A2 adversarial contracts", () => {
  it("rejects a public intent carrying raw text or a phone number field", () => {
    const parsed = PurchaseIntentPublic.safeParse({
      category: "monitor",
      productKey: "monitor_4k",
      quantity: 1,
      budgetBandMaxCents: 35_000,
      window: { from: "2026-10-17", to: "2026-10-18" },
      regionCode: "boston-cambridge",
      rawText: "Call 617-555-0199",
    });
    expect(parsed.success).toBe(false);
  });

  it.each([
    "proposed",
    "awaiting_join_approvals",
    "confirmed",
    "awaiting_payment_approvals",
    "ready_to_settle",
  ] as GroupStatus[])("cancels %s when consent is revoked before settlement", (status) => {
    expect(transitionGroup(status, "consent_revoked")).toBe("cancelled");
  });

  it("refuses revocation cancellation after settlement starts", () => {
    expect(() => transitionGroup("settling", "consent_revoked")).toThrow(
      "Invalid group transition",
    );
  });

  it("detects a purchase through the real pipeline when its category list is empty", async () => {
    const ctx = await createTestPlatform({ llm: purchaseLlm() });
    await purchasingModule.register(ctx);
    await purchasingModule.seed(ctx);
    const inbound: InboundMessageT = {
      provider: "sim",
      accountKey: "primary",
      providerMessageId: "a2_empty_categories",
      providerSpaceId: null,
      providerSenderId: null,
      senderHandle: ctx.config.demoAliceHandle,
      text: "I want a 27 inch 4K monitor for up to $350.",
      receivedAt: ctx.clock.nowIso(),
      mode: "simulated",
    };

    await ingestInbound(ctx, inbound);
    for (let i = 0; i < 6; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      await drainPlatform(ctx);
    }

    const intent = ctx.db.$client
      .prepare("SELECT kind, status FROM intents WHERE user_id=? ORDER BY created_at DESC LIMIT 1")
      .get("usr_demo_alice") as { kind: string; status: string } | undefined;
    expect(intent).toMatchObject({ kind: "purchase", status: "shared" });
  });

  it("settles the two-user purchase story through approvals and simulated transfers", async () => {
    const ctx = await createTestPlatform({ llm: purchaseLlm() });
    await purchasingModule.register(ctx);
    await purchasingModule.seed(ctx);

    await say(ctx, "alice", "I want a 27 inch 4K monitor for up to $350.");
    await say(ctx, "bob", "I also want a 27 inch 4K monitor for up to $350.");

    const proposed = ctx.db.$client
      .prepare("SELECT id, status FROM group_purchases ORDER BY created_at DESC LIMIT 1")
      .get() as { id: string; status: string } | undefined;
    expect(proposed?.status).toBe("awaiting_join_approvals");

    const sharedBeforeJoin = JSON.stringify(
      ctx.events
        .history({ judge: true, limit: 10_000 })
        .filter((event) => event.visibility === "shared"),
    );
    expect(sharedBeforeJoin).not.toContain("Alice");
    expect(sharedBeforeJoin).not.toContain("Bob");

    await say(ctx, "alice", `YES ${pendingCode(ctx, "usr_demo_alice", "join_group_purchase")}`);
    await say(ctx, "bob", `YES ${pendingCode(ctx, "usr_demo_bob", "join_group_purchase")}`);

    const awaitingPayment = ctx.db.$client
      .prepare("SELECT status FROM group_purchases WHERE id=?")
      .get(proposed!.id) as { status: string };
    expect(awaitingPayment.status).toBe("awaiting_payment_approvals");

    await say(ctx, "alice", `YES ${pendingCode(ctx, "usr_demo_alice", "authorize_payment")}`);
    await say(ctx, "bob", `YES ${pendingCode(ctx, "usr_demo_bob", "authorize_payment")}`);

    const settled = ctx.db.$client
      .prepare("SELECT status FROM group_purchases WHERE id=?")
      .get(proposed!.id) as { status: string };
    expect(settled.status).toBe("settled");
    const payments = ctx.db.$client
      .prepare(
        "SELECT status, provider, provider_transfer_id FROM payment_attempts WHERE group_id=? ORDER BY user_id",
      )
      .all(proposed!.id) as {
      status: string;
      provider: string;
      provider_transfer_id: string;
    }[];
    expect(payments).toHaveLength(2);
    expect(payments.every((payment) => payment.status === "verified")).toBe(true);
    expect(payments.every((payment) => payment.provider === "sim")).toBe(true);
    expect(payments.every((payment) => payment.provider_transfer_id.startsWith("sim_tx_"))).toBe(
      true,
    );

    const balanceResponse = await purchasingModule.routes(ctx).request("/bank/accounts");
    const balances = (await balanceResponse.json()) as {
      mode: string;
      accounts: { ownerKey: string; balanceCents: number }[];
    };
    expect(balances).toMatchObject({ mode: "simulated" });
    expect(balances.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerKey: "usr_demo_alice", balanceCents: 121_501 }),
        expect.objectContaining({ ownerKey: "usr_demo_bob", balanceCents: 91_501 }),
        expect.objectContaining({ ownerKey: "pool", balanceCents: 56_998 }),
      ]),
    );
  });
});

import { expect, it } from "vitest";
import { createTestPlatform } from "@dennis/platform/testing";
import { drainPlatform, ingestInbound } from "@dennis/platform";
import { purchasingModule } from "@dennis/purchasing";

it("seeds the outside friend and matches isaac's scripted monitor line", async () => {
  const ctx = await createTestPlatform({ config: { demoScenario: "group" } });
  await purchasingModule.register(ctx);
  await purchasingModule.seed(ctx);

  await ingestInbound(ctx, {
    provider: "sim",
    accountKey: "primary",
    providerMessageId: "group_demo_isaac_monitor",
    providerSpaceId: "demo_group",
    providerSpaceKind: "group",
    providerParticipantIds: ["john", "steven", "isaac"],
    providerParticipantHandles: [
      ctx.config.demoJohnHandle,
      ctx.config.demoStevenHandle,
      ctx.config.demoIsaacHandle,
    ],
    providerSenderId: "isaac",
    senderHandle: ctx.config.demoIsaacHandle,
    text: "also anyone tryna buy a monitor? mine's cooked",
    receivedAt: ctx.clock.nowIso(),
    mode: "simulated",
  });
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    await drainPlatform(ctx);
  }

  const group = ctx.db.$client
    .prepare("SELECT id,status FROM group_purchases ORDER BY created_at DESC LIMIT 1")
    .get() as { id: string; status: string } | undefined;
  expect(group?.status).toBe("awaiting_join_approvals");
  const members = ctx.db.$client
    .prepare("SELECT user_id FROM group_purchase_members WHERE group_id=? ORDER BY user_id")
    .all(group!.id) as { user_id: string }[];
  expect(members.map((member) => member.user_id)).toEqual(["usr_demo_friend", "usr_demo_isaac"]);
});

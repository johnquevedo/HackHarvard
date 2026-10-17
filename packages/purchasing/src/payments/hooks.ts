import type { ApprovalT } from "@dennis/contracts";
import { bankLinks, groupPurchaseMembers, groupPurchases } from "@dennis/db";
import type { PlatformContext } from "@dennis/platform";
import { and, eq, inArray } from "drizzle-orm";

import { emitGroupUpdated, setGroupStatus } from "../groups/service.js";
import { executeApprovedPayment } from "./executor.js";

export async function handlePaymentDecision(
  ctx: PlatformContext,
  approval: ApprovalT,
): Promise<void> {
  const member = ctx.db
    .select()
    .from(groupPurchaseMembers)
    .where(eq(groupPurchaseMembers.payApprovalId, approval.id))
    .get();
  if (!member) return;
  const group = ctx.db
    .select()
    .from(groupPurchases)
    .where(eq(groupPurchases.id, member.groupId))
    .get();
  if (!group || group.status !== "awaiting_payment_approvals") return;

  if (approval.status === "declined" || approval.status === "expired") {
    ctx.db
      .update(groupPurchaseMembers)
      .set({ payState: "failed" })
      .where(
        and(
          eq(groupPurchaseMembers.groupId, member.groupId),
          eq(groupPurchaseMembers.userId, member.userId),
        ),
      )
      .run();
    setGroupStatus(
      ctx,
      member.groupId,
      approval.status === "expired" ? "expired" : "cancelled",
      `payment approval ${approval.status}`,
    );
    await emitGroupUpdated(ctx, member.groupId);
    return;
  }
  if (approval.status !== "approved") return;

  ctx.db
    .update(groupPurchaseMembers)
    .set({ payState: "authorized" })
    .where(
      and(
        eq(groupPurchaseMembers.groupId, member.groupId),
        eq(groupPurchaseMembers.userId, member.userId),
      ),
    )
    .run();
  const members = ctx.db
    .select()
    .from(groupPurchaseMembers)
    .where(eq(groupPurchaseMembers.groupId, member.groupId))
    .all();
  if (!members.every((item) => item.payState === "authorized")) {
    await emitGroupUpdated(ctx, member.groupId);
    return;
  }

  for (const item of members) {
    if (!(await ctx.consent.has(item.userId, "sandbox_payments"))) {
      setGroupStatus(ctx, member.groupId, "cancelled", "sandbox_payments consent missing");
      await emitGroupUpdated(ctx, member.groupId);
      return;
    }
  }
  const requiredLinks = ctx.db
    .select()
    .from(bankLinks)
    .where(inArray(bankLinks.linkKey, [...members.map((item) => item.userId), "pool"]))
    .all();
  if (
    !requiredLinks.some((link) => link.linkKey === "pool" && link.role === "pool") ||
    members.some(
      (item) =>
        !requiredLinks.some(
          (link) => link.linkKey === item.userId && link.role === "member",
        ),
    )
  ) {
    setGroupStatus(ctx, member.groupId, "cancelled", "bank allowlist incomplete");
    await emitGroupUpdated(ctx, member.groupId);
    return;
  }
  setGroupStatus(ctx, member.groupId, "ready_to_settle");
  await emitGroupUpdated(ctx, member.groupId);
  for (const item of members) {
    if (!item.payApprovalId) throw new Error("Authorized member has no payment approval");
    await executeApprovedPayment(ctx, item.payApprovalId);
  }
}

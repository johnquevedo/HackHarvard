import { createHash } from "node:crypto";

import {
  DennisError,
  hashPayload,
  type ApprovalService,
  type BankTransferRecord,
  type PaymentAttemptT,
} from "@dennis/contracts";
import {
  bankLinks,
  groupPurchaseMembers,
  groupPurchases,
  paymentAttempts,
} from "@dennis/db";
import type { PlatformContext } from "@dennis/platform";
import { and, eq, inArray } from "drizzle-orm";

import { createBankingProvider } from "../bank/factory.js";
import { paymentResultCopy } from "../copy.js";
import { emitGroupUpdated, setGroupStatus } from "../groups/service.js";
import { verifyTransfer, type BalanceSnapshot } from "./verification.js";

interface PaymentApprovalPayload {
  groupId: string;
  userId: string;
  amountCents: number;
  fromAccountRef: string;
  toAccountRef: string;
  productKey: string;
}

interface TransactionalApprovalService extends ApprovalService {
  consumeInTransaction(approvalId: string, tx: unknown): void;
}

function payloadFrom(value: Record<string, unknown>): PaymentApprovalPayload {
  const string = (field: string) => {
    const item = value[field];
    if (typeof item !== "string" || item.length === 0) {
      throw new DennisError("approval_invalid", `Payment approval ${field} is invalid`, 409);
    }
    return item;
  };
  const amountCents = value.amountCents;
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0) {
    throw new DennisError("approval_invalid", "Payment approval amountCents is invalid", 409);
  }
  return {
    groupId: string("groupId"),
    userId: string("userId"),
    amountCents,
    fromAccountRef: string("fromAccountRef"),
    toAccountRef: string("toAccountRef"),
    productKey: string("productKey"),
  };
}

function transactionalApprovals(ctx: PlatformContext): TransactionalApprovalService {
  const service = ctx.approvals as ApprovalService & Partial<TransactionalApprovalService>;
  if (typeof service.consumeInTransaction !== "function") {
    throw new DennisError(
      "internal",
      "Payment execution requires ApprovalService.consumeInTransaction from CR-A2-001",
      500,
    );
  }
  return service as TransactionalApprovalService;
}

function attemptIdempotencyKey(payload: PaymentApprovalPayload, approvalId: string): string {
  return createHash("sha256")
    .update(`${payload.groupId}${payload.userId}${approvalId}`)
    .digest("hex");
}

function attemptRow(ctx: PlatformContext, attemptId: string): PaymentAttemptT {
  const row = ctx.db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).get();
  if (!row) throw new Error(`Payment attempt ${attemptId} disappeared`);
  return row as PaymentAttemptT;
}

async function readBalances(
  provider: ReturnType<typeof createBankingProvider>,
  payload: PaymentApprovalPayload,
): Promise<BalanceSnapshot> {
  const [from, to] = await Promise.all([
    provider.getBalance(payload.fromAccountRef),
    provider.getBalance(payload.toAccountRef),
  ]);
  return { fromCents: from.balanceCents, toCents: to.balanceCents };
}

async function emitPayment(
  ctx: PlatformContext,
  attempt: PaymentAttemptT,
  mode: "live" | "simulated",
): Promise<void> {
  const agent = await ctx.users.getAgentByUserId(attempt.userId);
  ctx.events.emit({
    type: "purchase.payment.updated",
    actor: {
      kind: "agent",
      userId: attempt.userId,
      ...(agent ? { agentId: agent.id } : {}),
    },
    visibility: "private",
    opportunityId: groupRow(ctx, attempt.groupId)?.opportunityId,
    mode,
    payload: {
      attemptId: attempt.id,
      groupId: attempt.groupId,
      userId: attempt.userId,
      status: attempt.status,
      amountCents: attempt.amountCents,
      ...(attempt.providerTransferId ? { providerTransferId: attempt.providerTransferId } : {}),
      ...(attempt.balancesBefore ? { balancesBefore: attempt.balancesBefore } : {}),
      ...(attempt.balancesAfter ? { balancesAfter: attempt.balancesAfter } : {}),
      ...(attempt.verificationNote ? { note: attempt.verificationNote } : {}),
      mode,
    },
  });
}

function groupRow(ctx: PlatformContext, groupId: string) {
  return ctx.db.select().from(groupPurchases).where(eq(groupPurchases.id, groupId)).get();
}

async function markFailed(
  ctx: PlatformContext,
  attemptId: string,
  groupId: string,
  userId: string,
  error: string,
  mode: "live" | "simulated",
): Promise<PaymentAttemptT> {
  ctx.db
    .update(paymentAttempts)
    .set({ status: "failed", error, updatedAt: ctx.clock.nowIso() })
    .where(eq(paymentAttempts.id, attemptId))
    .run();
  ctx.db
    .update(groupPurchaseMembers)
    .set({ payState: "failed" })
    .where(
      and(
        eq(groupPurchaseMembers.groupId, groupId),
        eq(groupPurchaseMembers.userId, userId),
      ),
    )
    .run();
  setGroupStatus(ctx, groupId, "failed", error);
  const attempt = attemptRow(ctx, attemptId);
  await emitPayment(ctx, attempt, mode);
  await emitGroupUpdated(ctx, groupId);
  return attempt;
}

async function notifyResult(
  ctx: PlatformContext,
  attempt: PaymentAttemptT,
  balanceCents: number,
): Promise<void> {
  const user = await ctx.users.get(attempt.userId);
  if (!user) throw new Error(`Unknown user ${attempt.userId}`);
  await ctx.notifier.send({
    userId: attempt.userId,
    kind: "result",
    text: paymentResultCopy({
      first: user.firstName,
      amountCents: attempt.amountCents,
      verified: attempt.status === "verified",
      shortRef: attempt.providerTransferId?.slice(-8) ?? attempt.id.slice(-8),
      balanceCents,
    }),
    opportunityId: groupRow(ctx, attempt.groupId)?.opportunityId,
    idempotencyKey: `purchase:payment-result:${attempt.id}:${attempt.status}`,
  });
}

async function verifyAndFinalize(
  ctx: PlatformContext,
  attemptId: string,
  payload: PaymentApprovalPayload,
  providerTransfer: BankTransferRecord,
  before: BalanceSnapshot,
): Promise<PaymentAttemptT> {
  const provider = createBankingProvider(ctx.config, { db: ctx.db, clock: ctx.clock, log: ctx.log });
  const readBack = await provider.getTransfer(providerTransfer.providerTransferId);
  const after = await readBalances(provider, payload);
  const verification = verifyTransfer({
    expectedAmountCents: payload.amountCents,
    expectedToAccountRef: payload.toAccountRef,
    transfer: readBack,
    before,
    after,
  });
  const status = verification.verified ? "verified" : "unverified";
  ctx.db
    .update(paymentAttempts)
    .set({
      status,
      providerTransferId: providerTransfer.providerTransferId,
      responseJson: providerTransfer.raw,
      balancesAfter: after,
      verificationNote: verification.note,
      updatedAt: ctx.clock.nowIso(),
    })
    .where(eq(paymentAttempts.id, attemptId))
    .run();
  ctx.db
    .update(groupPurchaseMembers)
    .set({ payState: "settled" })
    .where(
      and(
        eq(groupPurchaseMembers.groupId, payload.groupId),
        eq(groupPurchaseMembers.userId, payload.userId),
      ),
    )
    .run();
  const attempt = attemptRow(ctx, attemptId);
  const mode = provider.name === "nessie" ? "live" : "simulated";
  await emitPayment(ctx, attempt, mode);
  await notifyResult(ctx, attempt, after.fromCents);
  const members = ctx.db
    .select()
    .from(groupPurchaseMembers)
    .where(eq(groupPurchaseMembers.groupId, payload.groupId))
    .all();
  if (members.every((member) => member.payState === "settled")) {
    setGroupStatus(ctx, payload.groupId, "settled");
  }
  await emitGroupUpdated(ctx, payload.groupId);
  return attempt;
}

export async function executeApprovedPayment(
  ctx: PlatformContext,
  approvalId: string,
): Promise<PaymentAttemptT> {
  const previewApproval = await ctx.approvals.get(approvalId);
  if (!previewApproval) throw new DennisError("approval_invalid", "Payment approval not found", 409);
  const previewPayload = payloadFrom(previewApproval.payload);
  return ctx.runExclusive(`payment:${previewPayload.groupId}`, async () => {
    const approval = await ctx.approvals.get(approvalId);
    if (!approval) throw new DennisError("approval_invalid", "Payment approval not found", 409);
    const payload = payloadFrom(approval.payload);
    if (payload.groupId !== previewPayload.groupId) {
      throw new DennisError("approval_invalid", "Payment approval group changed", 409);
    }
    await ctx.approvals.assertApproved({
      approvalId,
      userId: payload.userId,
      kind: "authorize_payment",
      payloadHash: hashPayload(approval.payload),
    });

    await ctx.consent.require(payload.userId, "sandbox_payments");

    const links = ctx.db
      .select()
      .from(bankLinks)
      .where(inArray(bankLinks.accountRef, [payload.fromAccountRef, payload.toAccountRef]))
      .all();
    const payerLink = links.find(
      (link) => link.accountRef === payload.fromAccountRef && link.linkKey === payload.userId && link.role === "member",
    );
    const poolLink = links.find(
      (link) => link.accountRef === payload.toAccountRef && link.linkKey === "pool" && link.role === "pool",
    );
    if (!payerLink || !poolLink) {
      throw new DennisError("approval_invalid", "Payment accounts are not in the bank allowlist", 409);
    }

    if (payload.amountCents > ctx.config.nessieMaxTransferCents) {
      throw new DennisError("approval_invalid", "Payment exceeds NESSIE_MAX_TRANSFER_CENTS", 409);
    }

    const provider = createBankingProvider(ctx.config, { db: ctx.db, clock: ctx.clock, log: ctx.log });
    if (payerLink.provider !== provider.name || poolLink.provider !== provider.name) {
      throw new DennisError("approval_invalid", "Payment accounts do not belong to the active provider", 409);
    }
    const before = await readBalances(provider, payload);
    const hasFunds = before.fromCents >= payload.amountCents;

    const group = groupRow(ctx, payload.groupId);
    if (!group || (group.status !== "ready_to_settle" && group.status !== "settling")) {
      throw new DennisError("invalid_state", "Group is not ready to settle", 409);
    }
    const member = ctx.db
      .select()
      .from(groupPurchaseMembers)
      .where(
        and(
          eq(groupPurchaseMembers.groupId, payload.groupId),
          eq(groupPurchaseMembers.userId, payload.userId),
        ),
      )
      .get();
    if (!member || member.shareCents !== payload.amountCents) {
      throw new DennisError("approval_invalid", "Payment amount does not match the group share", 409);
    }

    const idempotencyKey = attemptIdempotencyKey(payload, approvalId);
    const existing = ctx.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.idempotencyKey, idempotencyKey))
      .get();
    if (existing) return existing as PaymentAttemptT;

    const attemptId = ctx.ids.next("payment");
    const approvals = transactionalApprovals(ctx);
    ctx.db.transaction((tx) => {
      approvals.consumeInTransaction(approvalId, tx);
      tx.insert(paymentAttempts)
        .values({
          id: attemptId,
          groupId: payload.groupId,
          userId: payload.userId,
          approvalId,
          idempotencyKey,
          fromAccountRef: payload.fromAccountRef,
          toAccountRef: payload.toAccountRef,
          amountCents: payload.amountCents,
          status: hasFunds ? "created" : "failed",
          provider: provider.name,
          providerTransferId: null,
          requestJson: {
            fromAccountRef: payload.fromAccountRef,
            toAccountRef: payload.toAccountRef,
            amountCents: payload.amountCents,
            memo: `dennis:${idempotencyKey}`,
          },
          responseJson: null,
          balancesBefore: before,
          balancesAfter: null,
          verificationNote: null,
          error: hasFunds ? null : "insufficient_funds",
          createdAt: ctx.clock.nowIso(),
          updatedAt: ctx.clock.nowIso(),
        })
        .run();
    });
    const mode = provider.name === "nessie" ? "live" : "simulated";
    if (!hasFunds) {
      return markFailed(
        ctx,
        attemptId,
        payload.groupId,
        payload.userId,
        "insufficient_funds",
        mode,
      );
    }

    if (group.status === "ready_to_settle") {
      setGroupStatus(ctx, payload.groupId, "settling");
      await emitGroupUpdated(ctx, payload.groupId);
    }
    ctx.db
      .update(groupPurchaseMembers)
      .set({ payState: "settling" })
      .where(
        and(
          eq(groupPurchaseMembers.groupId, payload.groupId),
          eq(groupPurchaseMembers.userId, payload.userId),
        ),
      )
      .run();
    ctx.db
      .update(paymentAttempts)
      .set({ status: "submitting", updatedAt: ctx.clock.nowIso() })
      .where(eq(paymentAttempts.id, attemptId))
      .run();

    const memo = `dennis:${idempotencyKey}`;
    let record: BankTransferRecord | null = null;
    try {
      const result = await provider.transfer({
        fromAccountRef: payload.fromAccountRef,
        toAccountRef: payload.toAccountRef,
        amountCents: payload.amountCents,
        memo,
      });
      record = result.record;
    } catch (error) {
      const matches = await provider.findTransfersByMemo(payload.fromAccountRef, idempotencyKey);
      record = matches.find(
        (item) =>
          item.toAccountRef === payload.toAccountRef && item.amountCents === payload.amountCents,
      ) ?? null;
      if (!record) {
        return markFailed(
          ctx,
          attemptId,
          payload.groupId,
          payload.userId,
          error instanceof Error ? error.message : "provider_transfer_failed",
          mode,
        );
      }
    }
    ctx.db
      .update(paymentAttempts)
      .set({
        status: "submitted",
        providerTransferId: record.providerTransferId,
        responseJson: record.raw,
        updatedAt: ctx.clock.nowIso(),
      })
      .where(eq(paymentAttempts.id, attemptId))
      .run();
    return verifyAndFinalize(ctx, attemptId, payload, record, before);
  });
}

export async function recoverSubmittingPayments(ctx: PlatformContext): Promise<void> {
  const provider = createBankingProvider(ctx.config, { db: ctx.db, clock: ctx.clock, log: ctx.log });
  const pending = ctx.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.status, "submitting"))
    .all();
  for (const attempt of pending) {
    const matches = await provider.findTransfersByMemo(attempt.fromAccountRef, attempt.idempotencyKey);
    const record = matches.find(
      (item) => item.toAccountRef === attempt.toAccountRef && item.amountCents === attempt.amountCents,
    );
    const mode = provider.name === "nessie" ? "live" : "simulated";
    if (!record || !attempt.balancesBefore) {
      await markFailed(
        ctx,
        attempt.id,
        attempt.groupId,
        attempt.userId,
        "recovery_transfer_not_found",
        mode,
      );
      continue;
    }
    await verifyAndFinalize(
      ctx,
      attempt.id,
      {
        groupId: attempt.groupId,
        userId: attempt.userId,
        amountCents: attempt.amountCents,
        fromAccountRef: attempt.fromAccountRef,
        toAccountRef: attempt.toAccountRef,
        productKey: groupRow(ctx, attempt.groupId)?.productKey ?? "unknown",
      },
      record,
      attempt.balancesBefore as BalanceSnapshot,
    );
  }
}

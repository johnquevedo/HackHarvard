import { approvals as approvalTable } from "@dennis/db";
import type { DbTransaction } from "@dennis/db";
import { and, eq, isNull, gt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { Approval, OutboxRecord, DennisError, hashPayload } from "@dennis/contracts";
import type {
  ApprovalService,
  ApprovalDecidedHandler,
  ApprovalT,
  Notifier,
  NotifyRequest,
  OutboxRecordT,
} from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { insert, row, rows, update } from "./storage.ts";
function persistNotification(
  ctx: PlatformContext,
  req: NotifyRequest,
): { record: OutboxRecordT; created: boolean } {
  const previous = row<OutboxRecordT>(
    ctx.db,
    "SELECT * FROM outbox WHERE idempotency_key=?",
    req.idempotencyKey,
  );
  if (previous) {
    const savedRoute = row<{ value: string }>(
      ctx.db,
      "SELECT value FROM kv WHERE key=?",
      "outbox-route:" + previous.id,
    )?.value;
    if (
      previous.userId !== req.userId ||
      previous.kind !== req.kind ||
      previous.text !== req.text ||
      previous.approvalId !== (req.approvalId ?? null) ||
      previous.opportunityId !== (req.opportunityId ?? null) ||
      (savedRoute ?? null) !== (req.spaceId ?? null)
    )
      throw new DennisError("idempotency_conflict", "Outbox key reused with different input", 409);
    return { record: OutboxRecord.parse(previous), created: false };
  }
  if (!row(ctx.db, "SELECT id FROM users WHERE id=?", req.userId))
    throw new DennisError("not_found", "User not found", 404);
  const record = OutboxRecord.parse({
    ...req,
    id: ctx.ids.next("outbox"),
    approvalId: req.approvalId ?? null,
    opportunityId: req.opportunityId ?? null,
    status: "queued",
    provider: null,
    providerMessageId: null,
    providerStatus: null,
    attempts: 0,
    lastError: null,
    createdAt: ctx.clock.nowIso(),
    sentAt: null,
    deliveredAt: null,
  });
  insert(ctx.db, "outbox", { ...record, idempotencyKey: req.idempotencyKey });
  if (req.spaceId) insert(ctx.db, "kv", { key: "outbox-route:" + record.id, value: req.spaceId });
  return { record, created: true };
}
function emitQueued(ctx: PlatformContext, value: OutboxRecordT): void {
  const agent = row<{ id: string }>(ctx.db, "SELECT id FROM agents WHERE user_id=?", value.userId);
  if (agent)
    ctx.events.emit({
      type: "outbox.queued",
      actor: { kind: "agent", agentId: agent.id },
      visibility: "private",
      payload: {
        outboxId: value.id,
        userId: value.userId,
        kind: value.kind,
        preview: value.text,
      },
    });
}
export function createNotifier(ctx: PlatformContext): Notifier {
  return {
    async send(req) {
      return ctx.runExclusive("outbox-key:" + req.idempotencyKey, async () => {
        const result = persistNotification(ctx, req);
        if (result.created) emitQueued(ctx, result.record);
        return result.record;
      });
    },
  };
}
export function createApprovals(ctx: PlatformContext): ApprovalService {
  const hooks = new Map<string, ApprovalDecidedHandler[]>();
  async function get(id: string) {
    const value = row<ApprovalT>(ctx.db, "SELECT * FROM approvals WHERE id=?", id);
    return value ? Approval.parse(value) : null;
  }
  async function required(id: string) {
    const value = await get(id);
    if (!value) throw new DennisError("not_found", "Approval not found", 404);
    return value;
  }
  function emitExpired(a: ApprovalT) {
    ctx.events.emit({
      type: "approval.expired",
      actor: { kind: "agent", agentId: a.agentId },
      visibility: "private",
      payload: { approvalId: a.id, kind: a.kind },
    });
  }
  return {
    get,
    async request(input) {
      return ctx.runExclusive("approval-request:" + input.userId, async () => {
        const existing = row<ApprovalT & { idempotencyKey: string }>(
          ctx.db,
          "SELECT * FROM approvals WHERE idempotency_key=?",
          input.idempotencyKey,
        );
        if (existing) {
          if (
            existing.userId !== input.userId ||
            existing.agentId !== input.agentId ||
            existing.kind !== input.kind ||
            existing.payloadHash !== hashPayload(input.payload) ||
            existing.opportunityId !== (input.opportunityId ?? null) ||
            existing.promptText !== input.promptText.replaceAll("{code}", existing.shortCode)
          )
            throw new DennisError(
              "idempotency_conflict",
              "Approval key reused with different input",
              409,
            );
          return Approval.parse(existing);
        }
        const agent = await ctx.users.getAgent(input.agentId);
        if (agent?.userId !== input.userId)
          throw new DennisError("forbidden", "Approval owner mismatch", 403);
        if (!Number.isFinite(input.ttlMinutes) || input.ttlMinutes <= 0)
          throw new DennisError("validation_error", "Approval requires a positive TTL", 400);
        let code: string;
        do {
          code = randomBytes(2).toString("hex");
        } while (
          row(
            ctx.db,
            "SELECT id FROM approvals WHERE user_id=? AND short_code=? AND status='pending'",
            input.userId,
            code,
          )
        );
        const value = Approval.parse({
          ...input,
          id: ctx.ids.next("approval"),
          shortCode: code,
          status: "pending",
          payloadHash: hashPayload(input.payload),
          promptText: input.promptText.replaceAll("{code}", code),
          opportunityId: input.opportunityId ?? null,
          expiresAt: new Date(ctx.clock.now().getTime() + input.ttlMinutes * 60000).toISOString(),
          createdAt: ctx.clock.nowIso(),
          decidedAt: null,
          decidedVia: null,
          consumedAt: null,
        });
        const notification = ctx.db.$client.transaction(() => {
          insert(ctx.db, "approvals", {
            ...value,
            idempotencyKey: input.idempotencyKey,
          });
          return persistNotification(ctx, {
            userId: input.userId,
            kind: "approval_request",
            text: value.promptText,
            approvalId: value.id,
            ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
            idempotencyKey: "approval:" + value.id,
          });
        })();
        if (notification.created) emitQueued(ctx, notification.record);
        ctx.events.emit({
          type: "approval.requested",
          actor: { kind: "agent", agentId: value.agentId },
          visibility: "private",
          payload: {
            approvalId: value.id,
            kind: value.kind,
            shortCode: code,
            expiresAt: value.expiresAt,
            summary: value.promptText,
          },
        });
        return value;
      });
    },
    async decide(input) {
      return ctx.runExclusive("approval:" + input.approvalId, async () => {
        const a = await required(input.approvalId);
        if (a.userId !== input.userId)
          throw new DennisError("forbidden", "Approval belongs to another user", 403);
        const status = input.decision === "approve" ? "approved" : "declined";
        if (a.status === status) return a;
        if (a.status !== "pending")
          throw new DennisError("approval_invalid", "Approval is already decided", 409);
        if (a.expiresAt <= ctx.clock.nowIso()) {
          const changed = update(
            ctx.db,
            "approvals",
            { status: "expired" },
            "id=? AND status='pending' AND expires_at<=?",
            a.id,
            ctx.clock.nowIso(),
          );
          if (changed === 1) {
            emitExpired(a);
            const expired = await required(a.id);
            for (const handler of hooks.get(a.kind) ?? []) await handler(expired);
          }
          throw new DennisError("approval_invalid", "Approval expired", 409);
        }
        const changed = update(
          ctx.db,
          "approvals",
          { status, decidedAt: ctx.clock.nowIso(), decidedVia: input.via },
          "id=? AND status='pending'",
          a.id,
        );
        if (changed !== 1)
          throw new DennisError(
            "approval_invalid",
            "Approval changed before the decision could be recorded",
            409,
          );
        const decided = await required(a.id);
        ctx.events.emit({
          type: "approval.decided",
          actor: { kind: "user", agentId: a.agentId, userId: a.userId },
          visibility: "private",
          payload: { approvalId: a.id, kind: a.kind, status, via: input.via },
        });
        for (const hook of hooks.get(a.kind) ?? []) await hook(decided);
        return decided;
      });
    },
    async findPending(userId, code) {
      return rows<ApprovalT>(
        ctx.db,
        "SELECT * FROM approvals WHERE user_id=? AND status='pending' AND expires_at>? AND (? IS NULL OR short_code=?) ORDER BY created_at",
        userId,
        ctx.clock.nowIso(),
        code?.toLowerCase() ?? null,
        code?.toLowerCase() ?? null,
      ).map((a) => Approval.parse(a));
    },
    async assertApproved(input) {
      const a = await required(input.approvalId);
      if (
        a.status !== "approved" ||
        a.userId !== input.userId ||
        a.kind !== input.kind ||
        a.consumedAt !== null ||
        a.expiresAt <= ctx.clock.nowIso() ||
        a.payloadHash !== input.payloadHash ||
        hashPayload(a.payload) !== a.payloadHash
      )
        throw new DennisError(
          "approval_invalid",
          "Approval binding or lifecycle check failed",
          409,
        );
      return a;
    },
    consumeInTransaction(id, transaction) {
      if (
        !ctx.db.$client.inTransaction ||
        !transaction ||
        typeof transaction !== "object" ||
        !("update" in transaction) ||
        (transaction as { session?: { client?: unknown } }).session?.client !== ctx.db.$client
      )
        throw new DennisError(
          "approval_invalid",
          "An active platform database transaction is required",
          409,
        );
      const tx = transaction as DbTransaction;
      const value = row<ApprovalT>(ctx.db, "SELECT * FROM approvals WHERE id=?", id);
      if (
        !value ||
        value.status !== "approved" ||
        value.consumedAt ||
        value.expiresAt <= ctx.clock.nowIso() ||
        hashPayload(value.payload) !== value.payloadHash
      )
        throw new DennisError("approval_invalid", "Approval cannot be consumed", 409);
      const result = tx
        .update(approvalTable)
        .set({ consumedAt: ctx.clock.nowIso() })
        .where(
          and(
            eq(approvalTable.id, id),
            eq(approvalTable.status, "approved"),
            isNull(approvalTable.consumedAt),
            gt(approvalTable.expiresAt, ctx.clock.nowIso()),
          ),
        )
        .run();
      if (result.changes !== 1)
        throw new DennisError("approval_invalid", "Approval cannot be consumed", 409);
    },
    async consume(id) {
      const value = row<ApprovalT>(ctx.db, "SELECT * FROM approvals WHERE id=?", id);
      if (!value || hashPayload(value.payload) !== value.payloadHash)
        throw new DennisError("approval_invalid", "Approval payload binding failed", 409);
      const count = update(
        ctx.db,
        "approvals",
        { consumedAt: ctx.clock.nowIso() },
        "id=? AND status='approved' AND consumed_at IS NULL AND expires_at>?",
        id,
        ctx.clock.nowIso(),
      );
      if (count !== 1)
        throw new DennisError("approval_invalid", "Approval cannot be consumed", 409);
    },
    onDecided(kind, handler) {
      hooks.set(kind, [...(hooks.get(kind) ?? []), handler]);
    },
    async expireDue() {
      const due = rows<{ id: string }>(
        ctx.db,
        "SELECT id FROM approvals WHERE status='pending' AND expires_at<=?",
        ctx.clock.nowIso(),
      );
      let count = 0;
      for (const { id } of due)
        count += await ctx.runExclusive("approval:" + id, async () => {
          const a = await required(id);
          if (a.status !== "pending" || a.expiresAt > ctx.clock.nowIso()) return 0;
          const changed = update(
            ctx.db,
            "approvals",
            { status: "expired" },
            "id=? AND status='pending' AND expires_at<=?",
            id,
            ctx.clock.nowIso(),
          );
          if (changed !== 1) return 0;
          emitExpired(a);
          const expired = await required(id);
          for (const handler of hooks.get(a.kind) ?? []) await handler(expired);
          return 1;
        });
      return count;
    },
  };
}

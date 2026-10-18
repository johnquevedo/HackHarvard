import { withTyping } from "./typing.ts";
import { drainPlatform } from "./foundation.ts";
import { DennisError } from "@dennis/contracts";
import { PhotonBetaProvider } from "@dennis/messaging";
import type { ProviderSendResultT } from "@dennis/contracts";
import type { OutboxRecordT } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { rows, row, update } from "./storage.ts";
import { pollIntegrationHealth } from "./integrations.ts";
import { recoverA2A } from "./a2a.ts";
import { ingestInbound, runPipeline } from "./pipeline.ts";
import { cancelConversationalReplies } from "./conversation.ts";
import { cancelPlanning } from "./planning.ts";
function emitDeliveryLatency(
  ctx: PlatformContext,
  outboxId: string,
  agentId: string,
  latencyMs: number,
  mode: "live" | "simulated" | "fallback" | "replay",
) {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
  ctx.events.emit({
    type: "messaging.latency",
    actor: { kind: "agent", agentId },
    visibility: "private",
    mode,
    payload: {
      outboxId,
      provider: ctx.messaging.name,
      span: "outbox_send_to_delivered",
      latencyMs: Math.round(latencyMs),
    },
  });
}
export async function dispatchOutbox(ctx: PlatformContext): Promise<void> {
  await ctx.runExclusive("outbox-dispatch", async () => {
    const pending = rows<OutboxRecordT>(
      ctx.db,
      "SELECT * FROM outbox WHERE (status IN ('queued','failed') AND attempts < 4) OR (status='queued' AND last_error='interrupted_send') ORDER BY created_at",
    );
    for (const item of pending) {
      const retryMs =
        item.lastError === "interrupted_send"
          ? 0
          : ([0, 5000, 15000, 45000][item.attempts] ?? 45000);
      if (item.sentAt && Date.parse(item.sentAt) + retryMs > ctx.clock.now().getTime()) continue;
      if (item.approvalId) {
        const a = await ctx.approvals.get(item.approvalId);
        if (!a || a.status !== "pending" || a.expiresAt <= ctx.clock.nowIso()) {
          update(
            ctx.db,
            "outbox",
            {
              status: "failed",
              attempts: 4,
              lastError: "approval_no_longer_pending",
            },
            "id=?",
            item.id,
          );
          continue;
        }
      }
      const user = await ctx.users.get(item.userId);
      const agent = await ctx.users.getAgentByUserId(item.userId);
      if (!user || !agent) continue;
      const stored = row<{ idempotencyKey: string }>(
        ctx.db,
        "SELECT idempotency_key FROM outbox WHERE id=?",
        item.id,
      )!;
      update(
        ctx.db,
        "outbox",
        {
          status: "sending",
          attempts: item.attempts + 1,
          sentAt: ctx.clock.nowIso(),
        },
        "id=?",
        item.id,
      );
      try {
        const explicitSpace = row<{ value: string }>(
          ctx.db,
          "SELECT value FROM kv WHERE key=?",
          "outbox-route:" + item.id,
        )?.value;
        const spaceId =
          explicitSpace ??
          row<{ photonSpaceId: string }>(
            ctx.db,
            "SELECT photon_space_id FROM photon_spaces WHERE user_id=?",
            user.id,
          )?.photonSpaceId ??
          null;
        const result = await withTyping(ctx, spaceId, stored.idempotencyKey, () =>
          ctx.messaging.send({
            accountKey: ctx.config.photonAccountKey,
            toHandle: user.handle,
            toPhotonUserId: user.photonUserId,
            spaceId,
            // Dennis texts only in lowercase; the stored outbox keeps the original copy.
            text: item.text.toLowerCase(),
            idempotencyKey: stored.idempotencyKey,
          }),
        );
        update(
          ctx.db,
          "outbox",
          {
            status:
              result.status === "delivered"
                ? "delivered"
                : result.status === "failed"
                  ? "failed"
                  : "dispatched",
            provider: ctx.messaging.name,
            providerMessageId: result.providerMessageId,
            providerStatus: result.status,
            lastError: result.status === "failed" ? "provider_failed" : null,
            ...(result.status === "failed" ? { attempts: 4 } : {}),
            deliveredAt: result.status === "delivered" ? ctx.clock.nowIso() : null,
          },
          "id=?",
          item.id,
        );
        if (result.status === "delivered")
          emitDeliveryLatency(
            ctx,
            item.id,
            agent.id,
            ctx.clock.now().getTime() -
              Date.parse(
                row<{ sentAt: string }>(ctx.db, "SELECT sent_at FROM outbox WHERE id=?", item.id)!
                  .sentAt,
              ),
            result.mode,
          );
        ctx.events.emit({
          type: "outbox.updated",
          actor: { kind: "agent", agentId: agent.id },
          visibility: "private",
          mode: result.mode,
          payload: {
            outboxId: item.id,
            status: result.status === "accepted" ? "dispatched" : result.status,
            providerStatus: result.status,
            providerMessageId: result.providerMessageId,
            provider: ctx.messaging.name,
          },
        });
      } catch (error) {
        const permanent =
          error instanceof DennisError &&
          (error.details as { retryable?: boolean } | undefined)?.retryable === false;
        update(
          ctx.db,
          "outbox",
          {
            status: "failed",
            lastError: "provider_send_failed",
            ...(permanent ? { attempts: 4 } : {}),
            provider: ctx.messaging.name,
          },
          "id=?",
          item.id,
        );
        ctx.events.emit({
          type: "outbox.updated",
          actor: { kind: "agent", agentId: agent.id },
          visibility: "private",
          payload: {
            outboxId: item.id,
            status: "failed",
            provider: ctx.messaging.name,
            error: "provider_send_failed",
          },
        });
      }
    }
  });
}
export async function recoverPending(ctx: PlatformContext): Promise<void> {
  update(ctx.db, "outbox", { status: "queued", lastError: "interrupted_send" }, "status='sending'");
  for (const { id } of rows<{ id: string }>(
    ctx.db,
    "SELECT id FROM inbound_messages WHERE status='received' ORDER BY received_at",
  ))
    await runPipeline(ctx, id);
  await recoverA2A(ctx);
  await ctx.approvals.expireDue();
  await dispatchOutbox(ctx);
  await confirmOutbox(ctx);
}
export async function startRuntime(ctx: PlatformContext): Promise<{ stop(): Promise<void> }> {
  let stopped = false;
  let stopTask: Promise<void> | null = null;
  const timers: ReturnType<typeof setInterval>[] = [];
  async function health(): Promise<void> {
    await ctx.runExclusive("runtime-health", async () => {
      if (stopped) return;
      await pollIntegrationHealth(ctx, () => !stopped);
    });
  }
  function stop(): Promise<void> {
    if (stopTask) return stopTask;
    stopped = true;
    cancelConversationalReplies(ctx);
    cancelPlanning(ctx);
    for (const timer of timers) clearInterval(timer);
    stopTask = (async () => {
      try {
        await ctx.messaging.stop();
      } finally {
        await drainPlatform(ctx);
      }
    })();
    return stopTask;
  }
  try {
    await ctx.messaging.start(async (message) => {
      if (!stopped) await ingestInbound(ctx, message);
    });
    await recoverPending(ctx);
    await health();
    timers.push(
      setInterval(() => {
        if (!stopped)
          void dispatchOutbox(ctx)
            .then(() => (stopped ? undefined : confirmOutbox(ctx)))
            .catch(() => ctx.log.error("Outbox dispatch failed"));
      }, 1000),
      setInterval(() => {
        if (!stopped)
          void ctx.approvals.expireDue().catch(() => ctx.log.error("Approval sweep failed"));
      }, 30000),
      setInterval(() => {
        if (!stopped) void health();
      }, 15000),
    );
    for (const timer of timers) timer.unref();
    return { stop };
  } catch (error) {
    try {
      await stop();
    } catch {
      ctx.log.error("Runtime cleanup failed after startup error");
    }
    throw error;
  }
}

export async function confirmOutbox(
  ctx: PlatformContext,
  readStatus?: (messageId: string) => Promise<ProviderSendResultT["status"]>,
): Promise<void> {
  const provider = ctx.messaging;
  const read =
    readStatus ??
    (provider instanceof PhotonBetaProvider ? (id: string) => provider.readStatus(id) : null);
  if (!read) return;
  await ctx.runExclusive("delivery-confirmation", async () => {
    for (const item of rows<OutboxRecordT>(
      ctx.db,
      "SELECT * FROM outbox WHERE status='dispatched' AND provider_message_id IS NOT NULL",
    )) {
      const key = "delivery:" + item.id;
      const count = Number(
        (
          ctx.db.$client.prepare("SELECT value FROM photon_cursors WHERE key=?").get(key) as
            { value: string } | undefined
        )?.value ?? 0,
      );
      if (
        count >= 3 ||
        !item.sentAt ||
        ctx.clock.now().getTime() < Date.parse(item.sentAt) + ([2000, 5000, 10000][count] ?? 10000)
      )
        continue;
      ctx.db.$client
        .prepare(
          "INSERT INTO photon_cursors(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        )
        .run(key, String(count + 1), ctx.clock.nowIso());
      try {
        const status = await read(item.providerMessageId!);
        update(
          ctx.db,
          "outbox",
          {
            providerStatus: status,
            ...(status === "delivered"
              ? { status: "delivered", deliveredAt: ctx.clock.nowIso() }
              : status === "failed"
                ? {
                    status: "failed",
                    attempts: 4,
                    lastError: "provider_delivery_failed",
                  }
                : {}),
          },
          "id=?",
          item.id,
        );
        const agent = await ctx.users.getAgentByUserId(item.userId);
        if (agent && status === "delivered")
          emitDeliveryLatency(
            ctx,
            item.id,
            agent.id,
            ctx.clock.now().getTime() - Date.parse(item.sentAt!),
            provider.name === "photon" ? "live" : "simulated",
          );
        if (agent)
          ctx.events.emit({
            type: "outbox.updated",
            actor: { kind: "agent", agentId: agent.id },
            visibility: "private",
            mode: provider.name === "photon" ? "live" : "simulated",
            payload: {
              outboxId: item.id,
              status: status === "accepted" ? "dispatched" : status,
              providerStatus: status,
              providerMessageId: item.providerMessageId!,
              provider: provider.name,
            },
          });
      } catch {
        ctx.log.warn("Delivery confirmation unavailable; delivery remains unconfirmed");
      }
    }
  });
}

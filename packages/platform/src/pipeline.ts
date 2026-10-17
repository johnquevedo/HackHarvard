import { createHash } from "node:crypto";
import {
  InboundMessage,
  parseCommand,
  DennisError,
  PurchaseCategory,
  MarketCategory,
} from "@dennis/contracts";
import type { InboundMessageT, DetectorInput, DetectorOutcome } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { insert, row, rows, update } from "./storage.ts";
import { normalizeHandle } from "@dennis/messaging";
import { handleCommand, ONBOARDING } from "./commands.ts";
interface StoredInbound {
  id: string;
  userId: string;
  agentId: string;
  text: string | null;
  status: string;
  receivedAt: string;
  provider: string;
}
function claimOnboarding(ctx: PlatformContext, identity: string): boolean {
  const key = "onboarding:" + identity;
  const previous = ctx.db.$client
    .prepare("SELECT value FROM photon_cursors WHERE key=?")
    .get(key) as { value: string } | undefined;
  if (previous && ctx.clock.now().getTime() - Date.parse(previous.value) < 3600000) return false;
  ctx.db.$client
    .prepare(
      "INSERT INTO photon_cursors(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    )
    .run(key, ctx.clock.nowIso(), ctx.clock.nowIso());
  return true;
}
export async function ingestInbound(
  ctx: PlatformContext,
  input: InboundMessageT,
): Promise<{
  messageId: string | null;
  outcome: "queued" | "command" | "ignored" | "replay";
}> {
  const msg = InboundMessage.parse(input);
  return ctx.runExclusive("inbound:" + msg.provider + ":" + msg.providerMessageId, async () => {
    const previous = row<{ id: string }>(
      ctx.db,
      "SELECT id FROM inbound_messages WHERE provider=? AND provider_message_id=?",
      msg.provider,
      msg.providerMessageId,
    );
    if (previous) return { messageId: previous.id, outcome: "replay" };
    if (msg.provider === "photon" && msg.providerSenderId === ctx.config.photonAgentUserId)
      return { messageId: null, outcome: "ignored" };
    let handle: string;
    try {
      handle = normalizeHandle(msg.senderHandle).handle;
    } catch {
      return { messageId: null, outcome: "ignored" };
    }
    const user = await ctx.users.getByHandle(handle);
    if (!user) {
      ctx.events.emit({
        type: "message.ignored",
        actor: { kind: "system" },
        visibility: "system",
        mode: msg.mode,
        payload: { reason: "unknown_handle" },
      });
      const messageId = ctx.ids.next("message");
      insert(ctx.db, "inbound_messages", {
        id: messageId,
        provider: msg.provider,
        providerMessageId: msg.providerMessageId,
        providerSpaceId: msg.providerSpaceId,
        userId: null,
        agentId: null,
        text: null,
        status: "ignored",
        ignoreReason: "unknown_handle",
        receivedAt: msg.receivedAt,
        processedAt: ctx.clock.nowIso(),
      });
      const identity = "handle:" + createHash("sha256").update(handle).digest("hex");
      await ctx.runExclusive("onboarding:" + identity, async () => {
        if (claimOnboarding(ctx, identity))
          await ctx.messaging.send({
            accountKey: ctx.config.photonAccountKey,
            toHandle: handle,
            toPhotonUserId: msg.providerSenderId,
            spaceId: msg.providerSpaceId,
            text: ONBOARDING.replace("{first}", "there"),
            idempotencyKey: "onboarding:" + messageId,
          });
      });
      return { messageId, outcome: "ignored" };
    }
    const agent = await ctx.users.getAgentByUserId(user.id);
    if (!agent) throw new DennisError("not_found", "Agent not found", 404);
    const command = parseCommand(msg.text);
    const consent = await ctx.consent.has(user.id, "messaging_context");
    const paused =
      agent.status === "paused" ||
      row<{ value: boolean }>(ctx.db, "SELECT value FROM kv WHERE key='inbound_paused'")?.value ===
        true;
    const reason = !consent
      ? "no_consent"
      : paused
        ? "paused"
        : !msg.text.trim()
          ? "non_text"
          : null;
    const messageId = ctx.ids.next("message");
    insert(ctx.db, "inbound_messages", {
      id: messageId,
      provider: msg.provider,
      providerMessageId: msg.providerMessageId,
      providerSpaceId: msg.providerSpaceId,
      userId: user.id,
      agentId: agent.id,
      text: consent ? msg.text : null,
      status: command.kind !== "none" ? "command" : reason ? "ignored" : "received",
      ignoreReason: reason,
      receivedAt: msg.receivedAt,
      processedAt: reason || command.kind !== "none" ? ctx.clock.nowIso() : null,
    });
    if (command.kind !== "none") {
      try {
        const result = await handleCommand(ctx, {
          userId: user.id,
          agentId: agent.id,
          messageId,
          command,
        });
        if (result.reply)
          await ctx.notifier.send({
            userId: user.id,
            kind: "info",
            text: result.reply,
            idempotencyKey: "command-reply:" + messageId,
          });
        ctx.events.emit({
          type: "command.handled",
          actor: { kind: "user", agentId: agent.id, userId: user.id },
          visibility: "private",
          mode: msg.mode,
          payload: { messageId, command: command.kind, ok: true },
        });
      } catch (error) {
        update(
          ctx.db,
          "inbound_messages",
          { status: "failed", processedAt: ctx.clock.nowIso() },
          "id=?",
          messageId,
        );
        ctx.events.emit({
          type: "command.handled",
          actor: { kind: "user", agentId: agent.id, userId: user.id },
          visibility: "private",
          mode: msg.mode,
          payload: {
            messageId,
            command: command.kind,
            ok: false,
            note: error instanceof DennisError ? error.code : "internal",
          },
        });
        throw error;
      }
      return { messageId, outcome: "command" };
    }
    if (reason) {
      ctx.events.emit({
        type: "message.ignored",
        actor: { kind: "system" },
        visibility: "system",
        mode: msg.mode,
        payload: { messageId, reason },
      });
      if (!consent && claimOnboarding(ctx, "user:" + user.id))
        await ctx.notifier.send({
          userId: user.id,
          kind: "info",
          text: ONBOARDING.replace("{first}", user.firstName),
          idempotencyKey: "onboarding:" + messageId,
        });
      return { messageId, outcome: "ignored" };
    }
    ctx.events.emit({
      type: "message.received",
      actor: { kind: "user", agentId: agent.id, userId: user.id },
      visibility: "private",
      mode: msg.mode,
      payload: { messageId, provider: msg.provider, text: msg.text },
    });
    queueMicrotask(() => {
      void runPipeline(ctx, messageId).catch(() => {
        ctx.log.error("Pipeline failed");
      });
    });
    return { messageId, outcome: "queued" };
  });
}
export async function runPipeline(ctx: PlatformContext, messageId: string): Promise<void> {
  const initial = row<StoredInbound>(
    ctx.db,
    "SELECT * FROM inbound_messages WHERE id=?",
    messageId,
  );
  if (!initial) return;
  await ctx.runExclusive("pipeline:" + initial.agentId, async () => {
    const m = row<StoredInbound>(ctx.db, "SELECT * FROM inbound_messages WHERE id=?", messageId);
    if (!m || m.status !== "received" || !m.text) return;
    const agent = await ctx.users.getAgent(m.agentId);
    const user = await ctx.users.get(m.userId);
    if (
      !agent ||
      !user ||
      agent.status !== "active" ||
      !(await ctx.consent.has(m.userId, "messaging_context"))
    ) {
      update(
        ctx.db,
        "inbound_messages",
        { status: "ignored", text: null, processedAt: ctx.clock.nowIso() },
        "id=?",
        messageId,
      );
      return;
    }
    const recent = rows<{ text: string }>(
      ctx.db,
      "SELECT text FROM inbound_messages WHERE user_id=? AND id!=? AND received_at<=? AND text IS NOT NULL AND status='processed' ORDER BY received_at DESC LIMIT 3",
      m.userId,
      m.id,
      m.receivedAt,
    )
      .map((r) => r.text)
      .reverse();
    const input: Omit<DetectorInput, "enabledCategories"> = {
      agentId: agent.id,
      userId: user.id,
      messageId,
      text: m.text,
      receivedAt: m.receivedAt,
      recentContext: recent,
      regionCode: user.regionCode,
    };
    try {
      for (const detector of ctx.detectors.list()) {
        const kind = detector.intentKind;
        const scope = kind === "purchase" ? "purchase_matching" : "shortme_free_play";
        const current = await ctx.users.getAgent(agent.id);
        if (
          current?.status !== "active" ||
          !(await ctx.consent.has(user.id, "messaging_context")) ||
          !(await ctx.consent.has(user.id, scope)) ||
          (kind === "purchase"
            ? !current.settings.matchingEnabled
            : !current.settings.shortmeEnabled)
        )
          continue;
        let outcome: DetectorOutcome;
        try {
          outcome = await detector.detect(
            {
              ...input,
              enabledCategories:
                kind === "purchase" ? [...PurchaseCategory.options] : [...MarketCategory.options],
            },
            {
              llm: ctx.llm,
              clock: ctx.clock,
              log: ctx.log,
            },
          );
        } catch {
          outcome = {
            detections: [],
            rejected: [{ reason: "llm_unavailable", detail: "Detector unavailable" }],
            llm: null,
          };
        }
        for (const rejected of outcome.rejected)
          ctx.events.emit({
            type: "intent.rejected",
            actor: { kind: "agent", agentId: agent.id },
            visibility: "private",
            payload: { messageId, detectorId: detector.id, ...rejected },
          });
        for (const detection of outcome.detections) {
          if (detection.kind !== kind)
            throw new DennisError("validation_error", "Detector kind mismatch", 400);
          // Recheck consent after the external inference call.
          const latest = await ctx.users.getAgent(agent.id);
          if (
            !(await ctx.consent.has(user.id, "messaging_context")) ||
            !(await ctx.consent.has(user.id, scope)) ||
            latest?.status !== "active" ||
            (kind === "purchase"
              ? !latest.settings.matchingEnabled
              : !latest.settings.shortmeEnabled)
          )
            continue;
          const intent = await ctx.intents.create({
            ...detection,
            agentId: agent.id,
            userId: user.id,
            sourceMessageId: messageId,
          });
          ctx.events.emit({
            type: "intent.detected",
            actor: { kind: "agent", agentId: agent.id },
            visibility: "private",
            payload: {
              intentId: intent.id,
              kind,
              confidence: detection.confidence,
              rationale: detection.rationale,
              summary: detection.summary,
              detectorId: detector.id,
              llm: outcome.llm,
            },
          });
          for (const handler of ctx.detectors.handlersFor(kind)) await handler({ intent, agent });
        }
      }
      update(
        ctx.db,
        "inbound_messages",
        { status: "processed", processedAt: ctx.clock.nowIso() },
        "id=?",
        messageId,
      );
    } catch (error) {
      update(
        ctx.db,
        "inbound_messages",
        { status: "failed", processedAt: ctx.clock.nowIso() },
        "id=?",
        messageId,
      );
      throw error;
    }
  });
}

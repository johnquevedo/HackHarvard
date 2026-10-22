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
import { scheduleConversationalReply } from "./conversation.ts";
import { handlePollVote, queueNative, rememberSpaceKind } from "./native.ts";
interface StoredInbound {
  id: string;
  userId: string;
  agentId: string;
  text: string | null;
  status: string;
  receivedAt: string;
  provider: string;
  providerSpaceId: string | null;
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
async function groupAuthorizationFailure(
  ctx: PlatformContext,
  msg: InboundMessageT,
): Promise<string | null> {
  if (msg.providerSpaceKind !== "group") return null;
  const participantIds = new Set(
    (msg.providerParticipantIds ?? []).filter((id) => id !== ctx.config.photonAgentUserId),
  );
  const normalizedHandles = new Set<string>();
  for (const raw of msg.providerParticipantHandles ?? []) {
    try {
      normalizedHandles.add(normalizeHandle(raw).handle);
    } catch {
      return "group_participants_unresolved";
    }
  }
  if (participantIds.size < 2 || normalizedHandles.size !== participantIds.size)
    return "group_participants_unresolved";
  let sender: string;
  try {
    sender = normalizeHandle(msg.senderHandle).handle;
  } catch {
    return "group_participants_unresolved";
  }
  if (!normalizedHandles.has(sender)) return "group_sender_mismatch";
  for (const handle of normalizedHandles) {
    const participant = await ctx.users.getByHandle(handle);
    if (!participant) return "group_member_unknown";
    if (!(await ctx.consent.has(participant.id, "messaging_context")))
      return "group_member_without_consent";
  }
  return null;
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
        if (msg.providerSpaceKind !== "group" && claimOnboarding(ctx, identity))
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
    let identityFailure: string | null = null;
    if (msg.provider === "photon" && msg.providerSenderId) {
      if (user.photonUserId && user.photonUserId !== msg.providerSenderId)
        identityFailure = "provider_identity_mismatch";
      else if (!user.photonUserId)
        ctx.db.$client
          .prepare("UPDATE users SET photon_user_id=? WHERE id=? AND photon_user_id IS NULL")
          .run(msg.providerSenderId, user.id);
    }
    const agent = await ctx.users.getAgentByUserId(user.id);
    if (!agent) throw new DennisError("not_found", "Agent not found", 404);
    if (msg.providerSpaceId && msg.providerSpaceKind)
      rememberSpaceKind(ctx, msg.providerSpaceId, msg.providerSpaceKind);
    if (msg.pollVote) return ingestPollVote(ctx, msg, user, agent, identityFailure);
    const pendingApprovalCount = (await ctx.approvals.findPending(user.id, null)).length;
    const command = parseCommand(msg.text, {
      allowNaturalApproval: pendingApprovalCount === 1,
      allowDemoPut: ctx.config.conversationMode === "demo",
    });
    const consent = await ctx.consent.has(user.id, "messaging_context");
    const groupFailure = await groupAuthorizationFailure(ctx, msg);
    const alsoDetect = command.kind === "put" && command.alsoDetect === true;
    if (msg.providerSpaceKind === "group" && msg.providerSpaceId && !groupFailure) {
      // First time Dennis is in this group: share its contact card (name and photo), once.
      queueNative(ctx, {
        userId: user.id,
        spaceId: msg.providerSpaceId,
        payload: { kind: "contact_card" },
        idempotencyKey: "platform.native:contact-card:" + msg.providerSpaceId,
      });
      for (const handle of new Set(msg.providerParticipantHandles ?? [])) {
        const participant = await ctx.users.getByHandle(normalizeHandle(handle).handle);
        if (participant)
          ctx.db.$client
            .prepare(
              "INSERT INTO photon_spaces (user_id,photon_space_id,created_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET photon_space_id=excluded.photon_space_id",
            )
            .run(participant.id, msg.providerSpaceId, ctx.clock.nowIso());
      }
    }
    const paused =
      agent.status === "paused" ||
      row<{ value: boolean }>(ctx.db, "SELECT value FROM kv WHERE key='inbound_paused'")?.value ===
        true;
    const reason = identityFailure
      ? identityFailure
      : groupFailure
        ? groupFailure
        : !consent
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
      text: consent && !identityFailure && !groupFailure ? msg.text : null,
      status:
        command.kind !== "none" && !alsoDetect && !identityFailure && !groupFailure
          ? "command"
          : reason
            ? "ignored"
            : "received",
      ignoreReason: reason,
      receivedAt: msg.receivedAt,
      processedAt: reason || (command.kind !== "none" && !alsoDetect) ? ctx.clock.nowIso() : null,
    });
    if (command.kind !== "none" && !identityFailure && !groupFailure) {
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
      if (!alsoDetect) return { messageId, outcome: "command" };
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
    if (agent.settings.ackMode === "reaction" && msg.provider === "photon") {
      try {
        await ctx.messaging.acknowledge?.(msg);
      } catch {
        ctx.log.warn("Message acknowledgement unavailable");
      }
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
  await ctx.runExclusive("pipeline:" + (initial.providerSpaceId ?? initial.agentId), async () => {
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
    const typingSpace =
      agent.settings.ackMode === "reaction" && m.provider === "photon" ? m.providerSpaceId : null;
    async function typing(enabled: boolean) {
      if (!typingSpace) return;
      try {
        await ctx.messaging.setTyping?.(
          typingSpace,
          enabled,
          "typing:" + messageId + ":" + enabled,
        );
      } catch {
        ctx.log.warn("Typing indicator unavailable");
      }
    }
    try {
      await typing(true);
      let detected = false;
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
          detected = true;
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
      scheduleConversationalReply(ctx, { ...m, text: m.text }, detected);
    } catch (error) {
      update(
        ctx.db,
        "inbound_messages",
        { status: "failed", processedAt: ctx.clock.nowIso() },
        "id=?",
        messageId,
      );
      throw error;
    } finally {
      await typing(false);
    }
  });
}

// A vote on one of Dennis's native polls. Same identity, group-membership, consent, and pause checks
// as text; the vote is stored as a command-like inbound row and routed to the feature that owns the poll.
async function ingestPollVote(
  ctx: PlatformContext,
  msg: InboundMessageT,
  user: { id: string },
  agent: { id: string; status: string },
  identityFailure: string | null,
): Promise<{ messageId: string; outcome: "command" | "ignored" }> {
  const vote = msg.pollVote!;
  const groupFailure = await groupAuthorizationFailure(ctx, msg);
  const consent = await ctx.consent.has(user.id, "messaging_context");
  const paused =
    agent.status === "paused" ||
    row<{ value: boolean }>(ctx.db, "SELECT value FROM kv WHERE key='inbound_paused'")?.value ===
      true;
  const reason =
    identityFailure ?? groupFailure ?? (!consent ? "no_consent" : paused ? "paused" : null);
  const messageId = ctx.ids.next("message");
  insert(ctx.db, "inbound_messages", {
    id: messageId,
    provider: msg.provider,
    providerMessageId: msg.providerMessageId,
    providerSpaceId: msg.providerSpaceId,
    userId: user.id,
    agentId: agent.id,
    text: reason
      ? null
      : `[poll ${vote.selected ? "vote" : "unvote"}] ${vote.option}`.slice(0, 4000),
    status: reason ? "ignored" : "command",
    ignoreReason: reason,
    receivedAt: msg.receivedAt,
    processedAt: ctx.clock.nowIso(),
  });
  if (reason) {
    ctx.events.emit({
      type: "message.ignored",
      actor: { kind: "system" },
      visibility: "system",
      mode: msg.mode,
      payload: { messageId, reason },
    });
    return { messageId, outcome: "ignored" };
  }
  const result = await handlePollVote(ctx, msg, user, agent, messageId);
  if (result.reply)
    await ctx.notifier.send({
      userId: user.id,
      kind: "info",
      text: result.reply,
      ...(msg.providerSpaceId ? { spaceId: msg.providerSpaceId } : {}),
      idempotencyKey: "poll-vote-reply:" + messageId,
    });
  return { messageId, outcome: "command" };
}

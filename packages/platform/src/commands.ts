import { ConsentScope, DennisError, voiceLine } from "@dennis/contracts";
import type { CommandInput } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { cleanPrivateReferences } from "./privacy.ts";
import { commandHandlers } from "./foundation.ts";
import { row, update } from "./storage.ts";
export const ONBOARDING =
  "Hi {first}, I'm Dennis, your personal agent. With your OK I can notice plans in this chat, like things you want to buy, and talk to other people's agents to find ways to save. I share only a minimal anonymous summary, never your messages, and I ask before anything involving your name or money. Reply AGREE to turn this on. STOP any time.";
export async function forgetUser(ctx: PlatformContext, userId: string) {
  if (!(await ctx.users.get(userId))) throw new DennisError("not_found", "User not found", 404);
  const agent = await ctx.users.getAgentByUserId(userId);
  if (!agent) throw new DennisError("not_found", "Agent not found", 404);
  const legacyText = ctx.db.$client
    .prepare("SELECT payload FROM events WHERE visibility='private' AND actor_agent_id=?")
    .all(agent.id) as { payload: string }[];
  if (
    legacyText.some(({ payload }) =>
      Object.entries(JSON.parse(payload) as Record<string, unknown>).some(
        ([key, value]) =>
          ["text", "preview", "summary", "rationale", "detail", "headline", "question"].includes(
            key,
          ) &&
          typeof value === "string" &&
          value !== "[forgotten]",
      ),
    )
  )
    throw new DennisError(
      "invalid_state",
      "Historical private event text requires a privacy migration before FORGET",
      409,
    );
  const open = row(
    ctx.db,
    "SELECT p.id FROM market_positions p JOIN markets m ON m.id=p.market_id WHERE p.user_id=? AND m.status NOT IN ('resolved','void','declined','expired') LIMIT 1",
    userId,
  );
  if (open)
    throw new DennisError(
      "invalid_state",
      "Resolve or void open market positions before forgetting",
      409,
    );
  for (const scope of ConsentScope.options)
    await ctx.consent.set({ userId, scope, granted: false, via: "dashboard" });
  update(ctx.db, "agents", { status: "paused" }, "id=?", agent.id);
  return ctx.db.$client.transaction(() => {
    cleanPrivateReferences(ctx, userId);
    const references = row<{ total: number }>(
      ctx.db,
      "SELECT (SELECT count(*) FROM group_purchase_members WHERE user_id=? AND intent_id IS NOT NULL) + (SELECT count(*) FROM markets WHERE subject_user_id=? AND source_intent_id IS NOT NULL) AS total",
      userId,
      userId,
    );
    if (references?.total)
      throw new DennisError(
        "invalid_state",
        "Feature records must detach private sources before deleting intents",
        409,
      );
    const messages = update(
      ctx.db,
      "inbound_messages",
      { text: null },
      "user_id=? AND text IS NOT NULL",
      userId,
    );
    const intents = ctx.db.$client
      .prepare("DELETE FROM intents WHERE user_id=?")
      .run(userId).changes;
    ctx.db.$client
      .prepare(
        "DELETE FROM kv WHERE key IN (SELECT 'private-event:' || actor_agent_id || ':' || id FROM events WHERE actor_agent_id=?)",
      )
      .run(agent.id);
    update(ctx.db, "approvals", { promptText: "", payload: {} }, "user_id=?", userId);
    update(
      ctx.db,
      "outbox",
      { text: "", status: "failed", attempts: 4, lastError: "privacy_forget" },
      "user_id=?",
      userId,
    );
    return { deleted: { messages, intents, positions: 0 } };
  })();
}
export async function handleCommand(
  ctx: PlatformContext,
  input: CommandInput,
): Promise<{ reply?: string }> {
  const { userId, agentId, command } = input;
  const kind = command.kind;
  const agent = await ctx.users.getAgent(agentId);
  if (agent?.userId !== userId) throw new DennisError("forbidden", "Command owner mismatch", 403);
  if (kind === "agree") {
    const scopes =
      command.scope === "base"
        ? (["messaging_context", "purchase_matching"] as const)
        : command.scope === "shortme"
          ? (["shortme_free_play"] as const)
          : (["sandbox_payments"] as const);
    for (const scope of scopes)
      await ctx.consent.set({
        userId,
        scope,
        granted: true,
        via: ctx.messaging.name === "sim" ? "sim_phone" : "imessage",
      });
    if (command.scope === "base") update(ctx.db, "agents", { status: "active" }, "id=?", agentId);
    return {
      reply:
        command.scope === "shortme"
          ? "ShortMe enabled. You confirm you are 18 or older. Fictional points only, no money or prizes."
          : "Consent recorded. STOP any time.",
    };
  }
  if (kind === "stop" || kind === "pause" || kind === "resume") {
    if (kind === "stop")
      for (const scope of ConsentScope.options)
        await ctx.consent.set({
          userId,
          scope,
          granted: false,
          via: ctx.messaging.name === "sim" ? "sim_phone" : "imessage",
        });
    const status = kind === "resume" ? "active" : "paused";
    update(ctx.db, "agents", { status }, "id=?", agentId);
    ctx.events.emit({
      type: "agent.status_changed",
      actor: { kind: "agent", agentId },
      visibility: "private",
      payload: { agentId, status },
    });
    return {
      reply:
        kind === "stop"
          ? "Stopped. All consent revoked. Reply AGREE to enable Dennis again."
          : status === "active"
            ? "Resumed. Your existing consent settings still apply."
            : "Paused. Reply RESUME to continue.",
    };
  }
  if (kind === "forget") {
    await forgetUser(ctx, userId);
    return {
      reply: "Your stored messages and intents have been deleted. Dennis is stopped.",
    };
  }
  if (kind === "status") {
    const scopes = [];
    for (const scope of ConsentScope.options)
      if (await ctx.consent.has(userId, scope)) scopes.push(scope);
    return {
      reply: `Dennis is ${agent.status}. Enabled consent: ${scopes.join(", ") || "none"}.`,
    };
  }
  if (kind === "help")
    return {
      reply:
        "i'm already listening—no @ needed. talk normally and i'll jump in when i spot a market or group-buy opportunity. you can also say status, pause, resume, stop, or forget. if i ask for approval, reply yes or no with the 4-character code.",
    };
  if (kind === "presence")
    return {
      reply: voiceLine("command.presence", [
        "yeah i'm here. i'm listening—no @ needed.",
        "present. what's the move?",
        "i'm here. who's cooked now?",
        "always watching. what's up?",
        "yeah yeah i'm here. talk to me.",
      ]),
    };
  if (["approve", "decline", "confirm", "dispute"].includes(kind) && "code" in command) {
    const pending = await ctx.approvals.findPending(userId, command.code);
    const matches =
      kind === "confirm" || kind === "dispute"
        ? pending.filter((a) => a.kind === "confirm_resolution")
        : pending;
    if (matches.length === 0)
      return {
        reply: "No matching pending approval. Check the four-character code.",
      };
    if (matches.length > 1)
      return {
        reply: "Which one? Reply YES followed by the 4-character code.",
      };
    const decision = kind === "approve" || kind === "confirm" ? "approve" : "decline";
    await ctx.approvals.decide({
      approvalId: matches[0]!.id,
      userId,
      decision,
      via: ctx.messaging.name === "sim" ? "sim_phone" : "imessage",
    });
    return {
      reply:
        decision === "approve"
          ? voiceLine("command.approved", ["Approved.", "bet.", "say less.", "locked in."])
          : voiceLine("command.declined", [
              "Declined.",
              "got it, skipped.",
              "no worries, dropped it.",
            ]),
    };
  }
  if (kind === "back" || kind === "fade" || kind === "pass" || kind === "put") {
    const handler = commandHandlers.get(ctx)?.get(kind);
    if (handler) return handler(input);
    return { reply: "No matching ShortMe invitation is available." };
  }
  return {};
}

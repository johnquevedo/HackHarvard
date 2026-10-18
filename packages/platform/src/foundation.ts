import { randomUUID } from "node:crypto";
import { createDb } from "@dennis/db";
import { createMessagingProvider, normalizeHandle } from "@dennis/messaging";
import {
  AppConfigSchema,
  ID_PREFIX,
  DennisError,
  User,
  Agent,
  IntegrationStatus,
} from "@dennis/contracts";
import type {
  Clock,
  IdFactory,
  Logger,
  IntegrationRegistry,
  DetectorRegistry,
  CommandHandler,
  AppConfig,
  MessagingProvider,
  StructuredLlm,
} from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
import { insert, row, rows } from "./storage.ts";
import { createEventBus } from "./events.ts";
import { createConsent, createIntentStore, createOpportunityStore } from "./stores.ts";
import { createApprovals, createNotifier } from "./approvals.ts";
import { registerIntegrationHealth } from "./integrations.ts";
import { createA2ABus } from "./a2a.ts";
const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
export function createClock(): Clock {
  return { now: () => new Date(), nowIso: () => new Date().toISOString() };
}
export function createIds(): IdFactory {
  return {
    next: (kind) => ID_PREFIX[kind] + "_" + randomUUID().replaceAll("-", ""),
  };
}
export function createLogger(): Logger {
  function write(level: string, msg: string, meta?: Record<string, unknown>): void {
    const safe = JSON.stringify({ level, msg, ...meta })
      .replace(/(?:pho_sk_|sk-ant-)[a-zA-Z0-9_-]+/g, "[redacted]")
      .replace(/\+\d{8,15}/g, (v) => "***" + v.slice(-4))
      .replace(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g, (v) => "***" + v.slice(-4));
    process.stderr.write(safe + "\n");
  }
  return {
    debug: (m, v) => write("debug", m, v),
    info: (m, v) => write("info", m, v),
    warn: (m, v) => write("warn", m, v),
    error: (m, v) => write("error", m, v),
  };
}
export function createMockLlm(clock: Clock): StructuredLlm {
  return {
    name: "mock",
    async generate() {
      throw new DennisError("integration_unavailable", "Mock LLM has no configured response", 503);
    },
    async health() {
      return {
        name: "llm",
        mode: "simulated",
        healthy: true,
        detail: "MOCK LLM; detections require a registered mock detector",
        lastCheckedAt: clock.nowIso(),
        lastSuccessAt: null,
      };
    },
  };
}
const drainers = new WeakMap<PlatformContext, () => Promise<void>>();
export async function drainPlatform(ctx: PlatformContext): Promise<void> {
  await drainers.get(ctx)?.();
}
export const commandHandlers = new WeakMap<PlatformContext, Map<string, CommandHandler>>();
export async function createPlatform(opts: {
  config: AppConfig;
  messaging?: MessagingProvider;
  llm?: StructuredLlm;
}): Promise<PlatformContext> {
  return buildPlatform(opts);
}
export function buildPlatform(opts: {
  config: AppConfig;
  messaging?: MessagingProvider;
  llm?: StructuredLlm;
  clock?: Clock;
  ids?: IdFactory;
  log?: Logger;
}): PlatformContext {
  const config = AppConfigSchema.parse(opts.config);
  const db = createDb(config.databaseUrl);
  const clock = opts.clock ?? createClock();
  const ids = opts.ids ?? createIds();
  const log = opts.log ?? (config.nodeEnv === "test" ? silent : createLogger());
  const events = createEventBus(db, clock, ids);
  const messaging = opts.messaging ?? createMessagingProvider(config, { db, clock, ids, log });
  const llm = opts.llm ?? createMockLlm(clock);
  const tails = new Map<string, Promise<unknown>>();
  async function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const job = previous.catch(() => {}).then(fn);
    tails.set(key, job);
    try {
      return await job;
    } finally {
      if (tails.get(key) === job) tails.delete(key);
    }
  }
  const detectorsById = new Map<string, ReturnType<DetectorRegistry["list"]>[number]>();
  const detectionHandlers = new Map<string, ReturnType<DetectorRegistry["handlersFor"]>>();
  const detectors: DetectorRegistry = {
    register(d) {
      if (detectorsById.has(d.id))
        throw new DennisError("conflict", "Detector already registered", 409);
      detectorsById.set(d.id, d);
    },
    list: () => [...detectorsById.values()],
    onDetection(k, h) {
      detectionHandlers.set(k, [...(detectionHandlers.get(k) ?? []), h]);
    },
    handlersFor: (k) => detectionHandlers.get(k) ?? [],
  };
  const commandsMap = new Map<string, CommandHandler>();
  const statusByName = new Map<string, ReturnType<IntegrationRegistry["list"]>[number]>();
  const integrations: IntegrationRegistry = {
    report(input) {
      const status = IntegrationStatus.parse(input);
      const old = statusByName.get(status.name);
      statusByName.set(status.name, status);
      if (!old || old.mode !== status.mode || old.healthy !== status.healthy)
        events.emit({
          type: "integration.status",
          actor: { kind: "system" },
          visibility: "system",
          mode: status.mode,
          payload: status,
        });
    },
    list: () => [...statusByName.values()],
  };
  const users = {
    async getByHandle(handle: string) {
      return row<ReturnType<typeof User.parse>>(
        db,
        "SELECT * FROM users WHERE handle=?",
        normalizeHandle(handle).handle,
      );
    },
    async get(userId: string) {
      return row<ReturnType<typeof User.parse>>(db, "SELECT * FROM users WHERE id=?", userId);
    },
    async getAgentByUserId(userId: string) {
      return row<ReturnType<typeof Agent.parse>>(
        db,
        "SELECT * FROM agents WHERE user_id=?",
        userId,
      );
    },
    async getAgent(agentId: string) {
      return row<ReturnType<typeof Agent.parse>>(db, "SELECT * FROM agents WHERE id=?", agentId);
    },
    async listFriends(userId: string, options?: { canInvite?: boolean }) {
      return rows<ReturnType<typeof User.parse>>(
        db,
        "SELECT u.* FROM users u JOIN friend_links f ON f.friend_user_id=u.id WHERE f.user_id=? AND (? = 0 OR f.can_invite=1)",
        userId,
        Number(options?.canInvite ?? false),
      );
    },
  };
  const ctx = {
    config,
    db,
    clock,
    ids,
    log,
    events,
    messaging,
    llm,
    runExclusive,
    detectors,
    users,
    integrations,
    commands: {
      register(kind, handler) {
        if (commandsMap.has(kind))
          throw new DennisError("conflict", "Command already registered", 409);
        commandsMap.set(kind, handler);
      },
    },
  } as PlatformContext;
  commandHandlers.set(ctx, commandsMap);
  drainers.set(ctx, async () => {
    while (tails.size) await Promise.allSettled([...tails.values()]);
  });
  Object.assign(ctx, {
    consent: createConsent(ctx),
    intents: createIntentStore(ctx),
    opportunities: createOpportunityStore(ctx),
    notifier: createNotifier(ctx),
    approvals: createApprovals(ctx),
    a2a: createA2ABus(ctx),
  });
  for (const name of ["photon", "llm", "nessie", "chalk"] as const)
    integrations.report({
      name,
      mode: "fallback",
      healthy: false,
      detail: "Not checked",
      lastCheckedAt: clock.nowIso(),
      lastSuccessAt: null,
    });
  registerIntegrationHealth(ctx, "photon", () => ctx.messaging.health());
  registerIntegrationHealth(ctx, "llm", () => ctx.llm.health());
  return ctx;
}
export async function seedCore(ctx: PlatformContext): Promise<void> {
  ctx.db.$client.transaction(() => {
    for (const [name, raw] of [
      ["alice", ctx.config.demoAliceHandle],
      ["bob", ctx.config.demoBobHandle],
      ["john", ctx.config.demoJohnHandle],
      ["steven", ctx.config.demoStevenHandle],
      ["isaac", ctx.config.demoIsaacHandle],
      ["friend", ctx.config.demoFriendHandle],
    ] as const) {
      const userId = "usr_demo_" + name;
      const agentId = "agt_demo_" + name;
      if (!row(ctx.db, "SELECT id FROM users WHERE id=?", userId)) {
        const { handle, kind } = normalizeHandle(raw);
        const first = name[0]!.toUpperCase() + name.slice(1);
        insert(ctx.db, "users", {
          id: userId,
          displayName: first,
          firstName: first,
          handle,
          handleKind: kind,
          photonUserId: null,
          isDemo: true,
          regionCode: ctx.config.dennisRegionCode,
          createdAt: ctx.clock.nowIso(),
        });
        insert(ctx.db, "agents", {
          id: agentId,
          userId,
          name: "Dennis for " + first,
          status: "active",
          settings: {
            matchingEnabled: true,
            shortmeEnabled: true,
            ackMode: ctx.config.dennisAckMode,
          },
          createdAt: ctx.clock.nowIso(),
        });
        for (const scope of [
          "messaging_context",
          "purchase_matching",
          "shortme_free_play",
          "sandbox_payments",
        ])
          insert(ctx.db, "consents", {
            userId,
            scope,
            status: "granted",
            via: "seed_demo",
            textVersion: "v1",
            createdAt: ctx.clock.nowIso(),
          });
      }
    }
    ctx.db.$client
      .prepare(
        "INSERT OR IGNORE INTO friend_links (user_id,friend_user_id,can_invite) VALUES (?, ?, 1)",
      )
      .run("usr_demo_alice", "usr_demo_bob");
    ctx.db.$client
      .prepare(
        "INSERT OR IGNORE INTO friend_links (user_id,friend_user_id,can_invite) VALUES (?, ?, 1)",
      )
      .run("usr_demo_bob", "usr_demo_alice");
    const link = ctx.db.$client.prepare(
      "INSERT OR IGNORE INTO friend_links (user_id,friend_user_id,can_invite) VALUES (?, ?, 1)",
    );
    const cast = ["usr_demo_john", "usr_demo_steven", "usr_demo_isaac"];
    for (const userId of cast)
      for (const friendUserId of cast) if (userId !== friendUserId) link.run(userId, friendUserId);
    link.run("usr_demo_isaac", "usr_demo_friend");
    link.run("usr_demo_friend", "usr_demo_isaac");
  })();
}
export async function resetCore(ctx: PlatformContext, opts: { keepUsers: boolean }): Promise<void> {
  ctx.db.$client.transaction(() => {
    for (const table of [
      "a2a_messages",
      "outbox",
      "approvals",
      "intents",
      "inbound_messages",
      "opportunities",
      "events",
      "photon_cursors",
      "kv",
    ])
      ctx.db.$client.prepare(`DELETE FROM ${table}`).run();
    if (!opts.keepUsers)
      for (const table of ["photon_spaces", "friend_links", "consents", "agents", "users"])
        ctx.db.$client.prepare(`DELETE FROM ${table}`).run();
  })();
}

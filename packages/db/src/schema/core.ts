import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey().notNull(),
    displayName: text("display_name").notNull(),
    firstName: text("first_name").notNull(),
    handle: text("handle").notNull(),
    handleKind: text("handle_kind").notNull(),
    photonUserId: text("photon_user_id"),
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(true),
    regionCode: text("region_code").notNull().default("boston-cambridge"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("users_unique_0").on(t.handle)],
);
export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    status: text("status").notNull(),
    settings: text("settings", { mode: "json" }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("agents_unique_0").on(t.userId)],
);
export const consents = sqliteTable(
  "consents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    scope: text("scope").notNull(),
    status: text("status").notNull(),
    via: text("via").notNull(),
    textVersion: text("text_version").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("consent_current").on(t.userId, t.scope, sql`${t.id} DESC`)],
);
export const friendLinks = sqliteTable(
  "friend_links",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    friendUserId: text("friend_user_id")
      .notNull()
      .references(() => users.id),
    canInvite: integer("can_invite", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.friendUserId] })],
);
export const photonSpaces = sqliteTable("photon_spaces", {
  userId: text("user_id")
    .primaryKey()
    .notNull()
    .references(() => users.id),
  photonSpaceId: text("photon_space_id").notNull(),
  createdAt: text("created_at").notNull(),
});
export const photonCursors = sqliteTable("photon_cursors", {
  key: text("key").primaryKey().notNull(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const inboundMessages = sqliteTable(
  "inbound_messages",
  {
    id: text("id").primaryKey().notNull(),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id").notNull(),
    providerSpaceId: text("provider_space_id"),
    userId: text("user_id").references(() => users.id),
    agentId: text("agent_id").references(() => agents.id),
    text: text("text"),
    status: text("status").notNull(),
    ignoreReason: text("ignore_reason"),
    receivedAt: text("received_at").notNull(),
    processedAt: text("processed_at"),
  },
  (t) => [uniqueIndex("inbound_messages_unique_0").on(t.provider, t.providerMessageId)],
);
export const intents = sqliteTable(
  "intents",
  {
    id: text("id").primaryKey().notNull(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    sourceMessageId: text("source_message_id").references(() => inboundMessages.id),
    privatePayload: text("private_payload", { mode: "json" }).notNull(),
    publicPayload: text("public_payload", { mode: "json" }),
    shared: integer("shared", { mode: "boolean" }).notNull().default(false),
    confidence: real("confidence").notNull(),
    rationale: text("rationale").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [
    index("intent_agent").on(t.agentId, t.kind, t.status),
    index("intent_shared").on(t.kind, t.shared, t.status),
  ],
);
export const opportunities = sqliteTable(
  "opportunities",
  {
    id: text("id").primaryKey().notNull(),
    type: text("type").notNull(),
    domainRefId: text("domain_ref_id").notNull(),
    status: text("status").notNull(),
    headline: text("headline").notNull(),
    participantAgentIds: text("participant_agent_ids", {
      mode: "json",
    }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("opportunities_unique_0").on(t.type, t.domainRefId)],
);
export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey().notNull(),
    shortCode: text("short_code").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    opportunityId: text("opportunity_id"),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    promptText: text("prompt_text").notNull(),
    expiresAt: text("expires_at").notNull(),
    decidedAt: text("decided_at"),
    decidedVia: text("decided_via"),
    consumedAt: text("consumed_at"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("approvals_unique_0").on(t.idempotencyKey),
    uniqueIndex("pending_approval_code")
      .on(t.userId, t.shortCode)
      .where(sql`${t.status} = 'pending'`),
  ],
);
export const a2aMessages = sqliteTable(
  "a2a_messages",
  {
    id: text("id").primaryKey().notNull(),
    conversationId: text("conversation_id").notNull(),
    type: text("type").notNull(),
    fromAgentId: text("from_agent_id")
      .notNull()
      .references(() => agents.id),
    toAgentId: text("to_agent_id")
      .notNull()
      .references(() => agents.id),
    opportunityId: text("opportunity_id"),
    payload: text("payload", { mode: "json" }).notNull(),
    status: text("status").notNull(),
    error: text("error"),
    causedByEventId: text("caused_by_event_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull(),
    handledAt: text("handled_at"),
  },
  (t) => [
    uniqueIndex("a2a_messages_unique_0").on(t.idempotencyKey),
    index("a2a_conversation").on(t.conversationId, t.createdAt),
  ],
);
export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }).notNull(),
    id: text("id").notNull(),
    ts: text("ts").notNull(),
    type: text("type").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorAgentId: text("actor_agent_id"),
    actorUserId: text("actor_user_id"),
    visibility: text("visibility").notNull(),
    opportunityId: text("opportunity_id"),
    traceId: text("trace_id").notNull(),
    providerMode: text("provider_mode"),
    payload: text("payload", { mode: "json" }).notNull(),
  },
  (t) => [
    uniqueIndex("events_unique_0").on(t.id),
    index("event_lens").on(t.visibility, t.actorAgentId, t.seq),
  ],
);
export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    approvalId: text("approval_id").references(() => approvals.id),
    opportunityId: text("opportunity_id"),
    status: text("status").notNull(),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    providerStatus: text("provider_status"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull(),
    sentAt: text("sent_at"),
    deliveredAt: text("delivered_at"),
  },
  (t) => [uniqueIndex("outbox_unique_0").on(t.idempotencyKey)],
);
export const kv = sqliteTable("kv", {
  key: text("key").primaryKey().notNull(),
  value: text("value", { mode: "json" }).notNull(),
});

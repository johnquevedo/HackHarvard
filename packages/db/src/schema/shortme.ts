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
import { users, agents, intents, opportunities, approvals } from "./core.ts";
export const markets = sqliteTable(
  "markets",
  {
    id: text("id").primaryKey().notNull(),
    opportunityId: text("opportunity_id").notNull(),
    subjectUserId: text("subject_user_id")
      .notNull()
      .references(() => users.id),
    subjectAgentId: text("subject_agent_id")
      .notNull()
      .references(() => agents.id),
    sourceIntentId: text("source_intent_id")
      .notNull()
      .references(() => intents.id),
    category: text("category").notNull(),
    templateKey: text("template_key").notNull(),
    question: text("question").notNull(),
    resolutionCriteria: text("resolution_criteria").notNull(),
    status: text("status").notNull(),
    lockAt: text("lock_at"),
    outcome: text("outcome"),
    resolverKind: text("resolver_kind").notNull(),
    redactions: text("redactions", { mode: "json" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    openedAt: text("opened_at"),
    resolvedAt: text("resolved_at"),
  },
  (t) => [uniqueIndex("markets_unique_0").on(t.opportunityId)],
);
export const marketParticipants = sqliteTable(
  "market_participants",
  {
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    inviteState: text("invite_state").notNull(),
  },
  (t) => [primaryKey({ columns: [t.marketId, t.userId] })],
);
export const marketPositions = sqliteTable(
  "market_positions",
  {
    id: text("id").primaryKey().notNull(),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    side: text("side").notNull(),
    points: integer("points").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("position_points", sql`${t.points} BETWEEN 1 AND 100`),
    uniqueIndex("market_positions_unique_0").on(t.idempotencyKey),
    uniqueIndex("market_positions_unique_1").on(t.marketId, t.userId),
  ],
);
export const pointsAccounts = sqliteTable(
  "points_accounts",
  {
    userId: text("user_id")
      .primaryKey()
      .notNull()
      .references(() => users.id),
    balance: integer("balance").notNull(),
  },
  (t) => [check("nonnegative_balance", sql`${t.balance} >= 0`)],
);
export const pointsLedger = sqliteTable(
  "points_ledger",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    marketId: text("market_id").references(() => markets.id),
    kind: text("kind").notNull(),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    refId: text("ref_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("points_ledger_unique_0").on(t.idempotencyKey)],
);
export const marketResolutions = sqliteTable("market_resolutions", {
  id: text("id").primaryKey().notNull(),
  marketId: text("market_id")
    .notNull()
    .references(() => markets.id),
  proposedOutcome: text("proposed_outcome").notNull(),
  proposedBy: text("proposed_by").notNull(),
  status: text("status").notNull(),
  subjectConfirmState: text("subject_confirm_state").notNull(),
  evidenceNote: text("evidence_note").notNull(),
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
});

// A3 addition (not in the A1 bootstrap snapshot): the 4-character code a friend's BACK, FADE, or PASS
// may carry, and when the unanswered invitation expires. ShortMe creates this table idempotently at
// register time with the exact DDL drizzle generates, so db:push sees no drift.
export const marketInvites = sqliteTable(
  "market_invites",
  {
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    code: text("code").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.marketId, t.userId] }),
    index("market_invites_user_code").on(t.userId, t.code),
  ],
);

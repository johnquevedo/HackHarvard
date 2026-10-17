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
export const merchantOffers = sqliteTable("merchant_offers", {
  id: text("id").primaryKey().notNull(),
  merchantName: text("merchant_name").notNull(),
  productKey: text("product_key").notNull(),
  title: text("title").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  tiers: text("tiers", { mode: "json" }).notNull(),
  isSimulated: integer("is_simulated", { mode: "boolean" })
    .notNull()
    .default(true),
  sourceLabel: text("source_label").notNull(),
  validUntil: text("valid_until").notNull(),
});
export const groupPurchases = sqliteTable(
  "group_purchases",
  {
    id: text("id").primaryKey().notNull(),
    opportunityId: text("opportunity_id").notNull(),
    offerId: text("offer_id")
      .notNull()
      .references(() => merchantOffers.id),
    productKey: text("product_key").notNull(),
    leadAgentId: text("lead_agent_id")
      .notNull()
      .references(() => agents.id),
    status: text("status").notNull(),
    individualPriceCents: integer("individual_price_cents").notNull(),
    groupUnitPriceCents: integer("group_unit_price_cents").notNull(),
    quantityPerMember: integer("quantity_per_member").notNull(),
    savingsPerMemberCents: integer("savings_per_member_cents").notNull(),
    poolAccountRef: text("pool_account_ref").notNull(),
    failureReason: text("failure_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("group_purchases_unique_0").on(t.opportunityId)],
);
export const groupPurchaseMembers = sqliteTable(
  "group_purchase_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groupPurchases.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    intentId: text("intent_id")
      .notNull()
      .references(() => intents.id),
    shareCents: integer("share_cents").notNull(),
    joinState: text("join_state").notNull(),
    joinApprovalId: text("join_approval_id"),
    payState: text("pay_state").notNull(),
    payApprovalId: text("pay_approval_id"),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.agentId] })],
);
export const bankLinks = sqliteTable("bank_links", {
  linkKey: text("link_key").primaryKey().notNull(),
  role: text("role").notNull(),
  provider: text("provider").notNull(),
  customerRef: text("customer_ref").notNull(),
  accountRef: text("account_ref").notNull(),
  accountLabel: text("account_label").notNull(),
  last4: text("last4").notNull(),
  baselineCents: integer("baseline_cents").notNull(),
  seededAt: text("seeded_at").notNull(),
});
export const paymentAttempts = sqliteTable(
  "payment_attempts",
  {
    id: text("id").primaryKey().notNull(),
    groupId: text("group_id")
      .notNull()
      .references(() => groupPurchases.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    approvalId: text("approval_id")
      .notNull()
      .references(() => approvals.id),
    idempotencyKey: text("idempotency_key").notNull(),
    fromAccountRef: text("from_account_ref").notNull(),
    toAccountRef: text("to_account_ref").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull(),
    provider: text("provider").notNull(),
    providerTransferId: text("provider_transfer_id"),
    requestJson: text("request_json", { mode: "json" }),
    responseJson: text("response_json", { mode: "json" }),
    balancesBefore: text("balances_before", { mode: "json" }),
    balancesAfter: text("balances_after", { mode: "json" }),
    verificationNote: text("verification_note"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("payment_attempts_unique_0").on(t.idempotencyKey),
    uniqueIndex("one_live_payment")
      .on(t.groupId, t.userId)
      .where(
        sql`${t.status} IN ('submitting','submitted','verified','unverified')`,
      ),
  ],
);

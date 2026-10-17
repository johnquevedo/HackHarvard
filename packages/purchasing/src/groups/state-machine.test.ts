import { describe, expect, it } from "vitest";

import { transitionGroup, type GroupStatus, type GroupTrigger } from "./state-machine.js";

const legal: [GroupStatus, GroupTrigger, GroupStatus][] = [
  ["proposed", "proposal_accepted", "awaiting_join_approvals"],
  ["proposed", "proposal_rejected", "cancelled"],
  ["awaiting_join_approvals", "join_approved_pending", "awaiting_join_approvals"],
  ["awaiting_join_approvals", "all_join_approved", "confirmed"],
  ["awaiting_join_approvals", "join_declined", "cancelled"],
  ["awaiting_join_approvals", "approval_expired", "expired"],
  ["awaiting_payment_approvals", "all_payments_authorized", "ready_to_settle"],
  ["awaiting_payment_approvals", "payment_declined", "cancelled"],
  ["awaiting_payment_approvals", "approval_expired", "expired"],
  ["ready_to_settle", "settlement_started", "settling"],
  ["settling", "settlement_completed", "settled"],
  ["settling", "settlement_failed", "failed"],
  ["failed", "retry_started", "settling"],
  ["proposed", "consent_revoked", "cancelled"],
  ["awaiting_join_approvals", "consent_revoked", "cancelled"],
  ["confirmed", "consent_revoked", "cancelled"],
  ["awaiting_payment_approvals", "consent_revoked", "cancelled"],
  ["ready_to_settle", "consent_revoked", "cancelled"],
];

describe("group state machine", () => {
  it.each(legal)("moves %s with %s to %s", (from, trigger, to) => {
    expect(transitionGroup(from, trigger)).toBe(to);
  });

  it.each([
    ["settled", "retry_started"],
    ["cancelled", "settlement_started"],
    ["expired", "proposal_accepted"],
    ["proposed", "settlement_started"],
    ["settling", "consent_revoked"],
  ] as [GroupStatus, GroupTrigger][])("rejects illegal transition %s with %s", (from, trigger) => {
    expect(() => transitionGroup(from, trigger)).toThrow("Invalid group transition");
  });
});

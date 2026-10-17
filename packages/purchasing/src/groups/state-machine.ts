export type GroupStatus =
  | "proposed"
  | "awaiting_join_approvals"
  | "confirmed"
  | "awaiting_payment_approvals"
  | "ready_to_settle"
  | "settling"
  | "settled"
  | "failed"
  | "cancelled"
  | "expired";

export type GroupTrigger =
  | "proposal_accepted"
  | "proposal_rejected"
  | "join_approved_pending"
  | "all_join_approved"
  | "join_declined"
  | "approval_expired"
  | "all_payments_authorized"
  | "payment_declined"
  | "settlement_started"
  | "settlement_completed"
  | "settlement_failed"
  | "retry_started"
  | "consent_revoked";

const TRANSITIONS: Partial<Record<GroupStatus, Partial<Record<GroupTrigger, GroupStatus>>>> = {
  proposed: {
    proposal_accepted: "awaiting_join_approvals",
    proposal_rejected: "cancelled",
    consent_revoked: "cancelled",
  },
  awaiting_join_approvals: {
    join_approved_pending: "awaiting_join_approvals",
    all_join_approved: "confirmed",
    join_declined: "cancelled",
    approval_expired: "expired",
    consent_revoked: "cancelled",
  },
  confirmed: { consent_revoked: "cancelled" },
  awaiting_payment_approvals: {
    all_payments_authorized: "ready_to_settle",
    payment_declined: "cancelled",
    approval_expired: "expired",
    consent_revoked: "cancelled",
  },
  ready_to_settle: {
    settlement_started: "settling",
    consent_revoked: "cancelled",
  },
  settling: {
    settlement_completed: "settled",
    settlement_failed: "failed",
  },
  failed: { retry_started: "settling" },
};

export function transitionGroup(current: GroupStatus, trigger: GroupTrigger): GroupStatus {
  const next = TRANSITIONS[current]?.[trigger];
  if (!next) throw new Error(`Invalid group transition ${current} with ${trigger}`);
  return next;
}

export function isGroupTerminal(status: GroupStatus): boolean {
  return status === "settled" || status === "cancelled" || status === "expired";
}

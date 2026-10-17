import { describe, it, expect } from "vitest";
import {
  parseCommand,
  hashPayload,
  formatUsd,
  EVENT_PAYLOAD_SCHEMAS,
  A2A_PAYLOAD_SCHEMAS,
} from "./index.ts";
const ts = "2026-10-17T12:00:00.000Z";
const pub = {
  category: "monitor",
  productKey: "monitor_27in_4k",
  quantity: 1,
  budgetBandMaxCents: 35000,
  window: { from: "2026-10-17", to: "2026-10-31" },
  regionCode: "boston-cambridge",
};
const samples: Record<keyof typeof EVENT_PAYLOAD_SCHEMAS, unknown> = {
  "messaging.latency": {
    outboxId: "out_latency",
    provider: "sim",
    span: "outbox_send_to_delivered",
    latencyMs: 15,
  },
  "message.received": {
    messageId: "msg_demo_test",
    provider: "sim",
    text: "hi",
  },
  "message.ignored": { reason: "unknown_handle" },
  "command.handled": { messageId: "msg_demo_test", command: "agree", ok: true },
  "consent.changed": {
    userId: "usr_demo_alice",
    scope: "messaging_context",
    status: "granted",
    via: "seed_demo",
  },
  "agent.status_changed": { agentId: "agt_demo_alice", status: "active" },
  "intent.detected": {
    intentId: "int_demo_test",
    kind: "purchase",
    confidence: 0.9,
    rationale: "Explicit",
    summary: "Monitor",
    detectorId: "purchase",
    llm: null,
  },
  "intent.rejected": {
    messageId: "msg_demo_test",
    detectorId: "purchase",
    reason: "not_an_intent",
    detail: "Greeting",
  },
  "intent.registered": {
    intentId: "int_demo_test",
    agentId: "agt_demo_alice",
    kind: "purchase",
    publicPayload: pub,
  },
  "intent.revoked": {
    intentId: "int_demo_test",
    agentId: "agt_demo_alice",
    reason: "consent_or_owner_revoked",
  },
  "a2a.sent": {
    a2aId: "a2a_demo_test",
    conversationId: "cnv_1",
    type: "market.invite_response",
    fromAgentId: "agt_demo_alice",
    toAgentId: "agt_demo_bob",
    payload: { marketId: "mkt_demo_test", response: "accepted" },
  },
  "a2a.handled": {
    a2aId: "a2a_demo_test",
    type: "market.invite_response",
    toAgentId: "agt_demo_bob",
    ok: true,
  },
  "approval.requested": {
    approvalId: "apr_demo_test",
    kind: "authorize_payment",
    shortCode: "a7f3",
    expiresAt: ts,
    summary: "Sandbox transfer",
  },
  "approval.decided": {
    approvalId: "apr_demo_test",
    kind: "authorize_payment",
    status: "approved",
    via: "sim_phone",
  },
  "approval.expired": {
    approvalId: "apr_demo_test",
    kind: "authorize_payment",
  },
  "outbox.queued": {
    outboxId: "out_demo_test",
    userId: "usr_demo_alice",
    kind: "info",
    preview: "Ready",
  },
  "outbox.updated": {
    outboxId: "out_demo_test",
    status: "delivered",
    provider: "sim",
  },
  "opportunity.updated": {
    opportunityId: "opp_demo_test",
    type: "group_purchase",
    status: "proposed",
    headline: "Monitor offer",
  },
  "purchase.match.evaluated": {
    conversationId: "cnv_1",
    aAgentId: "agt_demo_alice",
    bAgentId: "agt_demo_bob",
    compatible: true,
    checks: [{ rule: "budget", passed: true, detail: "Within budget" }],
  },
  "purchase.group.updated": {
    groupId: "grp_demo_test",
    status: "proposed",
    members: [{ agentId: "agt_demo_alice", join: "pending", pay: "none" }],
  },
  "purchase.payment.updated": {
    attemptId: "pay_demo_test",
    groupId: "grp_demo_test",
    userId: "usr_demo_alice",
    status: "verified",
    amountCents: 100,
    mode: "simulated",
  },
  "bank.seeded": {
    provider: "sim",
    mode: "simulated",
    accounts: [{ label: "Demo Alice", last4: "0001", balanceCents: 150000 }],
  },
  "shortme.market.updated": {
    marketId: "mkt_demo_test",
    status: "open",
    question: "Will Alice get the role?",
    subjectAgentId: "agt_demo_alice",
  },
  "shortme.position.placed": {
    marketId: "mkt_demo_test",
    agentId: "agt_demo_bob",
    side: "back",
    points: 50,
    selfShort: false,
  },
  "shortme.resolution.updated": {
    marketId: "mkt_demo_test",
    status: "proposed",
    proposedOutcome: "yes",
    subjectConfirmState: "pending",
  },
  "shortme.ledger.posted": {
    marketId: "mkt_demo_test",
    entries: [
      {
        agentId: "agt_demo_alice",
        kind: "stake",
        delta: -50,
        balanceAfter: 950,
      },
    ],
    invariantOk: true,
  },
  "integration.status": {
    name: "photon",
    mode: "simulated",
    healthy: true,
    detail: "SIMULATED",
    lastCheckedAt: ts,
    lastSuccessAt: null,
  },
  "demo.reset": { runId: "run_1" },
  "eval.report": { provider: "local", runId: "run_1" },
  "error.logged": { where: "test", message: "Sanitized error" },
};
describe("contract event completeness", () => {
  for (const [name, schema] of Object.entries(EVENT_PAYLOAD_SCHEMAS)) {
    it(name + " parses its documented sample and rejects extra fields", () => {
      expect(schema.safeParse(samples[name as keyof typeof samples]).success).toBe(true);
      expect(
        schema.safeParse({
          ...(samples[name as keyof typeof samples] as object),
          rawMessage: "secret",
        }).success,
      ).toBe(false);
    });
  }
  it("validates all six strict A2A payloads", () => {
    const values: Record<keyof typeof A2A_PAYLOAD_SCHEMAS, object> = {
      "purchase.probe": {
        intentRef: "int_demo_test",
        publicIntent: pub,
        leadAgentId: "agt_demo_alice",
      },
      "purchase.probe_result": {
        intentRef: "int_demo_test",
        compatible: true,
        reasons: ["product_match"],
      },
      "purchase.proposal": {
        groupId: "grp_demo_test",
        offerId: "ofr_demo_test",
        productKey: "monitor_27in_4k",
        individualPriceCents: 32999,
        groupUnitPriceCents: 28499,
        savingsPerMemberCents: 4500,
        quantityPerMember: 1,
        isSimulatedOffer: true,
        validUntil: ts,
      },
      "purchase.proposal_result": {
        groupId: "grp_demo_test",
        accept: true,
        reasons: ["accepted"],
      },
      "market.invite": {
        marketId: "mkt_demo_test",
        question: "Will Alice get the role?",
        subjectFirstName: "Alice",
        pointsOnly: true,
        startingPoints: 1000,
        expiresAt: ts,
      },
      "market.invite_response": {
        marketId: "mkt_demo_test",
        response: "accepted",
      },
    };
    for (const [name, schema] of Object.entries(A2A_PAYLOAD_SCHEMAS)) {
      expect(schema.safeParse(values[name as keyof typeof values]).success).toBe(true);
      expect(
        schema.safeParse({
          ...values[name as keyof typeof values],
          sourceExcerpt: "secret",
        }).success,
      ).toBe(false);
    }
  });
  it("hashes canonical nested JSON and formats integer cents", () => {
    expect(hashPayload({ b: 2, a: { z: 3, y: 4 } })).toBe(hashPayload({ a: { y: 4, z: 3 }, b: 2 }));
    expect(hashPayload({ a: [1, 2] })).not.toBe(hashPayload({ a: [2, 1] }));
    expect(() => hashPayload({ invalid: NaN })).toThrow();
    expect(formatUsd(28499)).toBe("$284.99");
    expect(() => formatUsd(1.2)).toThrow();
  });
});
const cases: [string, object][] = [
  ["AGREE", { kind: "agree", scope: "base" }],
  ["  agree  ", { kind: "agree", scope: "base" }],
  ["AGREE SHORTME!", { kind: "agree", scope: "shortme" }],
  ["agree  payments.", { kind: "agree", scope: "payments" }],
  ...["STOP", "PAUSE", "RESUME", "STATUS", "FORGET", "HELP"].map(
    (k) => [k, { kind: k.toLowerCase() }] as [string, object],
  ),
  ...["YES", "Y", "APPROVE", "OK"].flatMap(
    (k) =>
      [
        [k, { kind: "approve", code: null }],
        [k + " A7F3!", { kind: "approve", code: "a7f3" }],
      ] as [string, object][],
  ),
  ...["NO", "N", "DECLINE"].flatMap(
    (k) =>
      [
        [k, { kind: "decline", code: null }],
        [k + " A7F3.", { kind: "decline", code: "a7f3" }],
      ] as [string, object][],
  ),
  ["back 50", { kind: "back", points: 50, code: null }],
  ["BACK 100 A7F3!", { kind: "back", points: 100, code: "a7f3" }],
  [" fade  30  a7f3 ", { kind: "fade", points: 30, code: "a7f3" }],
  ["PASS", { kind: "pass", code: null }],
  ["pass a7f3", { kind: "pass", code: "a7f3" }],
  ["CONFIRM!", { kind: "confirm", code: null }],
  ["confirm A7F3", { kind: "confirm", code: "a7f3" }],
  ["DISPUTE", { kind: "dispute", code: null }],
  ["dispute a7f3.", { kind: "dispute", code: "a7f3" }],
  ...[
    "",
    "hello",
    "yes please",
    "YES abc",
    "YES abcde",
    "YES a7f3 extra",
    "AGREE maybe",
    "agree shortme now",
    "back 0",
    "back 101",
    "back -5",
    "fade 1.5",
    "back 50 wrongcode",
    "back",
    "STOP a7f3",
    "I say yes",
    "yes a7$3",
  ].map((k) => [k, { kind: "none" }] as [string, object]),
];
describe("deterministic commands", () => {
  it.each(cases)("parses %s", (text, expected) => expect(parseCommand(text)).toEqual(expected));
});

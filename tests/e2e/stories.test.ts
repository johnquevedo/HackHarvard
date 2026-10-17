import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { findSharedLeaks, SCENARIOS } from "./privacy";

describe("e2e catalog", () => {
  it("lists both demo stories and E1 through E12", () => {
    expect(SCENARIOS).toEqual([
      "E1",
      "E2",
      "E3",
      "E4",
      "E5",
      "E6",
      "E7",
      "E8",
      "E9",
      "E10",
      "E11",
      "E12",
    ]);
  });

  it("flags private fields in shared replay events and accepts the clean fixtures", () => {
    const purchase = readFileSync("fixtures/replay/purchase.jsonl", "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { visibility: string; payload: unknown });
    const shortme = readFileSync("fixtures/replay/shortme.jsonl", "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { visibility: string; payload: unknown });
    for (const event of [...purchase, ...shortme]) {
      expect(findSharedLeaks(event)).toEqual([]);
    }
    expect(
      findSharedLeaks({ visibility: "shared", payload: { text: "call 617-555-0100" } }),
    ).not.toEqual([]);
    expect(findSharedLeaks({ visibility: "private", payload: { text: "secret" } })).toEqual([]);
  });
});

const base = process.env.E2E_BASE_URL;
const admin = process.env.E2E_ADMIN_TOKEN ?? "";

describe.skipIf(!base)("live simulated stories", () => {
  it("boots, accepts both demo scripts, and keeps Alice private text off Bob's lens", async () => {
    const health = await fetch(`${base}/api/health`);
    expect(health.ok).toBe(true);
    const headers = {
      "content-type": "application/json",
      "x-dennis-admin": admin,
    };
    for (const name of ["shortme_alice", "purchase_alice", "purchase_bob"]) {
      const script = await fetch(`${base}/api/demo/script/${name}`, { method: "POST", headers });
      expect(script.ok).toBe(true);
      const body = (await script.json()) as { messageId?: string; label?: string };
      expect(body.label).toBe("SIMULATED INBOUND");
      expect(body.messageId).toBeTruthy();
    }
    type Group = { id: string; status: string };
    async function groups(): Promise<Group[]> {
      const response = await fetch(`${base}/api/purchasing/groups`, { headers });
      expect(response.ok).toBe(true);
      return (await response.json()) as Group[];
    }
    await vi.waitFor(
      async () => expect((await groups())[0]?.status).toBe("awaiting_join_approvals"),
      { timeout: 5000 },
    );
    const groupId = (await groups())[0]!.id;
    for (const kind of ["join_group_purchase", "authorize_payment"]) {
      for (const name of ["alice", "bob"]) {
        const userId = "usr_demo_" + name;
        type Approval = { id: string; kind: string; shortCode: string; opportunityId: string };
        const response = await fetch(`${base}/api/approvals?userId=${userId}&status=pending`, {
          headers,
        });
        const pending = ((await response.json()) as Approval[]).filter((a) => a.kind === kind);
        expect(pending).toHaveLength(1);
        const reply = await fetch(`${base}/api/sim/inbound`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            fromUserId: userId,
            text: "YES " + pending[0]!.shortCode,
            clientMessageId: `e2e-${kind}-${name}`,
          }),
        });
        expect(reply.ok).toBe(true);
      }
    }
    await vi.waitFor(
      async () =>
        expect((await groups()).find((group) => group.id === groupId)?.status).toBe("settled"),
      { timeout: 5000 },
    );
    const accounts = await fetch(`${base}/api/purchasing/bank/accounts`, { headers });
    const bank = (await accounts.json()) as {
      mode: string;
      accounts: { ownerKey: string; balanceCents: number }[];
    };
    expect(bank.mode).toBe("simulated");
    expect(bank.accounts.find((a) => a.ownerKey === "usr_demo_alice")?.balanceCents).toBe(
      150000 - 28499,
    );
    expect(bank.accounts.find((a) => a.ownerKey === "usr_demo_bob")?.balanceCents).toBe(
      120000 - 28499,
    );
    expect(bank.accounts.find((a) => a.ownerKey === "pool")?.balanceCents).toBe(56998);
    const judge = await fetch(`${base}/api/events?limit=200`, { headers });
    expect(judge.ok).toBe(true);
    const judgeBody = (await judge.json()) as {
      events: { visibility: string; payload: unknown; type: string }[];
    };
    expect(judgeBody.events.some((event) => event.type === "shortme.market.updated")).toBe(true);
    for (const event of judgeBody.events) expect(findSharedLeaks(event)).toEqual([]);
    const bob = await fetch(`${base}/api/events?viewerAgentId=agt_demo_bob&limit=200`, { headers });
    expect(bob.ok).toBe(true);
    const bobText = await bob.text();
    expect(bobText).not.toContain("maybe $350 or under");
  });
});

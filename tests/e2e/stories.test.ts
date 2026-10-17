import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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

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

describe.skipIf(!base)("live simulated stories", () => {
  it("reaches health before the story driver", async () => {
    const response = await fetch(`${base}/api/health`);
    expect(response.ok).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { assertReplayOnly, toReplayLine, type ReplayEvent } from "./replay-demo";

describe("replay", () => {
  it("stamps replay mode and rejects anything else", () => {
    const line = toReplayLine(
      {
        seq: 1,
        ts: "2026-10-17T19:00:01.000Z",
        type: "demo.reset",
        visibility: "system",
        payload: { runId: "run_1" },
      },
      Date.parse("2026-10-17T19:00:00.000Z"),
    );
    expect(line.mode).toBe("replay");
    expect(line.offsetMs).toBe(1000);
    assertReplayOnly([line]);
    expect(() => assertReplayOnly([{ ...line, mode: "live" } as unknown as ReplayEvent])).toThrow(
      /replay/,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  applyAckModeFromEnv,
  applyAckModeToDemoAgents,
  mergeAckModeSettings,
  type SqliteLike,
} from "./apply-ack-mode";

function memoryAgents(initial: { id: string; settings: string }[]): SqliteLike {
  const rows = initial.map((row) => ({ ...row }));
  return {
    prepare(sql: string) {
      if (sql.startsWith("SELECT")) {
        return {
          all: () => rows.filter((row) => row.id.startsWith("agt_demo_")),
          run: () => ({ changes: 0 }),
        };
      }
      return {
        all: () => [],
        run: (settings: unknown, id: unknown) => {
          const row = rows.find((item) => item.id === id);
          if (row) row.settings = String(settings);
          return { changes: row ? 1 : 0 };
        },
      };
    },
  };
}

describe("apply-ack-mode", () => {
  it("merges ackMode without dropping other settings", () => {
    const { next, changed } = mergeAckModeSettings(
      JSON.stringify({ matchingEnabled: true, shortmeEnabled: true, ackMode: "none" }),
      "reaction",
    );
    expect(changed).toBe(true);
    expect(JSON.parse(next)).toEqual({
      matchingEnabled: true,
      shortmeEnabled: true,
      ackMode: "reaction",
    });
    expect(mergeAckModeSettings(next, "reaction").changed).toBe(false);
  });

  it("updates demo agents from DENNIS_ACK_MODE", () => {
    const db = memoryAgents([
      {
        id: "agt_demo_alice",
        settings: JSON.stringify({
          matchingEnabled: true,
          shortmeEnabled: true,
          ackMode: "none",
        }),
      },
      {
        id: "agt_other",
        settings: JSON.stringify({
          matchingEnabled: true,
          shortmeEnabled: true,
          ackMode: "none",
        }),
      },
    ]);
    expect(applyAckModeToDemoAgents(db, "reaction")).toBe(1);
    const alice = (
      db.prepare("SELECT").all() as { id: string; settings: string }[]
    ).find((row) => row.id === "agt_demo_alice");
    expect(JSON.parse(alice!.settings).ackMode).toBe("reaction");
    expect(applyAckModeFromEnv(db, { DENNIS_ACK_MODE: "none" }).updated).toBe(1);
  });
});

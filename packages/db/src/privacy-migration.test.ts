import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { BOOTSTRAP_SQL, createDb } from "./client.ts";
import { buildPlatform, seedCore } from "../../platform/src/foundation.ts";
import { insert } from "../../platform/src/storage.ts";
import { AppConfigSchema } from "../../contracts/src/index.ts";
import { pushDbSchema } from "./push.ts";
it("upgrades old required source references without deleting audit rows or indexes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dennis-privacy-upgrade-"));
  const path = join(directory, "state.db");
  const legacy = BOOTSTRAP_SQL.replace("`intent_id` text,", "`intent_id` text NOT NULL,").replace(
    "`source_intent_id` text,",
    "`source_intent_id` text NOT NULL,",
  );
  let db = new Database(path);
  try {
    db.exec(legacy);
    db.close();
    const ctx = buildPlatform({
      config: AppConfigSchema.parse({
        databaseUrl: "file:" + path,
        dennisAdminToken: "privacy-migration-test-token",
        nodeEnv: "test",
      }),
    });
    await seedCore(ctx);
    const now = ctx.clock.nowIso();
    insert(ctx.db, "intents", {
      id: "int_old",
      agentId: "agt_demo_alice",
      userId: "usr_demo_alice",
      kind: "purchase",
      status: "revoked",
      sourceMessageId: null,
      privatePayload: {},
      publicPayload: null,
      shared: false,
      confidence: 0.9,
      rationale: "Legacy synthetic fixture",
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      revokedAt: now,
    });
    insert(ctx.db, "markets", {
      id: "mkt_old",
      opportunityId: "opp_old",
      subjectUserId: "usr_demo_alice",
      subjectAgentId: "agt_demo_alice",
      sourceIntentId: "int_old",
      category: "recruiting",
      templateKey: "legacy",
      question: "Legacy published question",
      resolutionCriteria: "Legacy criterion",
      status: "declined",
      lockAt: null,
      outcome: null,
      resolverKind: "subject",
      redactions: [],
      createdAt: now,
      updatedAt: now,
      openedAt: null,
      resolvedAt: null,
    });
    insert(ctx.db, "market_participants", {
      marketId: "mkt_old",
      userId: "usr_demo_alice",
      role: "subject",
      inviteState: "not_applicable",
    });
    const marketBefore = ctx.db.$client.prepare("SELECT * FROM markets").all();
    ctx.db.$client.close();
    db = new Database(path);
    db.prepare("INSERT INTO kv(key,value) VALUES(?,?)").run(
      "audit-marker",
      JSON.stringify({ retained: true }),
    );
    expect(
      (db.prepare("PRAGMA table_info(markets)").all() as { name: string; notnull: number }[]).find(
        (c) => c.name === "source_intent_id",
      )?.notnull,
    ).toBe(1);
    db.close();
    await pushDbSchema(path);
    await pushDbSchema(path);
    db = new Database(path);
    expect(
      (db.prepare("PRAGMA table_info(markets)").all() as { name: string; notnull: number }[]).find(
        (c) => c.name === "source_intent_id",
      )?.notnull,
    ).toBe(0);
    expect(
      (
        db.prepare("PRAGMA table_info(group_purchase_members)").all() as {
          name: string;
          notnull: number;
        }[]
      ).find((c) => c.name === "intent_id")?.notnull,
    ).toBe(0);
    expect(db.prepare("SELECT value FROM kv WHERE key='audit-marker'").get()).toEqual({
      value: '{"retained":true}',
    });
    expect(db.prepare("SELECT * FROM markets").all()).toEqual(marketBefore);
    expect(db.prepare("SELECT market_id,user_id FROM market_participants").get()).toEqual({
      market_id: "mkt_old",
      user_id: "usr_demo_alice",
    });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    const readOnly = createDb(path, { readonly: true });
    try {
      expect(() =>
        readOnly.$client.prepare("INSERT INTO kv(key,value) VALUES('not-written','true')").run(),
      ).toThrow();
    } finally {
      readOnly.$client.close();
    }
    expect(db.prepare("SELECT * FROM kv WHERE key='not-written'").get()).toBeUndefined();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name='markets_unique_0'").get(),
    ).toBeTruthy();
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

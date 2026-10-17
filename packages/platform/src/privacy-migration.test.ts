import { expect, it } from "vitest";
import { createTestPlatform } from "./testing.ts";
import { planLegacyPrivacyMigration, applyLegacyPrivacyMigration } from "./privacy-migration.ts";
import { forgetUser } from "./commands.ts";
it("plans read-only, requires opt-in, preserves owner history, then permits real FORGET erasure", async () => {
  const ctx = await createTestPlatform();
  try {
    const secret = "private legacy transcript 3198";
    const payload = JSON.stringify({ messageId: "legacy", provider: "sim", text: secret });
    ctx.db.$client
      .prepare(
        "INSERT INTO events(id,ts,type,actor_kind,actor_agent_id,visibility,trace_id,payload) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        "evt_legacy",
        ctx.clock.nowIso(),
        "message.received",
        "agent",
        "agt_demo_alice",
        "private",
        "trace",
        payload,
      );
    const before = ctx.db.$client
      .prepare("SELECT * FROM events WHERE id='evt_legacy'")
      .get() as Record<string, unknown>;
    expect(planLegacyPrivacyMigration(ctx.db)).toMatchObject({
      rewriteRequired: 1,
      applied: false,
    });
    expect(ctx.db.$client.prepare("SELECT * FROM events WHERE id='evt_legacy'").get()).toEqual(
      before,
    );
    expect(() =>
      applyLegacyPrivacyMigration(ctx.db, ctx.clock, { allowAuditPayloadRewrite: false }),
    ).toThrow();
    expect(
      applyLegacyPrivacyMigration(ctx.db, ctx.clock, { allowAuditPayloadRewrite: true }),
    ).toEqual({ rewritten: 1, applied: true });
    const after = ctx.db.$client
      .prepare("SELECT * FROM events WHERE id='evt_legacy'")
      .get() as Record<string, unknown>;
    expect({ ...after, payload: before.payload }).toEqual(before);
    expect(JSON.stringify(after)).not.toContain(secret);
    expect(
      JSON.stringify(ctx.events.history({ viewerAgentId: "agt_demo_alice", limit: 200 })),
    ).toContain(secret);
    expect(
      applyLegacyPrivacyMigration(ctx.db, ctx.clock, { allowAuditPayloadRewrite: true }).rewritten,
    ).toBe(0);
    await forgetUser(ctx, "usr_demo_alice");
    expect(
      JSON.stringify(ctx.events.history({ viewerAgentId: "agt_demo_alice", limit: 200 })),
    ).not.toContain(secret);
    expect(JSON.stringify(ctx.db.$client.prepare("SELECT * FROM kv").all())).not.toContain(secret);
  } finally {
    ctx.db.$client.close();
  }
});

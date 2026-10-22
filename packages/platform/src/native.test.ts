import { describe, expect, it } from "vitest";
import type { MessagingProvider } from "@dennis/contracts";
import { SimMessagingProvider } from "@dennis/messaging";
import { createTestPlatform } from "./testing.ts";
import {
  dispatchNative,
  nativeActions,
  queueNative,
  rememberSpaceKind,
  setSpeechSynth,
} from "./native.ts";

const USER = "usr_demo_alice";

async function setup(messaging?: MessagingProvider) {
  return createTestPlatform(messaging ? { messaging } : {});
}

describe("native iMessage action queue", () => {
  it("is idempotent by key and records the outcome of every action", async () => {
    const ctx = await setup();
    rememberSpaceKind(ctx, "spc_group", "group");
    const a = queueNative(ctx, {
      userId: USER,
      spaceId: "spc_group",
      payload: { kind: "rename", name: "📉 $ALICE" },
      idempotencyKey: "k",
    });
    const b = queueNative(ctx, {
      userId: USER,
      spaceId: "spc_group",
      payload: { kind: "rename", name: "📉 $ALICE" },
      idempotencyKey: "k",
    });
    expect(b).toBe(a);
    expect(await dispatchNative(ctx)).toBe(1);
    expect(await dispatchNative(ctx)).toBe(0);
    expect(nativeActions(ctx).map((x) => x.status)).toEqual(["sent"]);
    expect((ctx.messaging as SimMessagingProvider).nativeLog).toEqual([
      { kind: "rename", spaceId: "spc_group", name: "📉 $ALICE" },
    ]);
  });

  it("only renames group chats", async () => {
    const ctx = await setup();
    rememberSpaceKind(ctx, "spc_dm", "direct");
    queueNative(ctx, {
      userId: USER,
      spaceId: "spc_dm",
      payload: { kind: "rename", name: "nope" },
      idempotencyKey: "dm",
    });
    await dispatchNative(ctx);
    expect(nativeActions(ctx)[0]).toMatchObject({
      status: "skipped",
      error: "only group chats can be renamed",
    });
  });

  it("records unsupported when the provider has no native features, and skips actions with no conversation", async () => {
    const plain = new SimMessagingProvider() as MessagingProvider & { native?: unknown };
    delete (plain as { native?: unknown }).native;
    Object.defineProperty(plain, "native", { value: undefined });
    const ctx = await setup(plain);
    queueNative(ctx, {
      userId: USER,
      spaceId: "spc_x",
      payload: { kind: "contact_card" },
      idempotencyKey: "a",
    });
    await dispatchNative(ctx);
    expect(nativeActions(ctx)[0]).toMatchObject({ status: "unsupported" });

    const ctx2 = await setup();
    queueNative(ctx2, {
      userId: USER,
      payload: { kind: "poll", title: "Q?", options: ["a", "b"] },
      idempotencyKey: "b",
    });
    await dispatchNative(ctx2);
    expect(nativeActions(ctx2)[0]).toMatchObject({
      status: "skipped",
      error: "no conversation for this user yet",
    });
  });

  it("never throws when the provider fails, and skips voice without a speech engine", async () => {
    const sim = new SimMessagingProvider();
    sim.native.sendPoll = async () => {
      throw new Error("photon down");
    };
    const ctx = await setup(sim);
    setSpeechSynth(ctx, async () => null);
    queueNative(ctx, {
      userId: USER,
      spaceId: "spc",
      payload: { kind: "poll", title: "Q?", options: ["a", "b"] },
      idempotencyKey: "p",
    });
    queueNative(ctx, {
      userId: USER,
      spaceId: "spc",
      payload: { kind: "voice", text: "closing bell" },
      idempotencyKey: "v",
    });
    await expect(dispatchNative(ctx)).resolves.toBe(2);
    expect(nativeActions(ctx).map((x) => [x.kind, x.status])).toEqual([
      ["poll", "failed"],
      ["voice", "skipped"],
    ]);
    const events = ctx.events
      .history({ judge: true, limit: 100 })
      .filter((e) => e.type === "native.action");
    expect(events.map((e) => e.payload.status)).toEqual(["queued", "queued", "failed", "skipped"]);
  });
});

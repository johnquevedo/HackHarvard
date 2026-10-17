import { it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { AppConfigSchema } from "@dennis/contracts";
import type { Logger, Clock } from "@dennis/contracts";
import { createDb } from "@dennis/db";
import type { Db } from "@dennis/db";
import type { io } from "socket.io-client";
import { Webhook } from "standardwebhooks";
import { normalizePhotonEvent } from "./normalize.ts";
import { PhotonBetaProvider } from "./provider.ts";
import { SocketIoEventSource } from "./events-socketio.ts";
import { verifyPhotonWebhook } from "./events-webhook.ts";
import { normalizeHandle, createMessagingProvider } from "../index.ts";
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../../fixtures/photon/inbound-text.synthetic.json", import.meta.url),
    "utf8",
  ),
);
const config = AppConfigSchema.parse({
  dennisAdminToken: "test-admin-token-long",
  photonMode: "live",
  photonProjectId: "pho_prj_test",
  photonApiKey: "test-key-no-secret",
  photonAgentUserId: "pho_usr_agent",
});
const clock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
};
const log: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const dbs: Db[] = [];
const sources: SocketIoEventSource[] = [];
function db() {
  const value = createDb();
  dbs.push(value);
  return value;
}
afterEach(async () => {
  for (const source of sources.splice(0)) await source.stop();
  for (const value of dbs.splice(0)) value.$client.close();
});
it("normalizes documented resources from explicitly synthetic fixtures", () => {
  expect(normalizePhotonEvent(fixture, "pho_usr_agent")).toMatchObject({
    provider: "photon",
    mode: "live",
    senderHandle: "alice@example.test",
    text: "Synthetic test message",
  });
  expect(normalizePhotonEvent({ data: { message: fixture } }, "pho_usr_agent")).toBeTruthy();
  expect(
    normalizePhotonEvent(
      { ...fixture, sentBy: { ...fixture.sentBy, id: "pho_usr_agent" } },
      "pho_usr_agent",
    ),
  ).toBeNull();
  expect(
    normalizePhotonEvent({ ...fixture, content: { type: "attachment" } }, "pho_usr_agent"),
  ).toBeNull();
  expect(
    normalizePhotonEvent(
      { ...fixture, space: { ...fixture.space, kind: "group" } },
      "pho_usr_agent",
    ),
  ).toBeNull();
  expect(normalizePhotonEvent({ ...fixture, status: "delivered" }, "pho_usr_agent")).toBeNull();
  expect(normalizePhotonEvent({ unexpected: true }, "pho_usr_agent")).toBeNull();
});
it.each([
  ["(617) 555-0101", "+16175550101"],
  ["16175550101", "+16175550101"],
  ["+44 20 7946 0958", "+442079460958"],
  [" ALICE@EXAMPLE.TEST ", "alice@example.test"],
])("normalizes %s", (input, output) => expect(normalizeHandle(input).handle).toBe(output));
it("rejects invalid handles and labels missing-credential fallback", async () => {
  expect(() => normalizeHandle("not a handle")).toThrow();
  const provider = createMessagingProvider(
    { ...config, photonApiKey: undefined },
    { db: db(), clock, log, ids: { next: () => "unused" } },
  );
  expect(provider.name).toBe("sim");
  expect((await provider.health()).mode).toBe("simulated");
});
const ts = "2026-10-17T12:00:00.000Z";
const user = {
  id: "pho_usr_sender",
  platform: "imessage",
  kind: "human",
  handle: "alice@example.test",
  projectId: "pho_prj_test",
  details: {},
  metadata: {},
};
const space = {
  id: "pho_spc_test",
  platform: "imessage",
  kind: "direct",
  participantIds: ["pho_usr_agent", user.id],
  projectId: "pho_prj_test",
  details: {},
  metadata: {},
};
const message = {
  id: "pho_msg_test",
  platform: "imessage",
  projectId: "pho_prj_test",
  status: "dispatched",
  createdAt: ts,
  updatedAt: ts,
  content: { type: "text", format: "plain", text: "hello" },
  sentBy: { ...user, id: "pho_usr_agent", kind: "agent" },
  space,
  metadata: {},
  timestamps: { dispatchedAt: ts },
};
const req = {
  accountKey: "primary",
  toHandle: "alice@example.test",
  toPhotonUserId: null,
  spaceId: null,
  text: "hello",
  idempotencyKey: "out_test",
};
it("calls user, space and message endpoints with stable idempotency headers", async () => {
  const requests: { url: string; headers: Headers; body: unknown }[] = [];
  const fake: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = request.url;
    const raw = await request.text();
    requests.push({
      url,
      headers: request.headers,
      body: raw ? JSON.parse(raw) : null,
    });
    const payload = url.endsWith("/users")
      ? { ...user, createdAt: ts, updatedAt: ts }
      : url.endsWith("/spaces")
        ? { ...space, createdAt: ts, updatedAt: ts }
        : message;
    return Response.json(payload, {
      status: url.endsWith("/messages") ? 202 : 200,
    });
  };
  const provider = new PhotonBetaProvider(config, { db: db(), clock, log }, { fetch: fake });
  const result = await provider.send(req);
  expect(result).toMatchObject({
    providerMessageId: "pho_msg_test",
    status: "dispatched",
    mode: "live",
  });
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
    "/v1/projects/pho_prj_test/users",
    "/v1/projects/pho_prj_test/spaces",
    "/v1/projects/pho_prj_test/messages",
  ]);
  expect(requests[1]?.headers.get("idempotency-key")).toBe("space:out_test");
  expect(requests[2]?.headers.get("idempotency-key")).toBe("out_test");
  expect(requests[2]?.body).toMatchObject({
    senderId: "pho_usr_agent",
    content: { text: "hello" },
  });
});
it("maps a 403 without retry or exposing provider body", async () => {
  let calls = 0;
  const fake: typeof fetch = async () => {
    calls++;
    return Response.json(
      { title: "Forbidden", status: 403, detail: "sensitive provider text" },
      { status: 403 },
    );
  };
  const provider = new PhotonBetaProvider(config, { db: db(), clock, log }, { fetch: fake });
  await expect(provider.send(req)).rejects.toMatchObject({
    code: "upstream_error",
    details: { retryable: false, providerStatus: 403 },
  });
  expect(calls).toBe(1);
});
it("retries an idempotent 503 with the same key", async () => {
  let calls = 0;
  const keys: string[] = [];
  const fake: typeof fetch = async (input, init) => {
    calls++;
    keys.push(new Request(input, init).headers.get("idempotency-key")!);
    return calls === 1
      ? Response.json({ title: "Unavailable", status: 503 }, { status: 503 })
      : Response.json(message, { status: 202 });
  };
  const provider = new PhotonBetaProvider(config, { db: db(), clock, log }, { fetch: fake });
  await expect(
    provider.send({ ...req, toPhotonUserId: user.id, spaceId: space.id }),
  ).resolves.toMatchObject({ status: "dispatched" });
  expect(calls).toBe(2);
  expect(keys).toEqual(["out_test", "out_test"]);
});
class FakeSocket extends EventEmitter {
  subscriptions: number[] = [];
  io = {
    engine: {
      close: () => {
        this.emit("disconnect");
      },
    },
  };
  timeout() {
    return {
      emit: (
        _event: string,
        _input: unknown,
        callback: (error: unknown, result: { ok: boolean }) => void,
      ) => {
        this.subscriptions.push((_input as { startSeq: number }).startSeq);
        callback(null, { ok: true });
      },
    };
  }
  connect() {
    this.emit("connect");
    return this;
  }
  disconnect() {
    this.emit("disconnect");
    return this;
  }
}
it("checkpoints a Socket.IO cursor only after successful processing", async () => {
  const database = db();
  const socket = new FakeSocket();
  const source = new SocketIoEventSource(
    config,
    database,
    clock,
    log,
    (() => socket) as unknown as typeof io,
  );
  sources.push(source);
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await source.start(async () => {
    await gate;
  });
  socket.emit("delivery", fixture, { seq: 10 });
  await Promise.resolve();
  expect(database.$client.prepare("SELECT * FROM photon_cursors").all()).toHaveLength(0);
  release();
  await source.stop();
  expect(database.$client.prepare("SELECT value FROM photon_cursors").get()).toMatchObject({
    value: "10",
  });
});
it("retains cursor on handler failure and rejects a second live listener", async () => {
  const database = db();
  const socket = new FakeSocket();
  const source = new SocketIoEventSource(
    config,
    database,
    clock,
    log,
    (() => socket) as unknown as typeof io,
  );
  sources.push(source);
  await source.start(async () => {
    throw new Error("database failed");
  });
  const second = new SocketIoEventSource(
    config,
    database,
    clock,
    log,
    (() => new FakeSocket()) as unknown as typeof io,
  );
  sources.push(second);
  await expect(second.start(async () => {})).rejects.toMatchObject({
    code: "conflict",
  });
  socket.emit("delivery", fixture, { seq: 1 });
  await source.stop();
  expect(database.$client.prepare("SELECT * FROM photon_cursors").all()).toHaveLength(0);
});
it("verifies valid signatures and rejects tampered and stale webhooks", () => {
  const secret = "whsec_" + Buffer.from("synthetic-test-secret").toString("base64");
  const signer = new Webhook(secret);
  const raw = JSON.stringify({ data: fixture });
  const now = new Date();
  const headers = {
    "webhook-id": "evt_test",
    "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
    "webhook-signature": signer.sign("evt_test", now, raw),
  };
  expect(verifyPhotonWebhook(raw, headers, secret)).toMatchObject({
    data: { id: fixture.id },
  });
  expect(() => verifyPhotonWebhook(raw + " ", headers, secret)).toThrow();
  const old = new Date(now.getTime() - 10 * 60000);
  expect(() =>
    verifyPhotonWebhook(
      raw,
      {
        ...headers,
        "webhook-timestamp": String(Math.floor(old.getTime() / 1000)),
        "webhook-signature": signer.sign("evt_test", old, raw),
      },
      secret,
    ),
  ).toThrow();
});

it("resumes the durable cursor after restart and ignores the stopped socket", async () => {
  const database = db();
  const firstSocket = new FakeSocket();
  const first = new SocketIoEventSource(
    config,
    database,
    clock,
    log,
    (() => firstSocket) as unknown as typeof io,
  );
  sources.push(first);
  let firstHandled: () => void = () => {};
  const received = new Promise<void>((resolve) => {
    firstHandled = resolve;
  });
  await first.start(async () => {
    firstHandled();
  });
  expect(firstSocket.subscriptions).toEqual([0]);
  firstSocket.emit("delivery", fixture, { seq: 7 });
  await received;
  await first.stop();
  const secondSocket = new FakeSocket();
  const second = new SocketIoEventSource(
    config,
    database,
    clock,
    log,
    (() => secondSocket) as unknown as typeof io,
  );
  sources.push(second);
  let calls = 0;
  let nextHandled: () => void = () => {};
  const next = new Promise<void>((resolve) => {
    nextHandled = resolve;
  });
  await second.start(async () => {
    calls++;
    nextHandled();
  });
  expect(secondSocket.subscriptions).toEqual([7]);
  secondSocket.emit("delivery", fixture, { seq: 7 });
  secondSocket.emit("delivery", fixture, { seq: 8 });
  await next;
  await second.stop();
  expect(calls).toBe(1);
  firstSocket.emit("delivery", fixture, { seq: 99 });
  await Promise.resolve();
  await first.stop();
  expect(
    database.$client
      .prepare("SELECT value FROM photon_cursors WHERE key=?")
      .get("socketio:" + config.photonProjectId),
  ).toMatchObject({ value: "8" });
});

it("rejects group and unrelated sender resources even when the space kind is omitted", () => {
  for (const participantIds of [
    ["pho_usr_agent", fixture.sentBy.id, "pho_usr_third"],
    ["pho_usr_agent", "pho_usr_unrelated"],
    [fixture.sentBy.id, "pho_usr_unrelated"],
  ]) {
    expect(
      normalizePhotonEvent(
        { ...fixture, space: { id: fixture.space.id, participantIds } },
        "pho_usr_agent",
      ),
    ).toBeNull();
  }
});
it("routes recognized direct inbound through the configured account and ignores own-message echoes", async () => {
  let receive: (raw: unknown) => Promise<void> = async () => {};
  const source = {
    async start(handler: typeof receive) {
      receive = handler;
    },
    async stop() {},
  };
  const provider = new PhotonBetaProvider(
    { ...config, photonAccountKey: "demo-account" },
    { db: db(), clock, log },
    {
      source: source as unknown as SocketIoEventSource,
    },
  );
  const messages: unknown[] = [];
  await provider.start(async (message) => {
    messages.push(message);
  });
  await receive({ data: fixture });
  await receive({
    data: { ...fixture, sentBy: { ...fixture.sentBy, id: config.photonAgentUserId } },
  });
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({
    accountKey: "demo-account",
    providerMessageId: fixture.id,
    mode: "live",
  });
  await provider.stop();
  await provider.receive(fixture);
  expect(messages).toHaveLength(1);
});

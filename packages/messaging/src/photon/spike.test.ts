import { it, expect } from "vitest";
import { AppConfigSchema } from "@dennis/contracts";
import {
  discoverPhotonAgent,
  readPhotonCatalog,
  requireSpikeEnvironment,
  redactPhotonFixture,
  runPhotonMessageProbe,
} from "./spike.ts";
import type { CatalogApi, SpikeTransport } from "./spike.ts";
const timestamp = "2026-10-17T12:00:00.000Z";
const config = AppConfigSchema.parse({
  dennisAdminToken: "test-spike-admin-token",
  photonMode: "live",
  photonProjectId: "pho_prj_test",
  photonApiKey: "pho_sk_synthetic",
  photonAgentUserId: "pho_usr_agent",
  demoAliceHandle: "alice@example.test",
  demoBobHandle: "bob@example.test",
});
function api(): CatalogApi {
  return {
    async listWebhookApiVersions() {
      return {
        contractNamespace: "@photon-hq/contracts",
        packageVersion: "0.5.0",
        apiVersions: [
          {
            version: "2026-10-15",
            status: "latest",
            selectable: true,
            retirement: null,
            successor: null,
          },
        ],
      };
    },
    async listWebhookEventTypes() {
      return {
        contractNamespace: "@photon-hq/contracts",
        packageVersion: "0.5.0",
        apiVersion: "2026-10-15",
        status: "latest",
        selectable: true,
        retirement: null,
        successor: null,
        events: [
          {
            type: "message.received",
            audience: "agent",
            schemaProfile: "reader",
            description: "Incoming test message",
            schemaUrl: "https://api.photon.codes/schema",
          },
        ],
      };
    },
    async getWebhookEventSchema() {
      return { type: "object", properties: { data: { type: "object" } } };
    },
  };
}
function event(id: number, handle: string, receivedAt: string) {
  return {
    id: "evt_test",
    type: "message.received",
    data: {
      message: {
        id: "pho_msg_test_" + id,
        platform: "imessage",
        status: "received",
        space: {
          id: "pho_spc_test",
          kind: "direct",
          participantIds: ["pho_usr_agent", "pho_usr_sender"],
        },
        sentBy: { id: "pho_usr_sender", handle, platform: "imessage" },
        receivedBy: { id: "pho_usr_agent" },
        content: { type: "text", format: "plain", text: "PRIVATE LIVE TEXT" },
        timestamps: { receivedAt },
      },
    },
  };
}
it("reports every missing prerequisite without disclosing values", () => {
  expect(() => requireSpikeEnvironment({}, false)).toThrow(
    "PHOTON_PROJECT_ID, PHOTON_API_KEY, DEMO_ALICE_HANDLE, DEMO_BOB_HANDLE",
  );
  expect(() =>
    requireSpikeEnvironment(
      { PHOTON_PROJECT_ID: "pho_prj_test", PHOTON_API_KEY: "pho_sk_synthetic" },
      true,
    ),
  ).not.toThrow();
  expect(() =>
    requireSpikeEnvironment(
      { PHOTON_PROJECT_ID: "wrong", PHOTON_API_KEY: "pho_sk_synthetic" },
      true,
    ),
  ).toThrow("Photon project ID");
});
it("discovers one agent across pages and refuses ambiguous identities", async () => {
  const user = {
    id: "pho_usr_agent",
    platform: "imessage" as const,
    kind: "agent",
    projectId: "pho_prj_test",
    handle: "agent@example.test",
    details: {},
    metadata: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  let calls = 0;
  const discovery = {
    async listUsers() {
      calls++;
      return calls === 1 ? { items: [], nextPageToken: "next" } : { items: [user] };
    },
  };
  expect(await discoverPhotonAgent(discovery, "pho_prj_test")).toBe("pho_usr_agent");
  expect(calls).toBe(2);
  await expect(
    discoverPhotonAgent(
      {
        async listUsers() {
          return { items: [user, { ...user, id: "pho_usr_other" }] };
        },
      },
      "pho_prj_test",
    ),
  ).rejects.toThrow("2 possible");
  expect(await discoverPhotonAgent(discovery, "pho_prj_test", "pho_usr_configured")).toBe(
    "pho_usr_configured",
  );
  expect(calls).toBe(2);
});
it("captures the selected event catalog and rejects an unavailable version", async () => {
  const files = new Map<string, unknown>();
  const catalog = await readPhotonCatalog(api(), "pho_prj_test", async (name, value) => {
    files.set(name, value);
  });
  expect(catalog.apiVersion).toBe("2026-10-15");
  expect(files.get("event-catalog.json")).toMatchObject({
    mode: "live",
    events: [{ type: "message.received" }],
  });
  await expect(
    readPhotonCatalog(api(), "pho_prj_test", async () => {}, "1900-01-01"),
  ).rejects.toThrow("No selectable");
});
it("redacts unknown strings, text, contacts, secrets and metadata while preserving the envelope", () => {
  const raw = {
    ...event(1, "real.person@example.com", timestamp),
    authorization: "Bearer pho_sk_actual",
    privateValue: "do not retain",
    appointmentAt: "2026-11-01T00:00:00.000Z",
    metadata: { note: "private" },
    salary: 999999,
  };
  const result = redactPhotonFixture(raw, new Set(["message.received"]));
  const text = JSON.stringify(result);
  for (const forbidden of [
    "real.person@example.com",
    "PRIVATE LIVE TEXT",
    "pho_sk_actual",
    "do not retain",
    "999999",
    "2026-11-01T00:00:00.000Z",
  ])
    expect(text).not.toContain(forbidden);
  expect(result).toMatchObject({
    type: "message.received",
    data: {
      message: {
        id: "pho_msg_test_1",
        status: "received",
        content: { type: "text", text: "[redacted]" },
        timestamps: { receivedAt: timestamp },
      },
    },
    salary: 0,
    metadata: {},
  });
});
async function probe(
  status: "delivered" | "accepted" = "delivered",
  oneSender = false,
  simulated = false,
) {
  const files = new Map<string, unknown>();
  const catalog = await readPhotonCatalog(api(), "pho_prj_test", async (name, value) => {
    files.set(name, value);
  });
  let now = Date.parse(timestamp) + 1000;
  let handler: (raw: unknown) => Promise<void> = async () => {};
  let count = 0;
  let stops = 0;
  const sends: string[] = [];
  const lines: string[] = [];
  const transport: SpikeTransport = {
    async start(h) {
      handler = h;
    },
    async stop() {
      stops++;
    },
    async send(request) {
      sends.push(request.idempotencyKey);
      return {
        providerMessageId: "pho_msg_out",
        status: "accepted",
        mode: simulated ? "simulated" : "live",
        spaceId: request.spaceId,
        photonUserId: request.toPhotonUserId,
      };
    },
    async readStatus() {
      return status;
    },
  };
  const task = runPhotonMessageProbe({
    config,
    api: api(),
    catalog,
    transport,
    clock: {
      now: () => new Date(now),
      nowIso: () => new Date(now).toISOString(),
    },
    write: async (name, value) => {
      files.set(name, value);
    },
    sleep: async (ms) => {
      now += ms;
    },
    print: (line) => {
      lines.push(line);
      if (line.startsWith("Waiting")) {
        count++;
        void handler(
          event(
            count,
            oneSender || count !== 2 ? config.demoAliceHandle : config.demoBobHandle,
            new Date(now - 10).toISOString(),
          ),
        );
      }
    },
  });
  return {
    task,
    files,
    sends,
    lines,
    get stops() {
      return stops;
    },
  };
}
it("captures three distinct live-shaped samples and confirms delivered with read-back", async () => {
  const state = await probe();
  const report = await state.task;
  expect(report.measurements).toHaveLength(3);
  expect(report.receiptToDeliveryP50Ms).toBe(2010);
  expect(report.bothDemoSendersVerified).toBe(true);
  expect(report.measuredSpan).toContain("not device-to-device");
  expect(state.sends).toEqual([
    "spike:pho_msg_test_1",
    "spike:pho_msg_test_2",
    "spike:pho_msg_test_3",
  ]);
  expect(state.stops).toBe(1);
  expect(state.files.has("inbound-text.json")).toBe(true);
  expect(state.files.has("inbound-event-schema.json")).toBe(true);
  expect(JSON.stringify([...state.files.values()])).not.toContain("PRIVATE LIVE TEXT");
});
it("does not report a passing sample when outbound remains accepted", async () => {
  const state = await probe("accepted");
  await expect(state.task).rejects.toThrow("not delivered");
  expect(state.files.has("spike-results.json")).toBe(false);
  expect(state.lines.some((line) => line.startsWith("PASS outbound"))).toBe(false);
  expect(state.stops).toBe(1);
});
it("records partial evidence but refuses to verify both demo senders from one phone", async () => {
  const state = await probe("delivered", true);
  await expect(state.task).rejects.toThrow("Only one demo sender");
  expect(state.files.get("spike-results.json")).toMatchObject({
    bothDemoSendersVerified: false,
    demoSendersObserved: 1,
  });
  expect(state.stops).toBe(1);
});

it("refuses to label a simulated transport as a live spike", async () => {
  const state = await probe("delivered", false, true);
  await expect(state.task).rejects.toThrow("simulated or fallback");
  expect(state.files.has("spike-results.json")).toBe(false);
  expect(state.stops).toBe(1);
});
it("captures an unsupported live envelope in redacted form and stops before sending", async () => {
  const files = new Map<string, unknown>();
  const catalog = await readPhotonCatalog(api(), "pho_prj_test", async () => {});
  let handler: (raw: unknown) => Promise<void> = async () => {};
  let sends = 0;
  let stops = 0;
  const raw = event(1, config.demoAliceHandle, timestamp);
  const unknown = { type: raw.type, payload: raw.data };
  const task = runPhotonMessageProbe({
    config,
    api: api(),
    catalog,
    clock: { now: () => new Date(timestamp), nowIso: () => timestamp },
    transport: {
      async start(h) {
        handler = h;
      },
      async stop() {
        stops++;
      },
      async send() {
        sends++;
        throw new Error("Must not send");
      },
      async readStatus() {
        return "delivered";
      },
    },
    write: async (name, value) => {
      files.set(name, value);
    },
    print: (line) => {
      if (line.startsWith("Waiting")) void handler(unknown);
    },
    sleep: async () => {},
  });
  await expect(task).rejects.toThrow("envelope does not match");
  expect(files.has("inbound-text.json")).toBe(true);
  expect(JSON.stringify([...files.values()])).not.toContain("PRIVATE LIVE TEXT");
  expect(sends).toBe(0);
  expect(stops).toBe(1);
});
it("times out cleanly without a false inbound success", async () => {
  const catalog = await readPhotonCatalog(api(), "pho_prj_test", async () => {});
  let stops = 0;
  const lines: string[] = [];
  await expect(
    runPhotonMessageProbe({
      config,
      api: api(),
      catalog,
      clock: { now: () => new Date(timestamp), nowIso: () => timestamp },
      transport: {
        async start() {},
        async stop() {
          stops++;
        },
        async send() {
          throw new Error("Must not send");
        },
        async readStatus() {
          return "delivered";
        },
      },
      write: async () => {},
      print: (line) => lines.push(line),
      sleep: async () => {},
      timeoutMs: 1,
    }),
  ).rejects.toThrow("timed out");
  expect(stops).toBe(1);
  expect(lines.some((line) => line.startsWith("PASS"))).toBe(false);
});

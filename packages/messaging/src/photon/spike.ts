import type { Photon } from "@photon-ai/api";
import type {
  AppConfig,
  Clock,
  InboundMessageT,
  ProviderSendRequestT,
  ProviderSendResultT,
} from "@dennis/contracts";
import { normalizePhotonEvent } from "./normalize.ts";
import { normalizeHandle } from "../index.ts";
export class PhotonSpikeError extends Error {}
export type CatalogApi = Pick<
  Photon["projects"],
  "listWebhookApiVersions" | "listWebhookEventTypes" | "getWebhookEventSchema"
>;
export type SpikeWriter = (filename: string, value: unknown) => Promise<void>;
export interface SpikeTransport {
  start(handler: (raw: unknown) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  send(request: ProviderSendRequestT): Promise<ProviderSendResultT>;
  readStatus(messageId: string): Promise<ProviderSendResultT["status"]>;
}
export function requireSpikeEnvironment(env: NodeJS.ProcessEnv, catalogOnly: boolean): void {
  const required = [
    "PHOTON_PROJECT_ID",
    "PHOTON_API_KEY",
    ...(catalogOnly ? [] : ["DEMO_ALICE_HANDLE", "DEMO_BOB_HANDLE"]),
  ];
  const missing = required.filter((key) => !env[key]?.trim());
  if (env.PHOTON_PROJECT_ID && !/^pho_prj_[A-Za-z0-9_-]+$/.test(env.PHOTON_PROJECT_ID))
    throw new PhotonSpikeError("PHOTON_PROJECT_ID must be a Photon project ID.");
  if (missing.length)
    throw new PhotonSpikeError(
      "NOT VERIFIED: configure " + missing.join(", ") + " locally. No live request was made.",
    );
  if (!catalogOnly) {
    const normalized: string[] = [];
    for (const key of ["DEMO_ALICE_HANDLE", "DEMO_BOB_HANDLE"]) {
      try {
        normalized.push(normalizeHandle(env[key]!).handle);
      } catch {
        throw new PhotonSpikeError(key + " must be a valid phone number or email handle.");
      }
    }
    if (new Set(normalized).size !== 2)
      throw new PhotonSpikeError("The two demo senders must have distinct handles.");
  }
}
export async function discoverPhotonAgent(
  api: Pick<Photon["projects"], "listUsers">,
  projectId: string,
  configured?: string,
): Promise<string> {
  if (configured) {
    if (!/^pho_usr_[A-Za-z0-9_-]+$/.test(configured))
      throw new PhotonSpikeError("PHOTON_AGENT_USER_ID must be a Photon user ID.");
    return configured;
  }
  const candidates = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await api.listUsers({
      path: { id: projectId },
      query: {
        platform: "imessage",
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      },
    });
    for (const user of result.items)
      if (user.platform === "imessage" && user.kind === "agent" && typeof user.id === "string")
        candidates.add(user.id);
    pageToken = result.nextPageToken;
    if (!pageToken) break;
    if (page === 19)
      throw new PhotonSpikeError(
        "Agent discovery exceeded its page limit; set PHOTON_AGENT_USER_ID explicitly.",
      );
  }
  if (candidates.size !== 1)
    throw new PhotonSpikeError(
      `Found ${candidates.size} possible iMessage agents; configure PHOTON_AGENT_USER_ID explicitly.`,
    );
  return [...candidates][0]!;
}
export async function readPhotonCatalog(
  api: CatalogApi,
  projectId: string,
  write: SpikeWriter,
  requestedVersion?: string,
) {
  const versions = await api.listWebhookApiVersions({ path: { projectId } });
  if (!versions) throw new PhotonSpikeError("Photon returned no webhook API version catalog.");
  const selectable = versions.apiVersions.filter((version) => version.selectable);
  const selected = requestedVersion
    ? selectable.find((version) => version.version === requestedVersion)
    : (selectable.find((version) => version.status === "latest") ??
      selectable.sort((a, b) => b.version.localeCompare(a.version))[0]);
  if (!selected)
    throw new PhotonSpikeError("No selectable webhook API version matched the request.");
  const catalog = await api.listWebhookEventTypes({
    path: { projectId },
    query: { apiVersion: selected.version },
  });
  if (
    !catalog ||
    !catalog.selectable ||
    catalog.apiVersion !== selected.version ||
    !catalog.events.length
  )
    throw new PhotonSpikeError("Photon returned no matching selectable event catalog.");
  await write("event-catalog.json", {
    mode: "live",
    apiVersion: catalog.apiVersion,
    events: catalog.events.map(({ type, audience, schemaProfile }) => ({
      type,
      audience,
      schemaProfile,
    })),
  });
  return catalog;
}
export function redactPhotonFixture(raw: unknown, eventTypes: ReadonlySet<string>): unknown {
  const enums = new Set([
    "imessage",
    "received",
    "dispatched",
    "accepted",
    "delivered",
    "failed",
    "text",
    "plain",
    "direct",
    "group",
    "human",
    "agent",
  ]);
  const sensitive = /secret|token|authorization|password|api.?key/i;
  function visit(value: unknown, key: string, depth: number): unknown {
    if (depth > 20) return "[redacted]";
    if (sensitive.test(key)) return "[redacted]";
    if (key === "metadata" || key === "headers") return {};
    if (Array.isArray(value)) return value.map((item) => visit(item, key, depth + 1));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([field, item], index) => [
          /^[A-Za-z_$][A-Za-z0-9_$-]{0,79}$/.test(field) ? field : "redacted_field_" + index,
          visit(item, field, depth + 1),
        ]),
      );
    if (typeof value === "string") {
      if (key === "handle") return value.includes("@") ? "redacted@example.test" : "+15555550123";
      if (
        ["type", "platform", "status", "format", "kind"].includes(key) &&
        (enums.has(value) || eventTypes.has(value))
      )
        return value;
      if (
        ["id", "projectId", "senderId", "recipientId", "participantIds"].includes(key) &&
        /^pho_(?:msg|usr|spc|prj)_[A-Za-z0-9_-]+$/.test(value)
      )
        return value;
      if (
        [
          "receivedAt",
          "createdAt",
          "updatedAt",
          "dispatchedAt",
          "acceptedAt",
          "deliveredAt",
          "failedAt",
        ].includes(key) &&
        /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value) &&
        Number.isFinite(Date.parse(value))
      )
        return value;
      return "[redacted]";
    }
    if (typeof value === "number") return 0;
    return typeof value === "boolean" || value === null ? value : null;
  }
  return visit(raw, "", 0);
}
function findResource(raw: unknown, depth = 0): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || depth > 8) return null;
  const value = raw as Record<string, unknown>;
  if (
    value.status === "received" &&
    value.platform === "imessage" &&
    value.sentBy &&
    typeof value.sentBy === "object"
  )
    return value;
  for (const child of Object.values(value)) {
    const found = findResource(child, depth + 1);
    if (found) return found;
  }
  return null;
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
export async function runPhotonMessageProbe(options: {
  config: AppConfig;
  api: CatalogApi;
  catalog: Awaited<ReturnType<typeof readPhotonCatalog>>;
  transport: SpikeTransport;
  clock: Clock;
  write: SpikeWriter;
  print: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  samples?: number;
  timeoutMs?: number;
}) {
  const { config, api, catalog, transport, clock, write, print, sleep } = options;
  const samples = options.samples ?? 3;
  if (!Number.isInteger(samples) || samples < 1 || samples > 10)
    throw new PhotonSpikeError("samples must be an integer between 1 and 10.");
  if (!config.photonAgentUserId)
    throw new PhotonSpikeError("No Photon agent identity was selected.");
  const allowed = new Set([
    normalizeHandle(config.demoAliceHandle).handle,
    normalizeHandle(config.demoBobHandle).handle,
  ]);
  if (allowed.size !== 2)
    throw new PhotonSpikeError("The two demo senders must have distinct handles.");
  const eventTypes = new Set(catalog.events.map((event) => event.type));
  const seen = new Set<string>();
  const senders = new Set<string>();
  const queue: { message: InboundMessageT; eventType: string }[] = [];
  let wake = () => {};
  let captureFailure: unknown;
  let pendingWrite = Promise.resolve();
  const measurements: {
    inboundLagMs: number;
    outboundDeliveryMs: number;
    receiptToDeliveryMs: number;
  }[] = [];
  try {
    await transport.start(async (raw) => {
      const resource = findResource(raw);
      if (!resource) return;
      const sender = resource.sentBy as Record<string, unknown>;
      let handle: string;
      try {
        handle = normalizeHandle(String(sender.handle ?? "")).handle;
      } catch {
        return;
      }
      if (!allowed.has(handle) || sender.id === config.photonAgentUserId) return;
      const message = normalizePhotonEvent(raw, config.photonAgentUserId!);
      const type =
        raw && typeof raw === "object" ? String((raw as Record<string, unknown>).type ?? "") : "";
      if (message && seen.has(message.providerMessageId)) return;
      const filename = seen.size === 0 ? "inbound-text.json" : `inbound-text-${seen.size + 1}.json`;
      try {
        pendingWrite = write(filename, redactPhotonFixture(raw, eventTypes));
        await pendingWrite;
        if (!message || !eventTypes.has(type))
          throw new PhotonSpikeError(
            "Redacted live event captured, but its envelope does not match the normalizer and selected catalog. Inspect the fixture before continuing.",
          );
        seen.add(message.providerMessageId);
        queue.push({
          message: { ...message, senderHandle: handle },
          eventType: type,
        });
      } catch (error) {
        captureFailure = error;
      } finally {
        wake();
      }
    });
    for (let sample = 0; sample < samples; sample++) {
      print(
        `Waiting for demo text ${sample + 1}/${samples}. Use both configured demo phones across the samples.`,
      );
      const deadline = clock.now().getTime() + (options.timeoutMs ?? 60000);
      while (!queue.length && !captureFailure) {
        const remaining = deadline - clock.now().getTime();
        if (remaining <= 0)
          throw new PhotonSpikeError(
            "NOT VERIFIED: timed out waiting for a recognized demo inbound event.",
          );
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new PhotonSpikeError(
                  "NOT VERIFIED: timed out waiting for a recognized demo inbound event.",
                ),
              ),
            remaining,
          );
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
          if (queue.length || captureFailure) wake();
        });
      }
      if (captureFailure) throw captureFailure;
      const { message, eventType } = queue.shift()!;
      const started = clock.now().getTime();
      const receivedAt = Date.parse(message.receivedAt);
      const inboundLagMs = started - receivedAt;
      if (inboundLagMs < 0)
        throw new PhotonSpikeError(
          "Provider receipt is in the future; synchronize clocks before measuring latency.",
        );
      print(`PASS inbound captured (${eventType}); receipt lag ${inboundLagMs} ms`);
      const schema = await api.getWebhookEventSchema({
        path: { projectId: config.photonProjectId!, eventType },
        query: { apiVersion: catalog.apiVersion },
      });
      if (!schema) throw new PhotonSpikeError("Photon returned no incoming event schema.");
      await write("inbound-event-schema.json", {
        apiVersion: catalog.apiVersion,
        eventType,
        schema,
      });
      const sendStarted = clock.now().getTime();
      const result = await transport.send({
        accountKey: config.photonAccountKey,
        toHandle: message.senderHandle,
        toPhotonUserId: message.providerSenderId,
        spaceId: message.providerSpaceId,
        text: "Dennis Photon Beta spike received your test message.",
        idempotencyKey: "spike:" + message.providerMessageId,
      });
      if (result.mode !== "live")
        throw new PhotonSpikeError(
          "NOT VERIFIED: the message transport returned a simulated or fallback result.",
        );
      let status = result.status;
      for (const ms of [2000, 3000, 5000]) {
        if (status === "delivered" || status === "failed") break;
        await sleep(ms);
        status = await transport.readStatus(result.providerMessageId);
      }
      if (status !== "delivered")
        throw new PhotonSpikeError(
          "NOT VERIFIED: outbound status is " + status + ", not delivered.",
        );
      const finished = clock.now().getTime();
      if (finished < sendStarted || finished < receivedAt)
        throw new PhotonSpikeError(
          "Clock changed during the probe; repeat the timing measurement.",
        );
      measurements.push({
        inboundLagMs,
        outboundDeliveryMs: finished - sendStarted,
        receiptToDeliveryMs: finished - receivedAt,
      });
      senders.add(message.senderHandle);
      print(`PASS outbound delivered for sample ${sample + 1}`);
    }
    const report = {
      mode: "live",
      capturedAt: clock.nowIso(),
      projectId: config.photonProjectId,
      agentUserId: config.photonAgentUserId,
      apiVersion: catalog.apiVersion,
      measurements,
      demoSendersObserved: senders.size,
      receiptToDeliveryP50Ms:
        measurements.length >= 3 ? median(measurements.map((m) => m.receiptToDeliveryMs)) : null,
      measuredSpan: "provider receipt to outbound delivered; not device-to-device round trip",
      bothDemoSendersVerified: senders.size === 2,
      echoBehavior: "not_manually_verified",
      firstOutboundBeforeInbound: "not_tested",
    };
    await write("spike-results.json", report);
    if (senders.size !== 2)
      throw new PhotonSpikeError(
        "Only one demo sender was observed. Repeat the spike using both demo phones; partial measurements were saved.",
      );
    return report;
  } finally {
    wake();
    await pendingWrite.catch(() => {});
    await transport.stop();
  }
}

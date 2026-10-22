import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDb } from "../packages/db/src/index.ts";
import { loadConfig, createClock, createLogger } from "../packages/platform/src/index.ts";
import { normalizeHandle } from "../packages/messaging/src/index.ts";
import { createPhotonClient, photonError } from "../packages/messaging/src/photon/client.ts";
import { photonPreflight } from "../packages/messaging/src/photon/preflight.ts";
import { PhotonBetaProvider, PhotonSpectrumProvider } from "../packages/messaging/src/index.ts";

function safeErrorChain(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    parts.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return [process.env.PHOTON_PROJECT_SECRET, process.env.PHOTON_PROJECT_ID]
    .filter((value): value is string => Boolean(value))
    .reduce(
      (message, value) => message.replaceAll(value, "[redacted]"),
      [...new Set(parts)].join(": "),
    );
}

async function spectrumDoctor(preflightOnly: boolean, sendFirst: boolean): Promise<void> {
  const required = [
    "PHOTON_PROJECT_ID",
    "PHOTON_PROJECT_SECRET",
    "DEMO_JOHN_HANDLE",
    "DEMO_STEVEN_HANDLE",
    "DEMO_ISAAC_HANDLE",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length)
    throw new Error("NOT VERIFIED: configure " + missing.join(", ") + " in .env.");
  const config = loadConfig({
    ...process.env,
    PHOTON_MODE: "live",
    PHOTON_SPACE_MODE: process.env.PHOTON_SPACE_MODE ?? "either",
    DENNIS_ADMIN_TOKEN: process.env.DENNIS_ADMIN_TOKEN ?? randomUUID(),
  });
  const allowed = new Set(
    [config.demoJohnHandle, config.demoStevenHandle, config.demoIsaacHandle].map(
      (handle) => normalizeHandle(handle).handle,
    ),
  );
  if (allowed.size !== 3) throw new Error("Demo senders must be distinct.");
  const db = createDb(":memory:");
  const clock = createClock();
  const log = createLogger();
  const provider = new PhotonSpectrumProvider(config, { db, clock, log });
  const unexpectedSenders = new Set<string>();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const health = await provider.health();
    if (!health.healthy) throw new Error("NOT VERIFIED: " + health.detail);
    process.stdout.write("PASS Photon Spectrum Cloud credentials accepted\n");
    if (preflightOnly) return;
    let resolveInbound: (message: {
      handle: string;
      senderId: string | null;
      spaceId: string | null;
      id: string;
      lagMs: number;
      kind: "direct" | "group" | undefined;
    }) => void = () => {};
    const inbound = new Promise<{
      handle: string;
      senderId: string | null;
      spaceId: string | null;
      id: string;
      lagMs: number;
      kind: "direct" | "group" | undefined;
    }>((resolve) => {
      resolveInbound = resolve;
    });
    await provider.start(async (message) => {
      let handle: string;
      try {
        handle = normalizeHandle(message.senderHandle).handle;
      } catch {
        return;
      }
      if (!allowed.has(handle)) {
        const masked = handle.includes("@")
          ? `email ending ${handle.slice(-4)}`
          : `phone ending ${handle.slice(-4)}`;
        if (!unexpectedSenders.has(masked)) {
          unexpectedSenders.add(masked);
          process.stdout.write(
            `OBSERVED inbound from an unconfigured ${masked}; update the matching DEMO_*_HANDLE value.\n`,
          );
        }
        return;
      }
      resolveInbound({
        handle,
        senderId: message.providerSenderId,
        spaceId: message.providerSpaceId,
        id: message.providerMessageId,
        lagMs: clock.now().getTime() - Date.parse(message.receivedAt),
        kind: message.providerSpaceKind,
      });
    });
    if (sendFirst) {
      await provider.send({
        accountKey: config.photonAccountKey,
        toHandle: config.demoJohnHandle,
        toPhotonUserId: null,
        spaceId: null,
        text: "Dennis diagnostic: Photon outbound is connected. Reply PING to this direct message.",
        idempotencyKey: `doctor-outbound:${randomUUID()}`,
      });
      process.stdout.write("PASS outbound diagnostic accepted for John's configured handle.\n");
    }
    process.stdout.write(
      "Waiting up to 60 seconds for a new iMessage from either configured demo handle.\n",
    );
    const message = await Promise.race([
      inbound,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                unexpectedSenders.size
                  ? "NOT VERIFIED: Photon received iMessage traffic, but its sender does not match a configured demo handle."
                  : "NOT VERIFIED: no iMessage traffic reached this Photon project within 60 seconds.",
              ),
            ),
          60000,
        );
      }),
    ]);
    const result = await provider.send({
      accountKey: config.photonAccountKey,
      toHandle: message.handle,
      toPhotonUserId: message.senderId,
      spaceId: message.spaceId,
      text: "Dennis Photon Spectrum connectivity check received.",
      idempotencyKey: "doctor:" + message.id,
    });
    process.stdout.write(
      `PASS ${message.kind ?? "unknown"} inbound and outbound accepted; observed inbound lag ${message.lagMs} ms; message ${result.providerMessageId}\n`,
    );
    process.stdout.write(
      "Confirm the reply appeared in Messages. Spectrum acknowledges provider acceptance but does not expose a final delivered receipt here.\n",
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    try {
      await provider.stop();
    } finally {
      db.$client.close();
    }
  }
}

export async function photonDoctor(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--help")) {
    process.stdout.write(
      "Usage: pnpm photon:doctor [--preflight-only] [--send-first]\nPreflight validates the configured Photon credentials. A full run waits for one new demo iMessage and replies once. --send-first sends John a diagnostic DM after the listener starts.\n",
    );
    return;
  }
  if (args.some((arg) => arg !== "--preflight-only" && arg !== "--send-first"))
    throw new Error("Unknown doctor option. Use --help.");
  if (process.env.PHOTON_PROJECT_SECRET) {
    await spectrumDoctor(args.includes("--preflight-only"), args.includes("--send-first"));
    return;
  }
  const required = [
    "PHOTON_PROJECT_ID",
    "PHOTON_API_KEY",
    "PHOTON_AGENT_USER_ID",
    "DEMO_ALICE_HANDLE",
    "DEMO_BOB_HANDLE",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length)
    throw new Error(
      "NOT VERIFIED: configure " +
        missing.join(", ") +
        " in the environment. SIMULATED messaging remains active.",
    );
  const config = loadConfig({
    ...process.env,
    PHOTON_MODE: "live",
    DENNIS_ADMIN_TOKEN: process.env.DENNIS_ADMIN_TOKEN ?? randomUUID(),
  });
  if (config.photonInbound !== "socketio")
    throw new Error(
      "NOT VERIFIED: doctor requires the Socket.IO integration listener; stop the server before running it.",
    );
  const allowed = new Set(
    [config.demoAliceHandle, config.demoBobHandle].map((handle) => normalizeHandle(handle).handle),
  );
  if (allowed.size !== 2) {
    throw new Error("Demo senders must be distinct.");
  }
  const db = createDb(":memory:");
  const clock = createClock();
  const log = createLogger();
  const client = createPhotonClient(config);
  const provider = new PhotonBetaProvider(config, { db, clock, log }, { client });
  let resolveInbound: (value: {
    handle: string;
    senderId: string | null;
    spaceId: string | null;
    id: string;
    lagMs: number;
  }) => void = () => {};
  const inbound = new Promise<{
    handle: string;
    senderId: string | null;
    spaceId: string | null;
    id: string;
    lagMs: number;
  }>((resolve) => {
    resolveInbound = resolve;
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const preflight = await photonPreflight(client.projects, config, clock);
    process.stdout.write(
      "Photon line configuration: " + preflight.lineMode + "; delivery remains unverified.\n",
    );
    for (const sender of preflight.senders)
      process.stdout.write(
        sender.label +
          " " +
          sender.maskedHandle +
          ": assigned=" +
          (sender.assigned ?? "dedicated-mode") +
          "; inbound in last 30m=" +
          (sender.recentInboundAt ?? "not observed") +
          "\n",
      );
    if (!preflight.assignmentsComplete || !preflight.messagesComplete)
      throw new Error(
        "NOT VERIFIED: preflight pagination limit reached; absence cannot be established.",
      );
    if (args.includes("--preflight-only")) {
      process.stdout.write(
        "Read-only preflight complete. No listener or outbound message was started.\n",
      );
      return;
    }
    if (preflight.lineMode === "shared" && preflight.senders.some((sender) => !sender.assigned))
      throw new Error("NOT VERIFIED: both demo senders need active shared-line assignments.");
    const health = await provider.health();
    if (!health.healthy) throw new Error("Photon API health failed");
    process.stdout.write("PASS Photon Beta API reachable\n");
    await provider.start(async (message) => {
      let handle: string;
      try {
        handle = normalizeHandle(message.senderHandle).handle;
      } catch {
        return;
      }
      if (!allowed.has(handle)) return;
      resolveInbound({
        handle,
        senderId: message.providerSenderId,
        spaceId: message.providerSpaceId,
        id: message.providerMessageId,
        lagMs: clock.now().getTime() - Date.parse(message.receivedAt),
      });
    });
    process.stdout.write(
      "Waiting up to 60 seconds for a new text from a configured demo phone. Stop any other live listener first.\n",
    );
    const message = await Promise.race([
      inbound,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "NOT VERIFIED: no normalized demo inbound within 60 seconds; inspect the live envelope",
              ),
            ),
          60000,
        );
      }),
    ]);
    if (message.lagMs < 0)
      throw new Error("NOT VERIFIED: provider timestamp is in the future; synchronize clocks.");
    process.stdout.write(`PASS inbound received; observed receipt lag ${message.lagMs} ms\n`);
    const started = clock.now().getTime();
    const result = await provider.send({
      accountKey: config.photonAccountKey,
      toHandle: message.handle,
      toPhotonUserId: message.senderId,
      spaceId: message.spaceId,
      text: "Dennis Photon Beta connectivity check received.",
      idempotencyKey: "doctor:" + message.id,
    });
    let status = result.status;
    for (const ms of [2000, 3000, 5000]) {
      if (status === "delivered" || status === "failed") break;
      await delay(ms);
      status = await provider.readStatus(result.providerMessageId);
    }
    if (status !== "delivered")
      throw new Error("NOT VERIFIED: outbound status is " + status + ", not delivered");
    process.stdout.write(
      `PASS outbound delivered; delivery latency ${clock.now().getTime() - started} ms\n`,
    );
    process.stdout.write(
      "Live path passed once. Three measured runs are required before reporting a p50. Echo and first-outbound behavior still need manual checks.\n",
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    try {
      await provider.stop();
    } finally {
      db.$client.close();
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await photonDoctor();
  } catch (error) {
    const diagnostic = process.env.PHOTON_PROJECT_SECRET
      ? safeErrorChain(error)
      : error instanceof Error &&
          (error.message.startsWith("NOT VERIFIED:") ||
            error.message.startsWith("Unknown doctor") ||
            error.message.startsWith("Demo senders") ||
            (Boolean(process.env.PHOTON_PROJECT_SECRET) &&
              error.message.startsWith("Photon Spectrum")))
        ? error.message
        : photonError(error).message;
    process.stderr.write(diagnostic + "\n");
    process.exitCode = 1;
  }
}

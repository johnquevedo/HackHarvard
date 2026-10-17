import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDb } from "../packages/db/src/index.ts";
import { loadConfig, createClock, createLogger } from "../packages/platform/src/index.ts";
import { normalizeHandle } from "../packages/messaging/src/index.ts";
import { createPhotonClient, photonError } from "../packages/messaging/src/photon/client.ts";
import { photonPreflight } from "../packages/messaging/src/photon/preflight.ts";
import { PhotonBetaProvider } from "../packages/messaging/src/index.ts";
export async function photonDoctor(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--help")) {
    process.stdout.write(
      "Usage: pnpm photon:doctor [--preflight-only]\nPreflight is read-only. A full run waits for one new demo text and replies once. Three consecutive live runs and manual phone timing/echo checks remain required.\n",
    );
    return;
  }
  if (args.some((arg) => arg !== "--preflight-only"))
    throw new Error("Unknown doctor option. Use --help.");
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
    process.stderr.write(
      (error instanceof Error &&
      (error.message.startsWith("NOT VERIFIED:") ||
        error.message.startsWith("Unknown doctor") ||
        error.message.startsWith("Demo senders"))
        ? error.message
        : photonError(error).message) + "\n",
    );
    process.exitCode = 1;
  }
}

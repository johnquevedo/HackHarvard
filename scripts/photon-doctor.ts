import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDb } from "../packages/db/src/index.ts";
import { loadConfig, createClock, createLogger } from "../packages/platform/src/index.ts";
import { PhotonBetaProvider } from "../packages/messaging/src/index.ts";
export async function photonDoctor(): Promise<void> {
  const required = ["PHOTON_PROJECT_ID", "PHOTON_API_KEY", "PHOTON_AGENT_USER_ID"];
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
  const db = createDb(":memory:");
  const clock = createClock();
  const log = createLogger();
  const provider = new PhotonBetaProvider(config, { db, clock, log });
  const allowed = new Set([config.demoAliceHandle, config.demoBobHandle]);
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
    const health = await provider.health();
    if (!health.healthy) throw new Error("Photon API health failed");
    process.stdout.write("PASS Photon Beta API reachable\n");
    await provider.start(async (message) => {
      if (!allowed.has(message.senderHandle)) return;
      resolveInbound({
        handle: message.senderHandle,
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
    await provider.stop();
    db.$client.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await photonDoctor();
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : "Photon doctor failed") + "\n");
    process.exitCode = 1;
  }
}

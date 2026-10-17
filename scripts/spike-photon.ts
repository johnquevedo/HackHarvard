import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createDb } from "../packages/db/src/index.ts";
import { loadConfig, createClock, createLogger } from "../packages/platform/src/index.ts";
import { PhotonBetaProvider } from "../packages/messaging/src/index.ts";
import { createPhotonClient, photonError } from "../packages/messaging/src/photon/client.ts";
import { SocketIoEventSource } from "../packages/messaging/src/photon/events-socketio.ts";
import {
  PhotonSpikeError,
  requireSpikeEnvironment,
  discoverPhotonAgent,
  readPhotonCatalog,
  runPhotonMessageProbe,
} from "../packages/messaging/src/photon/spike.ts";
async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(
      "Usage: node --env-file=.env.local --import tsx scripts/spike-photon.ts [--catalog-only] [--samples 3]\nCatalog mode requires PHOTON_PROJECT_ID and PHOTON_API_KEY. Live mode also requires DEMO_ALICE_HANDLE and DEMO_BOB_HANDLE. PHOTON_AGENT_USER_ID is discovered only when unambiguous.\n",
    );
    return;
  }
  let catalogOnly = false;
  let samples = 3;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--catalog-only") catalogOnly = true;
    else if (args[index] === "--samples") {
      samples = Number(args[++index]);
    } else throw new PhotonSpikeError("Unknown spike option. Use --help.");
  }
  if (!Number.isInteger(samples) || samples < 1 || samples > 10)
    throw new PhotonSpikeError("--samples requires an integer between 1 and 10.");
  requireSpikeEnvironment(process.env, catalogOnly);
  let config = loadConfig({
    ...process.env,
    PHOTON_MODE: "live",
    DENNIS_ADMIN_TOKEN: process.env.DENNIS_ADMIN_TOKEN ?? randomUUID(),
  });
  const client = createPhotonClient(config);
  const directory = resolve("fixtures/photon");
  async function write(filename: string, value: unknown): Promise<void> {
    await mkdir(directory, { recursive: true });
    const target = join(directory, filename);
    const temporary = target + ".tmp";
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(temporary, target);
  }
  const catalog = await readPhotonCatalog(client.projects, config.photonProjectId!, write);
  process.stdout.write(
    `PASS event type listing: ${catalog.events.length} types for API ${catalog.apiVersion}\n`,
  );
  if (catalogOnly) {
    process.stdout.write(
      "Catalog-only check complete. No listener or outbound message was started.\n",
    );
    return;
  }
  if (config.photonInbound !== "socketio")
    throw new PhotonSpikeError("This spike uses Socket.IO; configure PHOTON_INBOUND=socketio.");
  const agentId = await discoverPhotonAgent(
    client.projects,
    config.photonProjectId!,
    config.photonAgentUserId,
  );
  config = { ...config, photonAgentUserId: agentId };
  process.stdout.write(`Selected Photon agent user ID: ${agentId}\n`);
  const db = createDb(":memory:");
  const clock = createClock();
  const log = createLogger();
  const source = new SocketIoEventSource(config, db, clock, log);
  const provider = new PhotonBetaProvider(config, { db, clock, log }, { client, source });
  try {
    const health = await provider.health();
    if (!health.healthy) throw new PhotonSpikeError("Photon Beta API health failed.");
    process.stdout.write(
      "PASS Photon Beta API reachable. Stop any integration server before the single-listener spike.\n",
    );
    const report = await runPhotonMessageProbe({
      config,
      api: client.projects,
      catalog,
      transport: {
        start: (handler) => source.start(handler),
        stop: () => provider.stop(),
        send: (request) => provider.send(request),
        readStatus: (id) => provider.readStatus(id),
      },
      clock,
      write,
      print: (line) => process.stdout.write(line + "\n"),
      sleep: delay,
      samples,
    });
    process.stdout.write(
      `Live samples: ${report.measurements.length}; provider receipt-to-delivery p50: ${report.receiptToDeliveryP50Ms ?? "not enough samples"} ms. Device-to-device timing, echo and first-outbound behavior remain manual checks.\n`,
    );
  } finally {
    try {
      await provider.stop();
    } finally {
      db.$client.close();
    }
  }
}
try {
  await run();
} catch (error) {
  process.stderr.write(
    (error instanceof PhotonSpikeError ? error.message : photonError(error).message) + "\n",
  );
  process.exitCode = 1;
}

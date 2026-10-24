import { applyAckModeFromEnv } from "../apps/web/src/lib/photon-native-breadth/apply-ack-mode.ts";

interface LivePlatform {
  events: { emit(event: unknown): Promise<void> };
  db: { $client: Parameters<typeof applyAckModeFromEnv>[0] };
}

export async function seedDemo(): Promise<void> {
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<Record<string, unknown>>;
  const platform = await importer("@dennis/platform/foundation");
  const configMod = await importer("@dennis/platform/config");
  const purchasing = await importer("@dennis/purchasing");
  const shortme = await importer("@dennis/shortme");
  const loadConfig = configMod.loadConfig as (env: NodeJS.ProcessEnv) => unknown;
  const createPlatform = platform.createPlatform as (opts: {
    config: unknown;
  }) => Promise<LivePlatform>;
  const ctx = await createPlatform({ config: loadConfig(process.env) });
  await (purchasing.purchasingModule as { seed: (value: LivePlatform) => Promise<void> }).seed(ctx);
  await (shortme.shortmeModule as { seed: (value: LivePlatform) => Promise<void> }).seed(ctx);
  // Foundation only sets ackMode on first insert; re-apply so DENNIS_ACK_MODE sticks.
  applyAckModeFromEnv(ctx.db.$client);
}

const entry = process.argv[1]?.replace(/\\/g, "/");
if (entry?.endsWith("scripts/seed-demo.ts")) {
  await seedDemo();
  console.log("seed finished");
}

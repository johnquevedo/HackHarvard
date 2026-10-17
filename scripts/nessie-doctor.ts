import { NessieBankingProvider, SimBankingProvider } from "../packages/purchasing/src/bank/index.js";

const clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
};

const log = {
  debug: (message: string, meta?: Record<string, unknown>) => console.debug(message, meta ?? {}),
  info: (message: string, meta?: Record<string, unknown>) => console.info(message, meta ?? {}),
  warn: (message: string, meta?: Record<string, unknown>) => console.warn(message, meta ?? {}),
  error: (message: string, meta?: Record<string, unknown>) => console.error(message, meta ?? {}),
};

async function run(): Promise<void> {
  const mode = process.env.NESSIE_MODE ?? "sim";
  const runTag = process.env.NESSIE_RUN_TAG ?? "doctor";
  const provider =
    mode === "live"
      ? new NessieBankingProvider({
          baseUrl: process.env.NESSIE_BASE_URL ?? "https://prod-api.nessieisreal.com",
          apiKey: process.env.NESSIE_API_KEY ?? "",
          clock,
          log,
        })
      : new SimBankingProvider(clock);

  if (mode === "live" && !process.env.NESSIE_API_KEY) {
    throw new Error("NESSIE_API_KEY is required for the live Nessie doctor");
  }

  const health = await provider.health();
  console.log(`${health.healthy ? "PASS" : "FAIL"} Nessie mode=${health.mode} detail=${health.detail}`);
  if (!health.healthy) {
    process.exitCode = 1;
    return;
  }

  const result = await provider.ensureSeeded({
    members: [
      { linkKey: "usr_demo_alice", displayName: "Alice", startCents: 150_000 },
      { linkKey: "usr_demo_bob", displayName: "Bob", startCents: 120_000 },
    ],
    poolStartCents: 0,
    runTag,
  });
  console.log(
    `${result.provider === "sim" ? "SIMULATED BANK" : "LIVE NESSIE"} created=${result.created} reused=${result.reused}`,
  );
  for (const account of result.accounts) {
    const balance = await provider.getBalance(account.accountRef);
    console.log(`${account.ownerKey} account=...${account.last4} balanceCents=${balance.balanceCents}`);
  }
}

run().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

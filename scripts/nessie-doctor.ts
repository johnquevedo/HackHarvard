import type { BankingProvider } from "@dennis/contracts";

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
  if (mode === "live" && !process.env.NESSIE_API_KEY) {
    throw new Error("NESSIE_API_KEY is required for the live Nessie doctor");
  }
  let provider: BankingProvider;
  if (mode === "live") {
    const { NessieBankingProvider } = await import("../packages/purchasing/src/bank/nessie.js");
    provider = new NessieBankingProvider({
      baseUrl: process.env.NESSIE_BASE_URL ?? "https://prod-api.nessieisreal.com",
      apiKey: process.env.NESSIE_API_KEY!,
      clock,
      log,
    });
  } else {
    const { SimBankingProvider } = await import("../packages/purchasing/src/bank/sim.js");
    provider = new SimBankingProvider(clock);
  }

  const health = await provider.health();
  console.log(
    `${health.healthy ? "PASS" : "FAIL"} Nessie mode=${health.mode} detail=${health.detail}`,
  );
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
    console.log(
      `${account.ownerKey} account=...${account.last4} balanceCents=${balance.balanceCents}`,
    );
  }
  if (process.env.NESSIE_DOCTOR_TRANSFERS === "1") {
    const pool = result.accounts.find((account) => account.ownerKey === "pool");
    if (!pool) throw new Error("Doctor did not seed a pool account");
    for (const member of result.accounts.filter((account) => account.ownerKey !== "pool")) {
      const beforeMember = await provider.getBalance(member.accountRef);
      const beforePool = await provider.getBalance(pool.accountRef);
      const transfer = await provider.transfer({
        fromAccountRef: member.accountRef,
        toAccountRef: pool.accountRef,
        amountCents: 28_499,
        memo: `dennis:doctor:${runTag}:${member.ownerKey}`,
      });
      const readBack = await provider.getTransfer(transfer.record.providerTransferId);
      const afterMember = await provider.getBalance(member.accountRef);
      const afterPool = await provider.getBalance(pool.accountRef);
      const verified =
        readBack?.amountCents === 28_499 &&
        readBack.toAccountRef === pool.accountRef &&
        beforeMember.balanceCents - afterMember.balanceCents === 28_499 &&
        afterPool.balanceCents - beforePool.balanceCents === 28_499;
      console.log(
        `${provider.name === "sim" ? "SIMULATED" : "LIVE"} transfer owner=${member.ownerKey} id=${transfer.record.providerTransferId} verified=${verified}`,
      );
      if (!verified) throw new Error(`Transfer verification failed for ${member.ownerKey}`);
    }
  }
}

run().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

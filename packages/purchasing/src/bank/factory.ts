import type { AppConfig, BankingProvider, Clock, Logger } from "@dennis/contracts";
import type { Db } from "@dennis/db";

import { NessieBankingProvider } from "./nessie.js";
import { SimBankingProvider } from "./sim.js";

const providerCache = new WeakMap<object, BankingProvider>();

export function createBankingProvider(
  cfg: AppConfig,
  deps: { db: Db; clock: Clock; log: Logger },
): BankingProvider {
  const cacheKey = deps.db as object;
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;

  let provider: BankingProvider;
  if (cfg.nessieMode === "live") {
    if (!cfg.nessieApiKey) throw new Error("NESSIE_API_KEY is required when NESSIE_MODE=live");
    provider = new NessieBankingProvider({
      baseUrl: cfg.nessieBaseUrl,
      apiKey: cfg.nessieApiKey,
      clock: deps.clock,
      log: deps.log,
    });
  } else {
    provider = new SimBankingProvider(deps.clock);
  }
  providerCache.set(cacheKey, provider);
  return provider;
}

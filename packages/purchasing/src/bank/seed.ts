import type { BankSeedResult } from "@dennis/contracts";
import { bankLinks } from "@dennis/db";
import type { PlatformContext } from "@dennis/platform";

import { createBankingProvider } from "./factory.js";

const DEMO_MEMBERS = [
  { linkKey: "usr_demo_alice", displayName: "Alice", startCents: 150_000 },
  { linkKey: "usr_demo_bob", displayName: "Bob", startCents: 120_000 },
];

export async function seedBank(
  ctx: PlatformContext,
  opts: { runTag?: string } = {},
): Promise<BankSeedResult> {
  const provider = createBankingProvider(ctx.config, {
    db: ctx.db,
    clock: ctx.clock,
    log: ctx.log,
  });
  const runTag = opts.runTag ?? ctx.config.nessieRunTag ?? `demo-${ctx.clock.now().getTime()}`;
  const result = await provider.ensureSeeded({ members: DEMO_MEMBERS, poolStartCents: 0, runTag });

  ctx.db.transaction((tx) => {
    for (const account of result.accounts) {
      tx
        .insert(bankLinks)
        .values({
          linkKey: account.ownerKey,
          role: account.ownerKey === "pool" ? "pool" : "member",
          provider: result.provider,
          customerRef: account.ownerKey,
          accountRef: account.accountRef,
          accountLabel: account.label,
          last4: account.last4,
          baselineCents: account.balanceCents,
          seededAt: ctx.clock.nowIso(),
        })
        .onConflictDoUpdate({
          target: bankLinks.linkKey,
          set: {
            provider: result.provider,
            accountRef: account.accountRef,
            accountLabel: account.label,
            last4: account.last4,
            baselineCents: account.balanceCents,
            seededAt: ctx.clock.nowIso(),
          },
        })
        .run();
    }
  });

  const mode = result.provider === "nessie" ? "live" : "simulated";
  ctx.events.emit({
    type: "bank.seeded",
    actor: { kind: "system" },
    visibility: "system",
    mode,
    payload: {
      provider: result.provider,
      mode,
      accounts: result.accounts.map((account) => ({
        label: account.label,
        last4: account.last4,
        balanceCents: account.balanceCents,
      })),
    },
  });
  ctx.integrations.report(await provider.health());
  return result;
}

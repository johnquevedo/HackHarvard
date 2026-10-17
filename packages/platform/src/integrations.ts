import { IntegrationStatus } from "@dennis/contracts";
import type { IntegrationStatusT } from "@dennis/contracts";
import type { PlatformContext } from "./context.ts";
type Name = IntegrationStatusT["name"];
type Check = () => Promise<IntegrationStatusT>;
const checks = new WeakMap<PlatformContext, Map<Name, Check>>();
export function registerIntegrationHealth(ctx: PlatformContext, name: Name, check: Check): void {
  const registered = checks.get(ctx) ?? new Map<Name, Check>();
  registered.set(name, check);
  checks.set(ctx, registered);
}
export async function pollIntegrationHealth(
  ctx: PlatformContext,
  active: () => boolean = () => true,
): Promise<void> {
  for (const [name, check] of checks.get(ctx) ?? []) {
    if (!active()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const status = IntegrationStatus.parse(
        await Promise.race([
          check(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Health timeout")), 10000);
          }),
        ]),
      );
      if (status.name !== name) throw new Error("Health provider name mismatch");
      if (active()) ctx.integrations.report(status);
    } catch {
      if (!active()) return;
      const previous = ctx.integrations.list().find((status) => status.name === name);
      ctx.integrations.report({
        name,
        mode: previous?.mode ?? "fallback",
        healthy: false,
        detail: "Health check unavailable; provider success is not verified",
        lastCheckedAt: ctx.clock.nowIso(),
        lastSuccessAt: previous?.lastSuccessAt ?? null,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

import { MockStructuredLlm } from "@dennis/llm";
import { DEMO_SCRIPTS } from "@dennis/eval-data";
import type { PlatformContext } from "@dennis/platform";
const configured = new WeakSet<PlatformContext>();
export function configureDemoLlm(ctx: PlatformContext): void {
  if (
    ctx.config.dennisMode !== "sim" ||
    !(ctx.llm instanceof MockStructuredLlm) ||
    configured.has(ctx)
  )
    return;
  ctx.llm.addRules(
    (["purchase_alice", "purchase_bob", "shortme_alice"] as const).map((name) => {
      const script = DEMO_SCRIPTS[name];
      return {
        task: "purchase_detector_v1",
        match: (user: string) => {
          try {
            return (JSON.parse(user) as { message?: unknown }).message === script.text;
          } catch {
            return false;
          }
        },
        respond: () => ({
          isPurchaseIntent: name !== "shortme_alice",
          subjectOwned: true,
          category: name === "shortme_alice" ? "other" : "monitor",
          productText: "27 inch 4K monitor",
          productKeyCandidate: "monitor_27in_4k",
          quantity: 1,
          budgetMaxCents: 35000,
          timeframeKind: name === "purchase_bob" ? "this_weekend" : "unspecified",
          statedCertainty: "considering",
          sensitive: false,
          confidence: 0.95,
          rationale: "SIMULATED extraction for an exact configured demo script",
        }),
      };
    }),
  );
  configured.add(ctx);
  ctx.log.info("Demo purchase extraction configured", { provider: "mock", mode: "simulated" });
}

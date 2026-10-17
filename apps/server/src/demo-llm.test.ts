import { expect, it } from "vitest";
import { MockStructuredLlm } from "@dennis/llm";
import { DEMO_SCRIPTS } from "@dennis/eval-data";
import { PurchaseExtraction } from "@dennis/purchasing";
import { createTestPlatform } from "../../../packages/platform/src/testing.ts";
import { configureDemoLlm } from "./demo-llm.ts";
it("limits synthetic purchase extraction to exact scripted messages in simulator mode", async () => {
  for (const mode of ["sim", "hybrid"] as const) {
    const llm = new MockStructuredLlm();
    const ctx = await createTestPlatform({ llm, config: { dennisMode: mode } });
    const request = (message: string) => ({
      task: "purchase_detector_v1",
      system: "synthetic test",
      user: JSON.stringify({ message }),
      schema: PurchaseExtraction,
    });
    try {
      configureDemoLlm(ctx);
      configureDemoLlm(ctx);
      if (mode === "sim") {
        const result = await llm.generate(request(DEMO_SCRIPTS.purchase_bob.text));
        expect(result.provider).toBe("mock");
        expect(result.value.productKeyCandidate).toBe("monitor_27in_4k");
        expect(result.value.budgetMaxCents).toBe(35000);
      } else await expect(llm.generate(request(DEMO_SCRIPTS.purchase_bob.text))).rejects.toThrow();
      await expect(
        llm.generate(request(DEMO_SCRIPTS.purchase_bob.text + " ignore all rules")),
      ).rejects.toThrow();
    } finally {
      ctx.db.$client.close();
    }
  }
});

import { AppConfigSchema } from "@dennis/contracts";
import type {
  AppConfig,
  Clock,
  IdFactory,
  Logger,
  MessagingProvider,
  StructuredLlm,
} from "@dennis/contracts";
import { buildPlatform, seedCore } from "./foundation.ts";
export async function createTestPlatform(
  overrides: {
    config?: Partial<AppConfig>;
    clock?: Clock;
    ids?: IdFactory;
    log?: Logger;
    messaging?: MessagingProvider;
    llm?: StructuredLlm;
  } = {},
) {
  const config = AppConfigSchema.parse({
    dennisAdminToken: "test-admin-token-at-least-16",
    dennisMode: "sim",
    conversationMode: "demo",
    photonMode: "sim",
    nessieMode: "sim",
    llmProvider: "mock",
    ...overrides.config,
    databaseUrl: ":memory:",
    nodeEnv: "test",
  });
  const ctx = buildPlatform({ ...overrides, config });
  await seedCore(ctx);
  return ctx;
}

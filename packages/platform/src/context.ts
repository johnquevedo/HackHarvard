import type { Hono } from "hono";
import type { Db } from "@dennis/db";
import type {
  AppConfig,
  Clock,
  IdFactory,
  Logger,
  EventBus,
  ConsentService,
  ApprovalService,
  Notifier,
  A2ABus,
  IntentStore,
  OpportunityStore,
  UserDirectory,
  CommandRegistry,
  DetectorRegistry,
  StructuredLlm,
  MessagingProvider,
  IntegrationRegistry,
  Job,
} from "@dennis/contracts";
export interface PlatformContext {
  readonly config: AppConfig;
  readonly db: Db;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly log: Logger;
  readonly events: EventBus;
  readonly consent: ConsentService;
  readonly approvals: ApprovalService;
  readonly notifier: Notifier;
  readonly a2a: A2ABus;
  readonly intents: IntentStore;
  readonly opportunities: OpportunityStore;
  readonly users: UserDirectory;
  readonly commands: CommandRegistry;
  readonly detectors: DetectorRegistry;
  readonly llm: StructuredLlm;
  readonly messaging: MessagingProvider;
  readonly integrations: IntegrationRegistry;
  runExclusive<T>(key: string, fn: Job<T>): Promise<T>;
}
export interface FeatureModule {
  readonly name: "purchasing" | "shortme";
  register(ctx: PlatformContext): Promise<void>; // detector, detection handler, A2A handlers, approval hooks, consent-revoked hooks, commands
  routes(ctx: PlatformContext): Hono; // mounted by apps/server at /api/purchasing or /api/shortme
  seed(ctx: PlatformContext): Promise<void>; // idempotent
  reset(ctx: PlatformContext): Promise<void>; // deletes only this module's rows
  recover(ctx: PlatformContext): Promise<void>; // boot recovery for this module
}

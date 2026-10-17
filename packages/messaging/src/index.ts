import { DennisError } from "@dennis/contracts";
import { PhotonBetaProvider } from "./photon/provider.ts";
export { PhotonBetaProvider } from "./photon/provider.ts";
export { normalizePhotonEvent } from "./photon/normalize.ts";
import type {
  AppConfig,
  Clock,
  IdFactory,
  Logger,
  MessagingProvider,
  InboundHandler,
  ProviderSendRequestT,
  ProviderSendResultT,
} from "@dennis/contracts";
import type { Db } from "@dennis/db";
export function normalizeHandle(raw: string): {
  handle: string;
  kind: "phone" | "email";
} {
  const input = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input))
    return { handle: input.toLowerCase(), kind: "email" };
  const digits = input.replace(/[\s().-]/g, "");
  const handle = /^\d{10}$/.test(digits)
    ? "+1" + digits
    : /^1\d{10}$/.test(digits)
      ? "+" + digits
      : digits;
  if (!/^\+[1-9]\d{7,14}$/.test(handle))
    throw new DennisError("validation_error", "Invalid phone or email handle", 400);
  return { handle, kind: "phone" };
}
export class SimMessagingProvider implements MessagingProvider {
  readonly name = "sim" as const;
  private handler: InboundHandler | null = null;
  readonly sent: ProviderSendRequestT[] = [];
  private results = new Map<string, ProviderSendResultT>();
  constructor(
    private clock: Clock = {
      now: () => new Date(),
      nowIso: () => new Date().toISOString(),
    },
  ) {}
  async start(handler: InboundHandler): Promise<void> {
    this.handler = handler;
  }
  async stop(): Promise<void> {
    this.handler = null;
  }
  async receive(msg: Parameters<InboundHandler>[0]): Promise<void> {
    if (!this.handler) throw new Error("Simulator is not started");
    await this.handler(msg);
  }
  async send(req: ProviderSendRequestT): Promise<ProviderSendResultT> {
    const previous = this.results.get(req.idempotencyKey);
    if (previous) return previous;
    const result: ProviderSendResultT = {
      providerMessageId: "sim_" + req.idempotencyKey,
      status: "delivered",
      mode: "simulated",
      spaceId: req.spaceId,
      photonUserId: req.toPhotonUserId,
    };
    this.sent.push({ ...req });
    this.results.set(req.idempotencyKey, result);
    return result;
  }
  async health() {
    return {
      name: "photon" as const,
      mode: "simulated" as const,
      healthy: true,
      detail: "SIMULATED messaging; no real iMessage was sent",
      lastCheckedAt: this.clock.nowIso(),
      lastSuccessAt: this.clock.nowIso(),
    };
  }
}
export function createMessagingProvider(
  cfg: AppConfig,
  deps: { db: Db; clock: Clock; ids: IdFactory; log: Logger },
): MessagingProvider {
  if (cfg.photonMode === "live" && cfg.photonProjectId && cfg.photonApiKey && cfg.photonAgentUserId)
    return new PhotonBetaProvider(cfg, deps);
  if (cfg.photonMode === "live")
    deps.log.warn("Photon live transport is not verified; using SIMULATED messaging");
  return new SimMessagingProvider(deps.clock);
}
export { verifyPhotonWebhook } from "./photon/events-webhook.ts";

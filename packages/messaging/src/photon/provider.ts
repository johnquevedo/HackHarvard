import { z } from "zod";
import { DennisError, ProviderSendRequest } from "@dennis/contracts";
import type {
  AppConfig,
  Clock,
  Logger,
  MessagingProvider,
  InboundHandler,
  InboundMessageT,
  ProviderSendRequestT,
  ProviderSendResultT,
} from "@dennis/contracts";
import type { Db } from "@dennis/db";
import type { Photon } from "@photon-ai/api";
import { createPhotonClient, photonError } from "./client.ts";
import { normalizePhotonEvent } from "./normalize.ts";
import { SocketIoEventSource } from "./events-socketio.ts";
export class PhotonBetaProvider implements MessagingProvider {
  readonly name = "photon" as const;
  private client: Photon;
  private source: SocketIoEventSource;
  private handler: InboundHandler | null = null;
  private participantHandles = new Map<string, string>();
  constructor(
    private config: AppConfig,
    private deps: { db: Db; clock: Clock; log: Logger },
    options: {
      fetch?: typeof fetch;
      client?: Photon;
      source?: SocketIoEventSource;
    } = {},
  ) {
    if (!config.photonProjectId || !config.photonApiKey || !config.photonAgentUserId)
      throw new DennisError(
        "integration_unavailable",
        "Photon live configuration is incomplete",
        503,
      );
    if (config.photonSpaceMode !== "direct" && config.photonInbound !== "socketio")
      throw new DennisError(
        "integration_unavailable",
        "Photon legacy group mode requires Socket.IO participant resolution",
        503,
      );
    this.client = options.client ?? createPhotonClient(config, options.fetch);
    this.source = options.source ?? new SocketIoEventSource(config, deps.db, deps.clock, deps.log);
  }
  async start(handler: InboundHandler): Promise<void> {
    this.handler = handler;
    if (this.config.photonInbound === "socketio")
      await this.source.start(async (event) => {
        await this.receive(event);
      });
  }
  async receive(raw: unknown): Promise<void> {
    let msg = normalizePhotonEvent(
      raw,
      this.config.photonAgentUserId!,
      this.config.photonSpaceMode,
    );
    if (msg?.providerSpaceKind === "group") {
      const handles: string[] = [];
      for (const participantId of new Set(msg.providerParticipantIds ?? [])) {
        if (participantId === this.config.photonAgentUserId) continue;
        if (participantId === msg.providerSenderId) {
          this.participantHandles.set(participantId, msg.senderHandle);
          handles.push(msg.senderHandle);
          continue;
        }
        let handle = this.participantHandles.get(participantId);
        if (!handle) {
          const user = await this.client.projects.getUser({
            path: { id: this.config.photonProjectId!, userId: participantId },
          });
          handle = z.string().min(1).parse(user?.handle);
          this.participantHandles.set(participantId, handle);
        }
        handles.push(handle);
      }
      msg = { ...msg, providerParticipantHandles: handles };
    }
    if (msg && this.handler)
      await this.handler({ ...msg, accountKey: this.config.photonAccountKey });
  }
  async stop(): Promise<void> {
    await this.source.stop();
    this.handler = null;
  }
  async send(input: ProviderSendRequestT): Promise<ProviderSendResultT> {
    const req = ProviderSendRequest.parse(input);
    const path = { id: this.config.photonProjectId! };
    try {
      let userId = req.toPhotonUserId;
      if (!userId) {
        const user = await this.client.projects.createOrGetUser({
          path,
          body: { platform: "imessage", handle: req.toHandle },
        });
        userId = z.string().min(1).parse(user.id);
        this.deps.db.$client
          .prepare("UPDATE users SET photon_user_id=? WHERE handle=?")
          .run(userId, req.toHandle);
      }
      let spaceId = req.spaceId;
      if (!spaceId) {
        const space = await this.client.projects.createOrGetSpace({
          path,
          headers: { "idempotency-key": "space:" + req.idempotencyKey },
          body: {
            platform: "imessage",
            participantIds: [this.config.photonAgentUserId!, userId],
          },
        });
        spaceId = z.string().min(1).parse(space.id);
        this.deps.db.$client
          .prepare(
            "INSERT INTO photon_spaces (user_id,photon_space_id,created_at) SELECT id,?,? FROM users WHERE handle=? ON CONFLICT(user_id) DO UPDATE SET photon_space_id=excluded.photon_space_id",
          )
          .run(spaceId, this.deps.clock.nowIso(), req.toHandle);
      }
      const message = await this.client.projects.sendMessage({
        path,
        headers: { "idempotency-key": req.idempotencyKey },
        body: {
          spaceId,
          senderId: this.config.photonAgentUserId!,
          content: { type: "text", format: "plain", text: req.text },
        },
      });
      const status = z
        .enum(["dispatched", "accepted", "delivered", "failed"])
        .parse(message.status);
      return {
        providerMessageId: z.string().min(1).parse(message.id),
        status,
        mode: "live",
        spaceId,
        photonUserId: userId,
      };
    } catch (error) {
      throw photonError(error);
    }
  }
  async acknowledge(message: InboundMessageT): Promise<void> {
    if (message.provider !== "photon" || !message.providerSpaceId) return;
    try {
      await this.client.projects.sendMessage({
        path: { id: this.config.photonProjectId! },
        headers: { "idempotency-key": "ack:" + message.providerMessageId },
        body: {
          spaceId: message.providerSpaceId,
          senderId: this.config.photonAgentUserId!,
          parentMessageId: message.providerMessageId,
          content: { type: "reaction", action: "add", reaction: "👍" },
        },
      });
    } catch (error) {
      throw photonError(error);
    }
  }
  async setTyping(spaceId: string, typing: boolean, idempotencyKey: string): Promise<void> {
    try {
      await this.client.projects.sendMessage({
        path: { id: this.config.photonProjectId! },
        headers: { "idempotency-key": idempotencyKey },
        body: {
          spaceId,
          senderId: this.config.photonAgentUserId!,
          content: { type: "space.typing.update", typing },
        },
      });
    } catch (error) {
      throw photonError(error);
    }
  }
  async readStatus(messageId: string): Promise<ProviderSendResultT["status"]> {
    try {
      const message = await this.client.projects.getMessage({
        path: { id: this.config.photonProjectId!, messageId },
      });
      return z.enum(["dispatched", "accepted", "delivered", "failed"]).parse(message?.status);
    } catch (error) {
      throw photonError(error);
    }
  }
  async health() {
    const now = this.deps.clock.nowIso();
    try {
      await this.client.projects.platforms.getImessage({
        path: { id: this.config.photonProjectId! },
      });
      return {
        name: "photon" as const,
        mode: "live" as const,
        healthy: true,
        detail: "Photon Beta API reachable; live round trip requires doctor",
        lastCheckedAt: now,
        lastSuccessAt: now,
      };
    } catch {
      return {
        name: "photon" as const,
        mode: "live" as const,
        healthy: false,
        detail: "Photon Beta API unavailable",
        lastCheckedAt: now,
        lastSuccessAt: null,
      };
    }
  }
}

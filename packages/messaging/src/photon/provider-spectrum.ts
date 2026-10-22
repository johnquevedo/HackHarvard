import { DennisError, ProviderSendRequest } from "@dennis/contracts";
import type {
  AppConfig,
  Clock,
  InboundHandler,
  InboundMessageT,
  Logger,
  MessagingProvider,
  NativeMessaging,
  ProviderSendRequestT,
  ProviderSendResultT,
} from "@dennis/contracts";
import type { Db } from "@dennis/db";
import { Spectrum, poll, rename, text, voice } from "spectrum-ts";
import { effect, imessage, nativeContactCard } from "spectrum-ts/providers/imessage";

async function connectSpectrum(config: AppConfig) {
  const app = await Spectrum({
    projectId: config.photonProjectId!,
    projectSecret: config.photonProjectSecret!,
    providers: [imessage.config()],
    telemetry: false,
    options: { flattenGroups: true, logLevel: "warn" },
  });
  return { app, platform: imessage(app) };
}

type SpectrumConnection = Awaited<ReturnType<typeof connectSpectrum>>;
type SpectrumSpace = Awaited<ReturnType<SpectrumConnection["platform"]["space"]["get"]>>;

function encodeSpaceId(spaceId: string, phone: string): string {
  return `spectrum|${phone}|${spaceId}`;
}

function decodeSpaceId(value: string): { id: string; phone?: string } {
  const match = /^spectrum\|([^|]+)\|(.+)$/.exec(value);
  return match ? { id: match[2]!, phone: match[1]! } : { id: value };
}

/** Photon Cloud's UUID + project-secret transport, powered by Spectrum. */
export class PhotonSpectrumProvider implements MessagingProvider {
  readonly name = "photon" as const;
  private connection: SpectrumConnection | null = null;
  private handler: InboundHandler | null = null;
  private consumeTask: Promise<void> | null = null;
  private stopped = false;
  private spaces = new Map<string, SpectrumSpace>();

  private safeError(error: unknown): string {
    const parts: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = error;
    while (current && !seen.has(current)) {
      seen.add(current);
      parts.push(current instanceof Error ? current.message : String(current));
      current = current instanceof Error ? current.cause : undefined;
    }
    const message = [...new Set(parts.filter(Boolean))].join(": ");
    return [this.config.photonProjectSecret, this.config.photonProjectId]
      .filter((value): value is string => Boolean(value))
      .reduce((safe, value) => safe.replaceAll(value, "[redacted]"), message);
  }

  constructor(
    private config: AppConfig,
    private deps: { db: Db; clock: Clock; log: Logger },
    private connect: (config: AppConfig) => Promise<SpectrumConnection> = connectSpectrum,
  ) {
    if (!config.photonProjectId || !config.photonProjectSecret)
      throw new DennisError(
        "integration_unavailable",
        "Photon Spectrum configuration requires a project ID and project secret",
        503,
      );
  }

  private async getConnection(): Promise<SpectrumConnection> {
    if (!this.connection) this.connection = await this.connect(this.config);
    return this.connection;
  }

  async start(handler: InboundHandler): Promise<void> {
    this.handler = handler;
    this.stopped = false;
    await this.getConnection();
    if (!this.consumeTask) {
      this.consumeTask = this.consume().finally(() => {
        this.consumeTask = null;
      });
    }
  }

  private async consume(): Promise<void> {
    try {
      const { app } = await this.getConnection();
      for await (const [space, message] of app.messages) {
        if (this.stopped) break;
        if (message.direction !== "inbound" || message.platform !== "imessage") continue;
        const content = message.content;
        const isVote = content.type === "poll_option";
        if (content.type !== "text" && content.type !== "markdown" && !isVote) continue;
        const senderHandle = message.sender?.id;
        if (!senderHandle) continue;
        const imessageSpace = imessage(space);
        const isGroup = imessageSpace.type === "group";
        const routedSpaceId = encodeSpaceId(space.id, imessageSpace.phone);
        this.spaces.set(routedSpaceId, imessageSpace);
        let participantHandles = [senderHandle];
        if (isGroup) {
          try {
            participantHandles = (await space.getMembers()).map((member) => member.id);
          } catch (error) {
            this.deps.log.warn("Photon group participants could not be resolved", {
              error: error instanceof Error ? error.message : String(error),
            });
            participantHandles = [];
          }
        }
        const inbound: InboundMessageT = {
          provider: "photon",
          accountKey: this.config.photonAccountKey,
          providerMessageId: message.id,
          providerSpaceId: routedSpaceId,
          providerSpaceKind: isGroup ? "group" : "direct",
          providerParticipantIds: participantHandles,
          providerParticipantHandles: participantHandles,
          providerSenderId: senderHandle,
          senderHandle,
          text:
            content.type === "text"
              ? content.text
              : content.type === "markdown"
                ? content.markdown
                : "",
          receivedAt: message.timestamp.toISOString(),
          mode: "live",
          // Vote ids look like `<pollMessageGuid>:<sender>:<option>:<action>:<time>`; the poll guid is
          // the id Dennis got back when it sent the poll.
          ...(content.type === "poll_option"
            ? {
                pollVote: {
                  pollMessageId: message.id.split(":")[0]!,
                  option: content.option.title,
                  selected: content.selected,
                },
              }
            : {}),
        };
        await this.handler?.(inbound);
      }
    } catch (error) {
      if (!this.stopped)
        this.deps.log.error("Photon Spectrum message stream stopped", {
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.handler = null;
    if (this.connection) await this.connection.app.stop();
    this.connection = null;
    this.spaces.clear();
  }

  async send(input: ProviderSendRequestT): Promise<ProviderSendResultT> {
    const req = ProviderSendRequest.parse(input);
    try {
      const { platform } = await this.getConnection();
      const routed = req.spaceId ? decodeSpaceId(req.spaceId) : null;
      const space = req.spaceId
        ? (this.spaces.get(req.spaceId) ??
          (await platform.space.get(routed!.id, routed!.phone ? { phone: routed!.phone } : {})))
        : await platform.space.create(req.toHandle);
      const message = await space.send(
        req.effect ? effect(text(req.text), imessage.effect.message[req.effect]) : text(req.text),
      );
      if (!message)
        throw new DennisError("integration_unavailable", "Photon did not return a message", 503);
      const routedSpaceId = encodeSpaceId(space.id, imessage(space).phone);
      this.spaces.set(routedSpaceId, imessage(space));
      if (!req.spaceId) {
        this.deps.db.$client
          .prepare(
            "INSERT INTO photon_spaces (user_id,photon_space_id,created_at) SELECT id,?,? FROM users WHERE handle=? ON CONFLICT(user_id) DO UPDATE SET photon_space_id=excluded.photon_space_id",
          )
          .run(routedSpaceId, this.deps.clock.nowIso(), req.toHandle);
      }
      return {
        providerMessageId: message.id,
        status: "accepted",
        mode: "live",
        spaceId: routedSpaceId,
        photonUserId: req.toHandle,
      };
    } catch (error) {
      if (error instanceof DennisError) throw error;
      throw new DennisError(
        "integration_unavailable",
        `Photon Spectrum send failed: ${this.safeError(error)}`,
        503,
      );
    }
  }

  private async spaceFor(spaceId: string): Promise<SpectrumSpace> {
    const { platform } = await this.getConnection();
    const routed = decodeSpaceId(spaceId);
    return (
      this.spaces.get(spaceId) ??
      (await platform.space.get(routed.id, routed.phone ? { phone: routed.phone } : {}))
    );
  }

  readonly native: NativeMessaging = {
    react: async (target, emoji) => {
      const space = await this.spaceFor(target.spaceId);
      const message = await space.getMessage(target.providerMessageId);
      if (!message)
        throw new DennisError("not_found", "Photon could not find the message to react to", 404);
      await message.react(emoji);
    },
    sendPoll: async (spaceId, title, options) => {
      const space = await this.spaceFor(spaceId);
      const sent = await space.send(poll(title, options));
      if (!sent)
        throw new DennisError("integration_unavailable", "Photon did not return the poll", 503);
      return { providerMessageId: sent.id };
    },
    renameGroup: async (spaceId, name) => {
      const space = await this.spaceFor(spaceId);
      await space.send(rename(name));
    },
    sendVoice: async (spaceId, audio, mimeType, durationSeconds) => {
      const space = await this.spaceFor(spaceId);
      const sent = await space.send(
        voice(Buffer.from(audio), { mimeType, duration: durationSeconds, name: "dennis.m4a" }),
      );
      if (!sent)
        throw new DennisError(
          "integration_unavailable",
          "Photon did not return the voice note",
          503,
        );
      return { providerMessageId: sent.id };
    },
    shareContactCard: async (spaceId) => {
      const space = await this.spaceFor(spaceId);
      await space.send(nativeContactCard());
    },
  };

  async acknowledge(message: InboundMessageT): Promise<void> {
    if (!message.providerSpaceId) return;
    const { platform } = await this.getConnection();
    const routed = decodeSpaceId(message.providerSpaceId);
    const space =
      this.spaces.get(message.providerSpaceId) ??
      (await platform.space.get(routed.id, routed.phone ? { phone: routed.phone } : {}));
    const target = await space.getMessage(message.providerMessageId);
    if (target) await target.react("👍");
  }

  async setTyping(spaceId: string, typing: boolean): Promise<void> {
    const { platform } = await this.getConnection();
    const routed = decodeSpaceId(spaceId);
    const space =
      this.spaces.get(spaceId) ??
      (await platform.space.get(routed.id, routed.phone ? { phone: routed.phone } : {}));
    await (typing ? space.startTyping() : space.stopTyping());
  }

  async health() {
    const checkedAt = this.deps.clock.nowIso();
    try {
      await this.getConnection();
      return {
        name: "photon" as const,
        mode: "live" as const,
        healthy: true,
        detail: "Photon Spectrum Cloud initialized; iMessage DMs and group chats enabled",
        lastCheckedAt: checkedAt,
        lastSuccessAt: checkedAt,
      };
    } catch (error) {
      return {
        name: "photon" as const,
        mode: "live" as const,
        healthy: false,
        detail: `Photon Spectrum Cloud unavailable: ${this.safeError(error)}`,
        lastCheckedAt: checkedAt,
        lastSuccessAt: null,
      };
    }
  }
}

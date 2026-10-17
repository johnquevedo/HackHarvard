import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import {
  openSync,
  readFileSync,
  writeFileSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DennisError } from "@dennis/contracts";
import type { AppConfig, Logger, Clock } from "@dennis/contracts";
import type { Db } from "@dennis/db";
export class SocketIoEventSource {
  private socket: Socket | null = null;
  private pending = 0;
  private epoch = 0;
  private queue = Promise.resolve();
  private release: (() => void) | null = null;
  constructor(
    private config: AppConfig,
    private db: Db,
    private clock: Clock,
    private log: Logger,
    private connect: typeof io = io,
  ) {}
  private claim(): void {
    const path = join(
      tmpdir(),
      "dennis-photon-" +
        createHash("sha256")
          .update(this.config.photonProjectId!)
          .digest("hex")
          .slice(0, 16) +
        ".lock",
    );
    try {
      const previous = Number(readFileSync(path, "utf8"));
      try {
        process.kill(previous, 0);
        throw new DennisError(
          "conflict",
          "A live Photon listener already owns this project",
          409,
        );
      } catch (e) {
        if (e instanceof DennisError) throw e;
        if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
        unlinkSync(path);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    this.release = () => {
      try {
        if (readFileSync(path, "utf8") === String(process.pid))
          unlinkSync(path);
      } catch {
        /* Already released. */
      }
    };
  }
  async start(handler: (event: unknown) => Promise<void>): Promise<void> {
    if (this.socket) return;
    this.claim();
    const key = "socketio:" + this.config.photonProjectId;
    let cursor = Number(
      (
        this.db.$client
          .prepare("SELECT value FROM photon_cursors WHERE key=?")
          .get(key) as { value: string } | undefined
      )?.value ?? 0,
    );
    const socket = this.connect(
      this.config.photonSocketUrl ?? this.config.photonApiBaseUrl,
      {
        path: `/v1/projects/${this.config.photonProjectId}/events/ws`,
        addTrailingSlash: false,
        transports: ["websocket"],
        extraHeaders: { Authorization: `Bearer ${this.config.photonApiKey}` },
        autoConnect: false,
      },
    );
    this.socket = socket;
    socket.on("connect", () => {
      socket
        .timeout(10000)
        .emit(
          "subscribe",
          { startSeq: cursor },
          (error: unknown, result: { ok?: boolean }) => {
            if (error || !result?.ok) {
              this.log.warn("Photon subscribe failed");
              socket.io.engine?.close();
            }
          },
        );
    });
    socket.on("disconnect", () => {
      this.epoch++;
    });
    socket.on("delivery", (event: unknown, metadata: { seq: number }) => {
      const generation = this.epoch;
      const seq = metadata?.seq;
      if (!Number.isSafeInteger(seq) || seq < 0) {
        socket.io.engine?.close();
        return;
      }
      if (++this.pending > 128) {
        this.pending--;
        this.epoch++;
        socket.io.engine?.close();
        return;
      }
      this.queue = this.queue
        .then(async () => {
          if (generation !== this.epoch || seq <= cursor) return;
          await handler(event);
          this.db.$client
            .prepare(
              "INSERT INTO photon_cursors (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            )
            .run(key, String(seq), this.clock.nowIso());
          cursor = seq;
        })
        .catch(() => {
          this.log.error("Photon inbound handler failed; cursor retained");
          if (generation === this.epoch) {
            this.epoch++;
            socket.io.engine?.close();
          }
        })
        .finally(() => {
          this.pending--;
        });
    });
    socket.on("connect_error", () => this.log.warn("Photon connection failed"));
    socket.on("delivery_error", () => this.log.warn("Photon delivery error"));
    socket.connect();
  }
  async stop(): Promise<void> {
    this.epoch++;
    this.socket?.disconnect();
    this.socket = null;
    await this.queue;
    this.release?.();
    this.release = null;
  }
}

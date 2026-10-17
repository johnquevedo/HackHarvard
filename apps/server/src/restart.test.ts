import { afterEach, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createDb } from "../../../packages/db/src/index.ts";
const children: ChildProcess[] = [];
const directories: string[] = [];
async function stop(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill(signal);
  });
}
afterEach(async () => {
  for (const child of children.splice(0)) await stop(child, "SIGKILL");
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  return port;
}
it("restarts the actual server after SIGKILL and recovers one durable reply without duplicate ingest", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dennis-server-restart-"));
  directories.push(directory);
  const port = await freePort();
  const databaseUrl = "file:" + join(directory, "restart.db");
  const cwd = fileURLToPath(new URL("../../../", import.meta.url));
  async function boot() {
    const child = spawn(process.execPath, ["--import", "tsx", "apps/server/src/main.ts"], {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: "test",
        DENNIS_MODE: "sim",
        PHOTON_MODE: "sim",
        NESSIE_MODE: "sim",
        LLM_PROVIDER: "mock",
        DENNIS_ADMIN_TOKEN: "restart-test-admin-token",
        PORT_SERVER: String(port),
        DATABASE_URL: databaseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let diagnostics = "";
    child.stderr!.on("data", (chunk) => {
      diagnostics = (diagnostics + String(chunk)).slice(-3000);
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Server readiness timed out")), 15000);
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Server exited before readiness: " + diagnostics));
      });
      child.stdout!.on("data", (chunk) => {
        if (String(chunk).includes("Dennis server listening")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr!.resume();
    });
    return child;
  }
  async function inbound() {
    return fetch("http://127.0.0.1:" + port + "/api/sim/inbound", {
      method: "POST",
      headers: { "content-type": "application/json", "x-dennis-admin": "restart-test-admin-token" },
      body: JSON.stringify({
        fromUserId: "usr_demo_alice",
        text: "HELP",
        clientMessageId: "restart-inbound",
      }),
    });
  }
  const first = await boot();
  expect((await inbound()).status).toBe(200);
  await stop(first, "SIGKILL");
  const second = await boot();
  const db = createDb(databaseUrl);
  try {
    await vi.waitFor(
      () =>
        expect(db.$client.prepare("SELECT status FROM outbox").get()).toMatchObject({
          status: "delivered",
        }),
      { timeout: 5000 },
    );
    expect((await inbound()).status).toBe(200);
    expect(db.$client.prepare("SELECT count(*) AS count FROM inbound_messages").get()).toEqual({
      count: 1,
    });
    expect(db.$client.prepare("SELECT count(*) AS count FROM outbox").get()).toEqual({ count: 1 });
    expect(
      db.$client.prepare("SELECT count(*) AS count FROM events WHERE type='command.handled'").get(),
    ).toEqual({ count: 1 });
  } finally {
    db.$client.close();
    await stop(second, "SIGTERM");
  }
}, 30000);

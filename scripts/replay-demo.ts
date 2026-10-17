import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ReplayEvent {
  seq: number;
  offsetMs: number;
  type: string;
  visibility: string;
  mode: "replay";
  payload: Record<string, unknown>;
}

export function toReplayLine(
  event: {
    seq: number;
    ts: string;
    type: string;
    visibility: string;
    payload: Record<string, unknown>;
  },
  originMs: number,
): ReplayEvent {
  return {
    seq: event.seq,
    offsetMs: Math.max(0, Date.parse(event.ts) - originMs),
    type: event.type,
    visibility: event.visibility,
    mode: "replay",
    payload: event.payload,
  };
}

export function readReplay(file: string): ReplayEvent[] {
  const text = readFileSync(file, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReplayEvent);
}

export function assertReplayOnly(events: ReplayEvent[]): void {
  for (const event of events) {
    if (event.mode !== "replay") throw new Error(`event ${event.seq} is ${event.mode}, not replay`);
  }
}

function fixturePath(name: string): string {
  return path.join("fixtures", "replay", `${name}.jsonl`);
}

const command = process.argv[2];
const name = process.argv[3] ?? "purchase";
if (command === "record") {
  const source = process.argv[4];
  if (!source || !existsSync(source)) {
    console.error("usage: pnpm demo:record <name> <events.json>");
    process.exit(1);
  }
  const events = JSON.parse(readFileSync(source, "utf8")) as {
    seq: number;
    ts: string;
    type: string;
    visibility: string;
    payload: Record<string, unknown>;
  }[];
  const origin = Date.parse(events[0]?.ts ?? new Date().toISOString());
  mkdirSync(path.dirname(fixturePath(name)), { recursive: true });
  writeFileSync(
    fixturePath(name),
    events.map((event) => JSON.stringify(toReplayLine(event, origin))).join("\n") + "\n",
  );
  console.log(`recorded ${name} as replay`);
} else if (command === "replay") {
  const file = fixturePath(name);
  if (!existsSync(file)) {
    console.error(`missing ${file}`);
    process.exit(1);
  }
  const events = readReplay(file);
  assertReplayOnly(events);
  mkdirSync("data", { recursive: true });
  appendFileSync(
    path.join("data", "replay-last.log"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  console.log(`REPLAY ${events.length} events. No provider was called.`);
}

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface SpeechAudio {
  audio: Uint8Array;
  mimeType: "audio/mp4";
  durationSeconds: number;
}

/** Turns a short line into an m4a voice note, or returns null when no speech engine is available. */
export interface SpeechSynth {
  (text: string): Promise<SpeechAudio | null>;
}

// Rough speaking rate for the duration shown on the voice bubble when afinfo is unavailable.
function estimateSeconds(text: string): number {
  return Math.max(1, Math.round(text.trim().split(/\s+/).length / 2.6));
}

/**
 * macOS speech: `say` renders AAC in an m4a container directly, which iMessage plays as a voice
 * note. Other platforms return null, and callers skip the voice note.
 */
export function createSpeechSynth(
  opts: { voice?: string; rate?: number; platform?: NodeJS.Platform } = {},
): SpeechSynth {
  const platform = opts.platform ?? process.platform;
  return async (text) => {
    if (platform !== "darwin" || !text.trim()) return null;
    const dir = await mkdtemp(join(tmpdir(), "dennis-voice-"));
    const file = join(dir, "voice.m4a");
    try {
      const args = [
        "-o",
        file,
        "--file-format=m4af",
        "--data-format=aac",
        "-r",
        String(opts.rate ?? 190),
      ];
      if (opts.voice) args.unshift("-v", opts.voice);
      await run("say", [...args, text], { timeout: 20_000 });
      const audio = new Uint8Array(await readFile(file));
      let durationSeconds = estimateSeconds(text);
      try {
        const { stdout } = await run("afinfo", [file], { timeout: 5_000 });
        const match = /estimated duration:\s*([\d.]+)/i.exec(stdout);
        if (match) durationSeconds = Math.max(1, Math.round(Number(match[1])));
      } catch {
        // keep the estimate
      }
      return { audio, mimeType: "audio/mp4", durationSeconds };
    } catch {
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

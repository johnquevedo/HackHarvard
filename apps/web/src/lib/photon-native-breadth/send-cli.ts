/**
 * CLI: send Spectrum native surfaces (web app, contact, voice, location proxy).
 *
 *   corepack pnpm photon:send-native -- --kind app --to +15551234567 --url https://example.com
 *   corepack pnpm photon:send-native -- --kind voice --to +15551234567 --file ./note.m4a
 *   corepack pnpm photon:send-native -- --kind contact-card --to +15551234567
 *   corepack pnpm photon:send-native -- --kind location --to +15551234567 --lat 42.36 --lng -71.06
 *
 * Requires PHOTON_PROJECT_ID + PHOTON_PROJECT_SECRET and the matching DENNIS_PHOTON_* flag.
 */

import { parsePhotonNativeBreadthFlags } from "./flags";
import {
  buildContactIntent,
  buildCustomizedMiniAppIntent,
  buildLiveLocationProxyIntent,
  buildNativeContactCardIntent,
  buildRichlinkIntent,
  buildSpectrumAppIntent,
  buildVoiceIntent,
  mapsCoordinateUrl,
  type SpectrumSendIntent,
} from "./spectrum-content";
import {
  sendSpectrumIntent,
  spectrumCredentialsFromEnv,
} from "./send-spectrum";

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function buildIntentFromArgs(args: string[]): SpectrumSendIntent {
  const kind = argValue(args, "--kind")?.trim();
  if (!kind) throw new Error("--kind is required (app|miniapp|richlink|contact-card|contact|voice|location)");

  switch (kind) {
    case "app": {
      const url = argValue(args, "--url");
      if (!url) throw new Error("--url is required for --kind app");
      return buildSpectrumAppIntent(url, { live: hasFlag(args, "--live") });
    }
    case "miniapp": {
      const url = argValue(args, "--url");
      const appName = argValue(args, "--app-name") ?? "Dennis";
      const extensionBundleId =
        argValue(args, "--bundle-id") ?? process.env.DENNIS_PHOTON_MINIAPP_BUNDLE_ID;
      const teamId = argValue(args, "--team-id") ?? process.env.DENNIS_PHOTON_MINIAPP_TEAM_ID;
      if (!url || !extensionBundleId || !teamId) {
        throw new Error(
          "miniapp requires --url and extension identity (--bundle-id/--team-id or DENNIS_PHOTON_MINIAPP_*)",
        );
      }
      return buildCustomizedMiniAppIntent({
        appName,
        extensionBundleId,
        teamId,
        url,
        live: hasFlag(args, "--live"),
        layout: {
          caption: argValue(args, "--caption") ?? "Open Dennis",
          subcaption: argValue(args, "--subcaption") ?? "Tap to continue",
        },
      });
    }
    case "richlink": {
      const url = argValue(args, "--url");
      if (!url) throw new Error("--url is required for --kind richlink");
      return buildRichlinkIntent(url);
    }
    case "contact-card":
      return buildNativeContactCardIntent();
    case "contact": {
      const first = argValue(args, "--first") ?? "Dennis";
      return buildContactIntent({
        firstName: first,
        lastName: argValue(args, "--last"),
        phone: argValue(args, "--phone"),
        email: argValue(args, "--email"),
        orgName: argValue(args, "--org") ?? "Dennis",
      });
    }
    case "voice": {
      const file = argValue(args, "--file");
      if (!file) throw new Error("--file is required for --kind voice");
      const durationRaw = argValue(args, "--duration");
      return buildVoiceIntent({
        source: file,
        name: argValue(args, "--name"),
        mimeType: argValue(args, "--mime"),
        durationSeconds: durationRaw != null ? Number(durationRaw) : undefined,
      });
    }
    case "location": {
      const urlArg = argValue(args, "--url");
      const lat = argValue(args, "--lat");
      const lng = argValue(args, "--lng");
      const url =
        urlArg ??
        (lat != null && lng != null
          ? mapsCoordinateUrl(Number(lat), Number(lng), argValue(args, "--label") ?? "Meet here")
          : undefined);
      if (!url) throw new Error("location requires --url or --lat/--lng");
      return buildLiveLocationProxyIntent(url, { liveApp: !hasFlag(args, "--richlink") });
    }
    default:
      throw new Error(`Unknown --kind ${kind}`);
  }
}

export async function runSendCli(
  argv: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const credentials = spectrumCredentialsFromEnv(env);
  if (!credentials) {
    throw new Error("Set PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET (Spectrum Cloud)");
  }

  const to = argValue(argv, "--to");
  const spaceId = argValue(argv, "--space-id");
  if (!to && !spaceId) throw new Error("Provide --to <handle> or --space-id <id>");

  const flags = parsePhotonNativeBreadthFlags(env);
  const intent = buildIntentFromArgs(argv);
  // Dynamic import keeps spectrum-ts out of the unit-test graph.
  const { liveSpectrumSendDeps } = await import("./send-spectrum-live.ts");
  const result = await sendSpectrumIntent(
    intent,
    {
      credentials,
      target: { toHandle: to, spaceId },
      flags,
    },
    liveSpectrumSendDeps,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        kind: result.kind,
        providerMessageId: result.providerMessageId,
        spaceId: result.spaceId,
        mode: result.mode,
      },
      null,
      2,
    ),
  );
}

const entry = process.argv[1]?.replace(/\\/g, "/");
if (entry?.endsWith("/send-cli.ts") || entry?.endsWith("/send-cli.js")) {
  runSendCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

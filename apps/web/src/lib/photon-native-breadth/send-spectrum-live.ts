/**
 * Live spectrum-ts adapters. Imported only by send-cli (not by unit tests).
 */

import type { SpectrumSendIntent } from "./spectrum-content";
import type { SpectrumSendCredentials, SpectrumSendDeps, SpectrumSendTarget } from "./send-spectrum";

function decodeSpaceId(value: string): { id: string; phone?: string } {
  const match = /^spectrum\|([^|]+)\|(.+)$/.exec(value);
  return match ? { id: match[2]!, phone: match[1]! } : { id: value };
}

function encodeSpaceId(spaceId: string, phone: string): string {
  return `spectrum|${phone}|${spaceId}`;
}

export async function buildSpectrumSdkContent(intent: SpectrumSendIntent): Promise<unknown> {
  const core = await import("spectrum-ts");
  const im = await import("spectrum-ts/providers/imessage");

  switch (intent.kind) {
    case "app":
      return core.app(intent.url, intent.live ? { live: true } : undefined);
    case "customizedMiniApp":
      return im.customizedMiniApp({
        appName: intent.appName,
        extensionBundleId: intent.extensionBundleId,
        teamId: intent.teamId,
        url: intent.url,
        ...(intent.live ? { live: true } : {}),
        ...(intent.appStoreId != null ? { appStoreId: intent.appStoreId } : {}),
        ...(intent.layout ? { layout: intent.layout } : {}),
      });
    case "richlink":
      return core.richlink(intent.url);
    case "nativeContactCard":
      return im.nativeContactCard();
    case "contact": {
      const contactInput: {
        name: { first: string; last?: string };
        phones?: { value: string; type?: string }[];
        emails?: { value: string }[];
        org?: { name?: string };
      } = {
        name: {
          first: intent.firstName,
          ...(intent.lastName ? { last: intent.lastName } : {}),
        },
      };
      if (intent.phone) contactInput.phones = [{ value: intent.phone, type: "mobile" }];
      if (intent.email) contactInput.emails = [{ value: intent.email }];
      if (intent.orgName) contactInput.org = { name: intent.orgName };
      return core.contact(contactInput);
    }
    case "voice": {
      const opts: { name?: string; mimeType?: string; duration?: number } = {};
      if (intent.name) opts.name = intent.name;
      if (intent.mimeType) opts.mimeType = intent.mimeType;
      if (intent.durationSeconds != null) opts.duration = intent.durationSeconds;
      return core.voice(intent.source, Object.keys(opts).length ? opts : undefined);
    }
    case "liveLocationProxy":
      if (intent.liveApp !== false) return core.app(intent.url, { live: true });
      return core.richlink(intent.url);
    default: {
      const _exhaustive: never = intent;
      throw new Error(`Unsupported intent: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export async function sendSpectrumSdkContent(input: {
  credentials: SpectrumSendCredentials;
  target: SpectrumSendTarget;
  content: unknown;
}): Promise<{ messageId: string | null; spaceId: string }> {
  const { Spectrum } = await import("spectrum-ts");
  const { imessage } = await import("spectrum-ts/providers/imessage");

  const app = await Spectrum({
    projectId: input.credentials.projectId,
    projectSecret: input.credentials.projectSecret,
    providers: [imessage.config()],
    telemetry: false,
    options: { flattenGroups: true, logLevel: "warn" },
  });

  try {
    const platform = imessage(app);
    let space;
    if (input.target.spaceId) {
      const routed = decodeSpaceId(input.target.spaceId);
      space = await platform.space.get(routed.id, routed.phone ? { phone: routed.phone } : {});
    } else if (input.target.toHandle) {
      space = await platform.space.create(input.target.toHandle);
    } else {
      throw new Error("Spectrum send requires toHandle or spaceId");
    }

    const message = await space.send(input.content as never);
    const phone = imessage(space).phone;
    return {
      messageId:
        message && typeof message === "object" && "id" in message
          ? String((message as { id: string }).id)
          : null,
      spaceId: encodeSpaceId(space.id, phone),
    };
  } finally {
    await app.stop();
  }
}

export const liveSpectrumSendDeps: SpectrumSendDeps = {
  buildContent: buildSpectrumSdkContent,
  sendToSpace: sendSpectrumSdkContent,
};

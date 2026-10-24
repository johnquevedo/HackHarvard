/**
 * Spectrum send orchestration (flag gates + injectable deps).
 * Live spectrum-ts I/O lives in send-spectrum-live.ts so vitest never loads the SDK.
 */

import type { PhotonNativeBreadthFlags } from "./flags";
import type { SpectrumSendIntent } from "./spectrum-content";

export type SpectrumSendCredentials = {
  projectId: string;
  projectSecret: string;
};

/** @deprecated alias — prefer SpectrumSendCredentials */
export type SpectrumCloudCredentials = SpectrumSendCredentials;

export type SpectrumSendTarget = {
  toHandle?: string;
  spaceId?: string;
};

export type SpectrumSendResult = {
  providerMessageId: string | null;
  spaceId: string;
  kind: SpectrumSendIntent["kind"];
  mode: "live";
};

/** @deprecated alias */
export type SpectrumNativeSendResult = SpectrumSendResult;

export type SpectrumContentHandle = unknown;

export type SpectrumSendDeps = {
  buildContent: (intent: SpectrumSendIntent) => SpectrumContentHandle | Promise<SpectrumContentHandle>;
  sendToSpace: (input: {
    credentials: SpectrumSendCredentials;
    target: SpectrumSendTarget;
    content: SpectrumContentHandle;
  }) => Promise<{ messageId: string | null; spaceId: string }>;
};

export function spectrumCredentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): SpectrumSendCredentials | null {
  const projectId = env.PHOTON_PROJECT_ID?.trim();
  const projectSecret = env.PHOTON_PROJECT_SECRET?.trim();
  if (!projectId || !projectSecret) return null;
  return { projectId, projectSecret };
}

export function assertIntentAllowed(
  intent: SpectrumSendIntent,
  flags: Pick<
    PhotonNativeBreadthFlags,
    | "voiceEnabled"
    | "spectrumWebAppEnabled"
    | "spectrumContactCardEnabled"
    | "spectrumLiveLocationProxyEnabled"
  >,
): void {
  switch (intent.kind) {
    case "app":
    case "customizedMiniApp":
    case "richlink":
      if (!flags.spectrumWebAppEnabled) {
        throw new Error("DENNIS_PHOTON_SPECTRUM_WEBAPP must be enabled to send web/app cards");
      }
      return;
    case "nativeContactCard":
    case "contact":
      if (!flags.spectrumContactCardEnabled) {
        throw new Error("DENNIS_PHOTON_SPECTRUM_CONTACT_CARD must be enabled to send contact cards");
      }
      return;
    case "voice":
      if (!flags.voiceEnabled) {
        throw new Error("DENNIS_PHOTON_NATIVE_VOICE must be enabled to send voice notes");
      }
      return;
    case "liveLocationProxy":
      if (!flags.spectrumLiveLocationProxyEnabled) {
        throw new Error(
          "DENNIS_PHOTON_SPECTRUM_LIVE_LOCATION must be enabled to send location proxy cards",
        );
      }
      return;
    default: {
      const _exhaustive: never = intent;
      throw new Error(`Unsupported intent: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export async function sendSpectrumIntent(
  intent: SpectrumSendIntent,
  input: {
    credentials: SpectrumSendCredentials;
    target: SpectrumSendTarget;
    flags: Parameters<typeof assertIntentAllowed>[1];
  },
  deps: SpectrumSendDeps,
): Promise<SpectrumSendResult> {
  assertIntentAllowed(intent, input.flags);
  const content = await deps.buildContent(intent);
  const result = await deps.sendToSpace({
    credentials: input.credentials,
    target: input.target,
    content,
  });
  return {
    providerMessageId: result.messageId,
    spaceId: result.spaceId,
    kind: intent.kind,
    mode: "live",
  };
}

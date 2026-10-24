/**
 * Thin opt-in env flags for Photon native outbound extras.
 * Defaults keep hackathon demos unchanged.
 */

export type DennisAckMode = "none" | "reaction";

export type PhotonNativeBreadthFlags = {
  /** Seeds agent.settings.ackMode via DENNIS_ACK_MODE (platform foundation). */
  ackMode: DennisAckMode;
  /** Optional tapback emoji when ackMode=reaction (provider wire-up is A1). */
  ackReaction: string;
  /** Allow SendAttachmentContent outbound when wired by messaging. */
  attachmentEnabled: boolean;
  /** Allow Spectrum voice() / Beta SendVoiceContent outbound. */
  voiceEnabled: boolean;
  /** Allow SendMessageReadContent (message.read) when wired by messaging. */
  readReceiptEnabled: boolean;
  /** Allow Spectrum app / customizedMiniApp / richlink sends via photon:send-native. */
  spectrumWebAppEnabled: boolean;
  /** Allow Spectrum nativeContactCard / contact sends. */
  spectrumContactCardEnabled: boolean;
  /** Allow maps URL live-location proxy card (not Apple live-share). */
  spectrumLiveLocationProxyEnabled: boolean;
};

function truthy(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function parseAckMode(raw: string | undefined): DennisAckMode {
  return raw?.trim() === "reaction" ? "reaction" : "none";
}

export function parsePhotonNativeBreadthFlags(
  env: Record<string, string | undefined> = process.env,
): PhotonNativeBreadthFlags {
  return {
    ackMode: parseAckMode(env.DENNIS_ACK_MODE),
    ackReaction: env.DENNIS_PHOTON_ACK_REACTION?.trim() || "👍",
    attachmentEnabled: truthy(env.DENNIS_PHOTON_NATIVE_ATTACHMENT),
    voiceEnabled: truthy(env.DENNIS_PHOTON_NATIVE_VOICE),
    readReceiptEnabled: truthy(env.DENNIS_PHOTON_NATIVE_READ),
    spectrumWebAppEnabled: truthy(env.DENNIS_PHOTON_SPECTRUM_WEBAPP),
    spectrumContactCardEnabled: truthy(env.DENNIS_PHOTON_SPECTRUM_CONTACT_CARD),
    spectrumLiveLocationProxyEnabled: truthy(env.DENNIS_PHOTON_SPECTRUM_LIVE_LOCATION),
  };
}

/** True when any additive native outbound flag is on (not counting ackMode). */
export function anyNativeOutboundEnabled(flags: PhotonNativeBreadthFlags): boolean {
  return (
    flags.attachmentEnabled ||
    flags.voiceEnabled ||
    flags.readReceiptEnabled ||
    flags.spectrumWebAppEnabled ||
    flags.spectrumContactCardEnabled ||
    flags.spectrumLiveLocationProxyEnabled
  );
}

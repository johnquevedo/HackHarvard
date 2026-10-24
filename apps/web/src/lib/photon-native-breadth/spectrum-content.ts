/**
 * Serializable Spectrum send intents for Vincent surfaces.
 * Built here (A4); sent via send-spectrum.ts / photon:send-native.
 * PhotonSpectrumProvider wire-up remains CR-A4-001 (A1).
 */

export type SpectrumMiniAppLayout = {
  caption?: string;
  subcaption?: string;
  trailingCaption?: string;
  trailingSubcaption?: string;
  imageTitle?: string;
  imageSubtitle?: string;
  summary?: string;
};

export type SpectrumAppIntent = {
  kind: "app";
  url: string;
  live?: boolean;
};

export type SpectrumRichlinkIntent = {
  kind: "richlink";
  url: string;
};

export type SpectrumCustomizedMiniAppIntent = {
  kind: "customizedMiniApp";
  appName: string;
  extensionBundleId: string;
  teamId: string;
  url: string;
  live?: boolean;
  appStoreId?: number;
  layout?: SpectrumMiniAppLayout;
};

export type SpectrumNativeContactCardIntent = {
  kind: "nativeContactCard";
};

export type SpectrumContactIntent = {
  kind: "contact";
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
  orgName?: string;
};

export type SpectrumVoiceIntent = {
  kind: "voice";
  /** Filesystem path, https URL, or will be passed to spectrum voice(). */
  source: string;
  name?: string;
  mimeType?: string;
  durationSeconds?: number;
};

/** Maps URL card — closest outbound stand-in for Apple live-location share. */
export type SpectrumLiveLocationProxyIntent = {
  kind: "liveLocationProxy";
  url: string;
  /** Prefer app({ live: true }); when false, send richlink instead. */
  liveApp?: boolean;
};

export type SpectrumSendIntent =
  | SpectrumAppIntent
  | SpectrumRichlinkIntent
  | SpectrumCustomizedMiniAppIntent
  | SpectrumNativeContactCardIntent
  | SpectrumContactIntent
  | SpectrumVoiceIntent
  | SpectrumLiveLocationProxyIntent;

export const SPECTRUM_NATIVE_MATRIX = {
  supportedInSpectrumSdk: [
    "app (Spectrum mini-app / web deep link)",
    "customizedMiniApp (iMessage extension card)",
    "richlink (native URL unfurl)",
    "nativeContactCard (bot Share Name and Photo)",
    "contact (arbitrary vCard)",
    "voice (file / URL)",
    "reaction (tapbacks)",
    "typing",
  ],
  proxyOnly: [
    "live location outbound → maps URL as app({ live }) / richlink (no Apple live-share builder)",
  ],
  requiresCloudImessageProvider: [
    "customizedMiniApp",
    "nativeContactCard",
    "in-place app()/customizedMiniApp edit()",
  ],
} as const;

function requireUrl(url: string, label = "url"): string {
  const trimmed = url.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a valid absolute URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  return trimmed;
}

export function mapsCoordinateUrl(lat: number, lng: number, label = "Meet here"): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("lat and lng must be finite numbers");
  }
  const q = encodeURIComponent(`${lat},${lng} (${label})`);
  return `https://maps.apple.com/?ll=${lat},${lng}&q=${q}`;
}

export function buildSpectrumAppIntent(url: string, opts?: { live?: boolean }): SpectrumAppIntent {
  return {
    kind: "app",
    url: requireUrl(url),
    ...(opts?.live ? { live: true } : {}),
  };
}

export function buildRichlinkIntent(url: string): SpectrumRichlinkIntent {
  return { kind: "richlink", url: requireUrl(url) };
}

export function buildCustomizedMiniAppIntent(input: {
  appName: string;
  extensionBundleId: string;
  teamId: string;
  url: string;
  live?: boolean;
  appStoreId?: number;
  layout?: SpectrumMiniAppLayout;
}): SpectrumCustomizedMiniAppIntent {
  const appName = input.appName.trim();
  const extensionBundleId = input.extensionBundleId.trim();
  const teamId = input.teamId.trim();
  if (!appName) throw new Error("appName is required");
  if (!extensionBundleId) throw new Error("extensionBundleId is required");
  if (!teamId) throw new Error("teamId is required");
  const intent: SpectrumCustomizedMiniAppIntent = {
    kind: "customizedMiniApp",
    appName,
    extensionBundleId,
    teamId,
    url: requireUrl(input.url),
  };
  if (input.live) intent.live = true;
  if (typeof input.appStoreId === "number" && Number.isFinite(input.appStoreId)) {
    intent.appStoreId = input.appStoreId;
  }
  if (input.layout) {
    const layout: SpectrumMiniAppLayout = {};
    for (const key of [
      "caption",
      "subcaption",
      "trailingCaption",
      "trailingSubcaption",
      "imageTitle",
      "imageSubtitle",
      "summary",
    ] as const) {
      const value = input.layout[key]?.trim();
      if (value) layout[key] = value;
    }
    if (Object.keys(layout).length > 0) intent.layout = layout;
  }
  return intent;
}

export function buildNativeContactCardIntent(): SpectrumNativeContactCardIntent {
  return { kind: "nativeContactCard" };
}

export function buildContactIntent(input: {
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
  orgName?: string;
}): SpectrumContactIntent {
  const firstName = input.firstName.trim();
  if (!firstName) throw new Error("firstName is required");
  const intent: SpectrumContactIntent = { kind: "contact", firstName };
  if (input.lastName?.trim()) intent.lastName = input.lastName.trim();
  if (input.phone?.trim()) intent.phone = input.phone.trim();
  if (input.email?.trim()) intent.email = input.email.trim();
  if (input.orgName?.trim()) intent.orgName = input.orgName.trim();
  return intent;
}

export function buildVoiceIntent(input: {
  source: string;
  name?: string;
  mimeType?: string;
  durationSeconds?: number;
}): SpectrumVoiceIntent {
  const source = input.source.trim();
  if (!source) throw new Error("voice source is required");
  const intent: SpectrumVoiceIntent = { kind: "voice", source };
  if (input.name?.trim()) intent.name = input.name.trim();
  if (input.mimeType?.trim()) intent.mimeType = input.mimeType.trim();
  if (typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds)) {
    intent.durationSeconds = input.durationSeconds;
  }
  return intent;
}

export function buildLiveLocationProxyIntent(
  url: string,
  opts?: { liveApp?: boolean },
): SpectrumLiveLocationProxyIntent {
  return {
    kind: "liveLocationProxy",
    url: requireUrl(url),
    liveApp: opts?.liveApp !== false,
  };
}

export function spectrumIntentIdempotencyKey(
  intent: SpectrumSendIntent,
  toHandle: string,
): string {
  const detail =
    intent.kind === "nativeContactCard"
      ? "-"
      : intent.kind === "contact"
        ? intent.firstName
        : intent.kind === "voice"
          ? intent.source
          : intent.url;
  return `spectrum-native:${intent.kind}:${toHandle}:${detail}`;
}

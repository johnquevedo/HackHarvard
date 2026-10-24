import { describe, expect, it, vi } from "vitest";
import { anyNativeOutboundEnabled, parsePhotonNativeBreadthFlags } from "./flags";
import {
  SPECTRUM_NATIVE_MATRIX,
  buildCustomizedMiniAppIntent,
  buildLiveLocationProxyIntent,
  buildNativeContactCardIntent,
  buildRichlinkIntent,
  buildSpectrumAppIntent,
  buildVoiceIntent,
  mapsCoordinateUrl,
  spectrumIntentIdempotencyKey,
} from "./spectrum-content";
import { assertIntentAllowed, sendSpectrumIntent } from "./send-spectrum";

describe("spectrum native intents", () => {
  it("builds app, richlink, miniapp, and contact-card intents", () => {
    expect(buildSpectrumAppIntent("https://example.com/x", { live: true })).toEqual({
      kind: "app",
      url: "https://example.com/x",
      live: true,
    });
    expect(buildRichlinkIntent("https://example.com/y")).toEqual({
      kind: "richlink",
      url: "https://example.com/y",
    });
    expect(
      buildCustomizedMiniAppIntent({
        appName: "Dennis",
        extensionBundleId: "com.dennis.imessage",
        teamId: "ABCDE12345",
        url: "https://example.com/app",
        layout: { caption: "Open", subcaption: "  " },
      }),
    ).toEqual({
      kind: "customizedMiniApp",
      appName: "Dennis",
      extensionBundleId: "com.dennis.imessage",
      teamId: "ABCDE12345",
      url: "https://example.com/app",
      layout: { caption: "Open" },
    });
    expect(buildNativeContactCardIntent()).toEqual({ kind: "nativeContactCard" });
    expect(buildVoiceIntent({ source: "./note.m4a" }).kind).toBe("voice");
    expect(mapsCoordinateUrl(42.36, -71.06)).toContain("maps.apple.com");
    expect(buildLiveLocationProxyIntent("https://maps.apple.com/?ll=1,2").kind).toBe(
      "liveLocationProxy",
    );
    expect(SPECTRUM_NATIVE_MATRIX.proxyOnly.length).toBeGreaterThan(0);
    expect(
      spectrumIntentIdempotencyKey(buildSpectrumAppIntent("https://example.com"), "+1555"),
    ).toContain("spectrum-native:app:");
  });
});

describe("spectrum send gating", () => {
  it("requires matching env flags", () => {
    const off = parsePhotonNativeBreadthFlags({});
    expect(off.spectrumLiveLocationProxyEnabled).toBe(false);
    expect(() => assertIntentAllowed(buildSpectrumAppIntent("https://example.com"), off)).toThrow(
      /SPECTRUM_WEBAPP/,
    );
    expect(() => assertIntentAllowed(buildNativeContactCardIntent(), off)).toThrow(
      /SPECTRUM_CONTACT_CARD/,
    );
    expect(() => assertIntentAllowed(buildVoiceIntent({ source: "a.m4a" }), off)).toThrow(
      /NATIVE_VOICE/,
    );
    const on = parsePhotonNativeBreadthFlags({
      DENNIS_PHOTON_SPECTRUM_WEBAPP: "1",
      DENNIS_PHOTON_SPECTRUM_CONTACT_CARD: "true",
      DENNIS_PHOTON_NATIVE_VOICE: "1",
      DENNIS_PHOTON_SPECTRUM_LIVE_LOCATION: "on",
    });
    expect(anyNativeOutboundEnabled(on)).toBe(true);
    expect(() =>
      assertIntentAllowed(buildSpectrumAppIntent("https://example.com"), on),
    ).not.toThrow();
    expect(() =>
      assertIntentAllowed(buildLiveLocationProxyIntent("https://maps.apple.com/?ll=1,2"), on),
    ).not.toThrow();
  });
});

describe("sendSpectrumIntent", () => {
  it("sends through injected deps when flags allow", async () => {
    const buildContent = vi.fn(async () => ({ type: "app" }));
    const sendToSpace = vi.fn(async () => ({
      messageId: "msg_webapp_1",
      spaceId: "spectrum|+15550001111|spc_1",
    }));
    const flags = parsePhotonNativeBreadthFlags({ DENNIS_PHOTON_SPECTRUM_WEBAPP: "1" });
    const intent = buildSpectrumAppIntent("https://example.com/app", { live: true });
    const result = await sendSpectrumIntent(
      intent,
      {
        credentials: { projectId: "proj", projectSecret: "secret" },
        target: { toHandle: "+15551234567" },
        flags,
      },
      { buildContent, sendToSpace },
    );

    expect(buildContent).toHaveBeenCalledWith(intent);
    expect(sendToSpace).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      kind: "app",
      providerMessageId: "msg_webapp_1",
      spaceId: "spectrum|+15550001111|spc_1",
      mode: "live",
    });
  });

  it("sends voice when voice flag is on", async () => {
    const result = await sendSpectrumIntent(
      buildVoiceIntent({ source: "./note.m4a", durationSeconds: 3 }),
      {
        credentials: { projectId: "proj", projectSecret: "secret" },
        target: { toHandle: "+15551234567" },
        flags: parsePhotonNativeBreadthFlags({ DENNIS_PHOTON_NATIVE_VOICE: "1" }),
      },
      {
        buildContent: async () => ({ type: "voice" }),
        sendToSpace: async () => ({ messageId: "msg_v", spaceId: "spectrum|+1|spc" }),
      },
    );
    expect(result.kind).toBe("voice");
    expect(result.providerMessageId).toBe("msg_v");
  });
});

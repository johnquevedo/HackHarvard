import type { Photon } from "@photon-ai/api";
import type { AppConfig, Clock } from "@dennis/contracts";
import { normalizeHandle } from "../index.ts";
import { normalizePhotonEvent } from "./normalize.ts";
export type PreflightApi = Pick<Photon["projects"], "platforms" | "listMessages">;
export async function photonPreflight(api: PreflightApi, config: AppConfig, clock: Clock) {
  const path = { id: config.photonProjectId! };
  const settings = await api.platforms.getImessage({ path });
  const senders = [
    { label: "Alice", handle: normalizeHandle(config.demoAliceHandle).handle },
    { label: "Bob", handle: normalizeHandle(config.demoBobHandle).handle },
  ];
  const assigned = new Set<string>();
  let assignmentsComplete = settings.mode !== "shared";
  if (settings.mode === "shared") {
    let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await api.platforms.imessage.assignments.list({
        path,
        query: { pageSize: 200, ...(pageToken ? { pageToken } : {}) },
      });
      for (const assignment of result.assignments) {
        if (assignment.platform !== "imessage" || assignment.releasedAt) continue;
        try {
          assigned.add(normalizeHandle(assignment.handle).handle);
        } catch {
          /* Invalid provider handle. */
        }
      }
      pageToken = result.nextPageToken;
      if (!pageToken) {
        assignmentsComplete = true;
        break;
      }
    }
  }
  const recent = new Map<string, string>();
  const since = new Date(clock.now().getTime() - 30 * 60000).toISOString();
  let pageToken: string | undefined;
  let messagesComplete = false;
  for (let page = 0; page < 20; page++) {
    const result = await api.listMessages({
      path,
      query: {
        direction: "received",
        platform: "imessage",
        createdSince: since,
        pageSize: 200,
        ...(pageToken ? { pageToken } : {}),
      },
    });
    for (const raw of result.items) {
      const message = normalizePhotonEvent(raw, config.photonAgentUserId!, config.photonSpaceMode);
      if (!message || message.receivedAt < since || message.receivedAt > clock.nowIso()) continue;
      let handle: string;
      try {
        handle = normalizeHandle(message.senderHandle).handle;
      } catch {
        continue;
      }
      if (
        senders.some((sender) => sender.handle === handle) &&
        (recent.get(handle) ?? "") < message.receivedAt
      )
        recent.set(handle, message.receivedAt);
    }
    pageToken = result.nextPageToken;
    if (!pageToken) {
      messagesComplete = true;
      break;
    }
  }
  return {
    checkedAt: clock.nowIso(),
    lineMode: settings.mode,
    dedicatedLineAvailableNow: settings.dedicatedLineAvailableNow,
    maxUserAssignments: settings.mode === "shared" ? settings.maxUserAssignments : null,
    assignmentsComplete,
    messagesComplete,
    senders: senders.map(({ label, handle }) => ({
      label,
      maskedHandle: "***" + handle.slice(-4),
      assigned: settings.mode === "shared" ? assigned.has(handle) : null,
      recentInboundAt: recent.get(handle) ?? null,
    })),
    deliveryVerified: false,
  };
}

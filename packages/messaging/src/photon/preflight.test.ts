import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AppConfigSchema } from "@dennis/contracts";
import { photonPreflight, type PreflightApi } from "./preflight.ts";
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../../fixtures/photon/inbound-text.synthetic.json", import.meta.url),
    "utf8",
  ),
);
const now = new Date("2026-10-17T12:01:00Z");
const clock = { now: () => now, nowIso: () => now.toISOString() };
const config = AppConfigSchema.parse({
  dennisAdminToken: "test-preflight-admin",
  photonProjectId: "pho_prj_test",
  photonAgentUserId: "pho_usr_agent",
});
it("reads paginated assignments and recent incoming texts without writing or exposing full handles", async () => {
  let assignments = 0;
  const api = {
    platforms: {
      getImessage: async () => ({
        mode: "shared",
        maxUserAssignments: 2,
        dedicatedLineAvailableNow: false,
      }),
      imessage: {
        assignments: {
          list: async () =>
            ++assignments === 1
              ? {
                  assignments: [{ platform: "imessage", handle: " ALICE@EXAMPLE.TEST " }],
                  nextPageToken: "second",
                }
              : {
                  assignments: [
                    {
                      platform: "imessage",
                      handle: config.demoBobHandle,
                      releasedAt: "2026-10-17T12:00:00Z",
                    },
                  ],
                },
        },
      },
    },
    listMessages: async () => ({ items: [fixture] }),
  } as unknown as PreflightApi;
  const report = await photonPreflight(api, config, clock);
  expect(assignments).toBe(2);
  expect(report).toMatchObject({
    assignmentsComplete: true,
    messagesComplete: true,
    deliveryVerified: false,
  });
  expect(report.senders[0]).toMatchObject({
    label: "Alice",
    assigned: true,
    recentInboundAt: fixture.timestamps.receivedAt,
  });
  expect(report.senders[1]).toMatchObject({ label: "Bob", assigned: false, recentInboundAt: null });
  expect(JSON.stringify(report)).not.toContain(config.demoAliceHandle);
  expect(JSON.stringify(report)).not.toContain(fixture.content.text);
});
it("reports incomplete bounded pagination instead of claiming absent senders are verified", async () => {
  const api = {
    platforms: {
      getImessage: async () => ({ mode: "dedicated", dedicatedLineAvailableNow: true }),
    },
    listMessages: async () => ({ items: [], nextPageToken: "still-more" }),
  } as unknown as PreflightApi;
  const report = await photonPreflight(api, config, clock);
  expect(report.messagesComplete).toBe(false);
  expect(report.senders.every((s) => s.assigned === null && s.recentInboundAt === null)).toBe(true);
  expect(report.deliveryVerified).toBe(false);
});

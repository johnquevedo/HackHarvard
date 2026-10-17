import { describe, expect, it } from "vitest";
import { openEventStream, reduceEvents, streamUrl, type StreamSource } from "./useEventStream";
import type { DomainEvent } from "./types";

const sample = {
  seq: 2,
  id: "evt_2",
  ts: "2026-10-17T19:00:02.000Z",
  type: "intent.detected",
  actor: { kind: "agent" },
  visibility: "private",
  opportunityId: null,
  traceId: "t",
  mode: "simulated",
  payload: {},
} as DomainEvent;

class FakeSource implements StreamSource {
  static urls: string[] = [];
  static last: FakeSource | null = null;
  listeners = new Map<string, (event: { lastEventId: string; data: string }) => void>();
  constructor(url: string) {
    FakeSource.urls.push(url);
    FakeSource.last = this;
  }
  addEventListener(
    type: string,
    listener: (event: { lastEventId: string; data: string }) => void,
  ): void {
    this.listeners.set(type, listener);
  }
  emit(data: string, id: string): void {
    this.listeners.get("domain")?.({ lastEventId: id, data });
  }
  fail(): void {
    this.listeners.get("error")?.({ lastEventId: "", data: "" });
  }
  close(): void {}
}

describe("event stream", () => {
  it("de-duplicates by seq and resumes with sinceSeq", () => {
    const first = reduceEvents([], sample);
    expect(reduceEvents(first, sample)).toHaveLength(1);
    FakeSource.urls = [];
    const seen: DomainEvent[] = [];
    openEventStream(
      { viewerAgentId: "agt_demo_bob" },
      { EventSource: FakeSource as unknown as new (url: string) => StreamSource },
      (event) => seen.push(event),
      () => {},
    );
    expect(FakeSource.urls[0]).toContain("viewerAgentId=agt_demo_bob");
    FakeSource.last?.emit(JSON.stringify(sample), "2");
    expect(seen).toHaveLength(1);
    FakeSource.last?.fail();
    expect(FakeSource.urls.at(-1)).toContain("sinceSeq=2");
    expect(streamUrl({ lastSeq: 4 })).toBe("/api/events/stream?sinceSeq=4");
  });
});

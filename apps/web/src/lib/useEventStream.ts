"use client";

import { useEffect, useState } from "react";
import events from "../mocks/events.json";
import type { DomainEvent } from "./types";
import { mockMode } from "./api";

export function reduceEvents(current: DomainEvent[], incoming: DomainEvent): DomainEvent[] {
  if (current.some((event) => event.seq === incoming.seq)) return current;
  return [...current, incoming].sort((left, right) => left.seq - right.seq);
}

export function streamUrl(opts: { viewerAgentId?: string; lastSeq?: number }): string {
  const params = new URLSearchParams();
  if (opts.viewerAgentId) params.set("viewerAgentId", opts.viewerAgentId);
  if (opts.lastSeq !== undefined) params.set("sinceSeq", String(opts.lastSeq));
  const query = params.toString();
  return query ? `/api/events/stream?${query}` : "/api/events/stream";
}

export interface StreamSource {
  addEventListener(
    type: string,
    listener: (event: { lastEventId: string; data: string }) => void,
  ): void;
  close(): void;
}

export function openEventStream(
  opts: { viewerAgentId?: string },
  deps: { EventSource: new (url: string) => StreamSource },
  onEvent: (event: DomainEvent) => void,
  onConnection: (connected: boolean) => void,
): () => void {
  let lastSeq: number | undefined;
  let source: StreamSource | null = null;
  let closed = false;
  const connect = () => {
    if (closed) return;
    source = new deps.EventSource(streamUrl({ viewerAgentId: opts.viewerAgentId, lastSeq }));
    onConnection(true);
    source.addEventListener("domain", (message) => {
      const parsed = JSON.parse(message.data) as DomainEvent;
      lastSeq = parsed.seq;
      onEvent(parsed);
    });
    source.addEventListener("error", () => {
      onConnection(false);
      source?.close();
      if (!closed) connect();
    });
  };
  connect();
  return () => {
    closed = true;
    source?.close();
  };
}

export function useEventStream(opts: { viewerAgentId?: string }): {
  events: DomainEvent[];
  connected: boolean;
} {
  const [items, setItems] = useState<DomainEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const viewer = opts.viewerAgentId;

  useEffect(() => {
    if (mockMode) {
      setConnected(true);
      setItems(events as DomainEvent[]);
      return;
    }
    const Source = globalThis.EventSource;
    if (!Source) {
      setConnected(false);
      return;
    }
    return openEventStream(
      { viewerAgentId: viewer },
      { EventSource: Source as unknown as new (url: string) => StreamSource },
      (event) => setItems((current) => reduceEvents(current, event)),
      setConnected,
    );
  }, [viewer]);

  return { events: items, connected };
}

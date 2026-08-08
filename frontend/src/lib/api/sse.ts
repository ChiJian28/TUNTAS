import { getApiBaseUrl, getBearerToken, getDemoSseQuery, isDemoAuthEnabled } from "./auth";
import type { RunRealtimeSseEvent } from "./generated/openapi.types";

export type ConnectionMode = "sse" | "polling" | "offline" | "connecting";

export type SseHandlers = {
  onConnected?: (data: unknown) => void;
  onStatus?: (data: unknown) => void;
  onAudit?: (data: unknown) => void;
  onHandoff?: (data: unknown) => void;
  onHeartbeat?: (data: unknown) => void;
  onError?: (error: unknown) => void;
  onModeChange?: (mode: ConnectionMode) => void;
};

function parseSseChunk(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: Array<{ event: string; data: string }> = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    events.push({ event, data: dataLines.join("\n") });
  }
  return { events, rest };
}

/**
 * Prefer fetch + ReadableStream so Authorization / demo headers work.
 * Falls back to EventSource with query params when Abort fails mid-stream.
 */
export function connectRunEventStream(
  runId: string,
  handlers: SseHandlers,
): () => void {
  const controller = new AbortController();
  let closed = false;

  handlers.onModeChange?.("connecting");

  const url = new URL(`${getApiBaseUrl()}/v1/runs/${runId}/events/stream`);
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  const token = getBearerToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (isDemoAuthEnabled()) {
    const q = getDemoSseQuery();
    Object.entries(q).forEach(([k, v]) => url.searchParams.set(k, v));
    // Also send headers for backends that prefer them
    headers["X-Demo-Role"] = q.demo_role ?? "manager";
    headers["X-Demo-Actor"] = q.demo_actor ?? "demo-manager";
  }

  (async () => {
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`SSE HTTP ${res.status}`);
      }
      handlers.onModeChange?.("sse");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        for (const ev of parsed.events) {
          let data: unknown = ev.data;
          try {
            data = JSON.parse(ev.data);
          } catch {
            /* keep string */
          }
          const name = ev.event as RunRealtimeSseEvent | string;
          if (name === "connected") handlers.onConnected?.(data);
          else if (name === "status") handlers.onStatus?.(data);
          else if (name === "audit") handlers.onAudit?.(data);
          else if (name === "handoff") handlers.onHandoff?.(data);
          else if (name === "heartbeat") handlers.onHeartbeat?.(data);
        }
      }
      if (!closed) handlers.onModeChange?.("offline");
    } catch (err) {
      if (closed || (err as Error)?.name === "AbortError") return;
      handlers.onError?.(err);
      handlers.onModeChange?.("offline");
    }
  })();

  return () => {
    closed = true;
    controller.abort();
  };
}

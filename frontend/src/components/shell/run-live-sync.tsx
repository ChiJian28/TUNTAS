"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiQueries } from "@/lib/api/queries";
import { queryKeys } from "@/lib/api/query-keys";
import { connectRunEventStream } from "@/lib/api/sse";
import type { RunStatus } from "@/lib/api/generated/openapi.types";
import { useUiStore } from "@/stores/ui-store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const LIVE_STATUSES: RunStatus[] = [
  "running",
  "revising",
  "approved_processing",
];

const TERMINAL_STATUSES: RunStatus[] = ["completed", "rejected", "failed"];

function isLiveStatus(status: string | undefined | null): boolean {
  return Boolean(status && LIVE_STATUSES.includes(status));
}

function isTerminalStatus(status: string | undefined | null): boolean {
  return Boolean(status && TERMINAL_STATUSES.includes(status));
}

/**
 * Connects SSE while run is live; falls back to polling without claiming Realtime.
 */
export function RunLiveSync({
  runId,
  className,
}: {
  runId: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const connectionMode = useUiStore((s) => s.connectionMode);
  const setConnectionMode = useUiStore((s) => s.setConnectionMode);
  const disconnectRef = useRef<(() => void) | null>(null);

  const statusQuery = useQuery({
    ...apiQueries.runStatus(runId),
    refetchInterval: (q) => {
      const mode = useUiStore.getState().connectionMode;
      if (mode !== "polling") return false;
      const st = q.state.data?.status;
      if (isTerminalStatus(st)) return false;
      if (isLiveStatus(st)) return 4_000;
      if (st === "awaiting_approval") return 10_000;
      return false;
    },
  });

  const status = statusQuery.data?.status;
  const polling = connectionMode === "polling";

  useQuery({
    ...apiQueries.timeline(runId),
    enabled: polling && isLiveStatus(status),
    refetchInterval: polling && isLiveStatus(status) ? 2_000 : false,
  });

  useQuery({
    ...apiQueries.handoffs(runId, true),
    enabled: polling && isLiveStatus(status),
    refetchInterval: polling && isLiveStatus(status) ? 3_000 : false,
  });

  useEffect(() => {
    function cleanupStream() {
      disconnectRef.current?.();
      disconnectRef.current = null;
    }

    if (isTerminalStatus(status)) {
      cleanupStream();
      setConnectionMode("offline");
      return cleanupStream;
    }

    if (!isLiveStatus(status) && status !== "awaiting_approval") {
      cleanupStream();
      if (status === "created" || !status) setConnectionMode("offline");
      return cleanupStream;
    }

    cleanupStream();
    setConnectionMode("connecting");

    const disconnect = connectRunEventStream(runId, {
      onModeChange: (mode) => {
        if (mode === "sse") {
          setConnectionMode("sse");
        } else if (mode === "connecting") {
          setConnectionMode("connecting");
        } else if (mode === "offline") {
          if (isLiveStatus(status) || status === "awaiting_approval") {
            setConnectionMode("polling");
            void qc.invalidateQueries({ queryKey: queryKeys.timeline(runId) });
            void qc.invalidateQueries({ queryKey: queryKeys.runStatus(runId) });
          } else {
            setConnectionMode("offline");
          }
        }
      },
      onError: () => {
        if (isLiveStatus(status) || status === "awaiting_approval") {
          setConnectionMode("polling");
        }
      },
      onConnected: () => {
        setConnectionMode("sse");
        void qc.invalidateQueries({ queryKey: queryKeys.cockpit(runId) });
        void qc.invalidateQueries({ queryKey: queryKeys.runStatus(runId) });
      },
      onStatus: () => {
        void qc.invalidateQueries({ queryKey: queryKeys.runStatus(runId) });
        void qc.invalidateQueries({ queryKey: queryKeys.run(runId) });
        void qc.invalidateQueries({ queryKey: queryKeys.cockpit(runId) });
        void qc.invalidateQueries({ queryKey: queryKeys.timeline(runId) });
        void qc.invalidateQueries({ queryKey: queryKeys.gates(runId) });
      },
      onHandoff: () => {
        void qc.invalidateQueries({ queryKey: ["handoffs", runId] });
        void qc.invalidateQueries({ queryKey: queryKeys.timeline(runId) });
        void qc.invalidateQueries({ queryKey: queryKeys.cockpit(runId) });
        void qc.invalidateQueries({ queryKey: queryKeys.gates(runId) });
      },
      onAudit: () => {
        void qc.invalidateQueries({ queryKey: queryKeys.events(runId) });
        void qc.invalidateQueries({ queryKey: queryKeys.timeline(runId) });
        void qc.invalidateQueries({ queryKey: queryKeys.cockpit(runId) });
        void qc.invalidateQueries({ queryKey: queryKeys.gates(runId) });
      },
    });

    disconnectRef.current = disconnect;
    return cleanupStream;
  }, [runId, status, qc, setConnectionMode]);

  const label =
    connectionMode === "sse"
      ? "Live · SSE"
      : connectionMode === "polling"
        ? "Live updates · polling fallback"
        : connectionMode === "connecting"
          ? "Connecting…"
          : null;

  if (!label) return null;

  return (
    <div className={cn("px-4 py-1.5", className)}>
      <Badge
        variant={connectionMode === "sse" ? "success" : "warning"}
        className="font-normal"
      >
        {label}
      </Badge>
    </div>
  );
}

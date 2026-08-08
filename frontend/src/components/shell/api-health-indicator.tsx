"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiQueries } from "@/lib/api/queries";
import { getApiBaseUrl } from "@/lib/api/auth";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatRelativeRefresh } from "@/lib/format/time";

/**
 * Three-state health chip:
 * - checking: first paint / in-flight (never flash "unreachable")
 * - reachable: last fetch succeeded
 * - unreachable: last fetch failed
 */
export function ApiHealthIndicator({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const fetchStartedAt = useRef<number | null>(null);

  const health = useQuery({
    ...apiQueries.health,
    refetchInterval: 30_000,
    retry: 1,
    retryDelay: 400,
    // Keep prior success while refetching so we don't flicker unreachable.
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (health.isFetching) {
      fetchStartedAt.current = performance.now();
      return;
    }
    if (health.isSuccess && fetchStartedAt.current != null) {
      setLatencyMs(Math.round(performance.now() - fetchStartedAt.current));
      fetchStartedAt.current = null;
    }
  }, [health.isFetching, health.isSuccess]);

  const checking = health.isPending || (health.isFetching && !health.isSuccess && !health.isError);
  const reachable = health.isSuccess;
  const unreachable = health.isError && !health.isSuccess;

  let baseUrl = "unset";
  try {
    baseUrl = getApiBaseUrl();
  } catch {
    baseUrl = "missing env";
  }

  const label = checking
    ? "Checking API…"
    : reachable
      ? "API reachable"
      : "API unreachable";

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors",
          checking &&
            "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted-foreground)]",
          reachable &&
            !checking &&
            "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--foreground)]",
          unreachable &&
            "border-[var(--destructive)] bg-[var(--destructive-soft)] text-[var(--destructive)]",
        )}
        aria-expanded={open}
        aria-busy={checking}
      >
        {checking ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Activity className="size-3.5" aria-hidden />
        )}
        <span>{label}</span>
        <Badge
          variant={
            checking ? "muted" : reachable ? "success" : "destructive"
          }
          className="ml-1"
        >
          {checking ? "…" : reachable ? "ok" : "error"}
        </Badge>
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 shadow-sm">
          <p className="font-display text-base text-[var(--foreground)]">
            API connection
          </p>
          <dl className="mt-3 space-y-2 text-xs text-[var(--muted-foreground)]">
            <div className="flex justify-between gap-3">
              <dt>Base URL</dt>
              <dd className="break-all text-right font-mono text-[var(--foreground)]">
                {baseUrl}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>App</dt>
              <dd className="font-mono">{health.data?.app ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Env</dt>
              <dd className="font-mono">{health.data?.env ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Last check</dt>
              <dd className="font-mono">
                {health.dataUpdatedAt
                  ? formatRelativeRefresh(new Date(health.dataUpdatedAt))
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Latency</dt>
              <dd className="font-mono">
                {latencyMs != null ? `${latencyMs} ms` : "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            Shows API reachability only — not Gemini, Tavily, or database health.
          </p>
          {health.isError ? (
            <p className="mt-2 text-xs text-[var(--destructive)]">
              {(health.error as Error)?.message ?? "Health check failed"}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

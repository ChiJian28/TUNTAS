"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { apiQueries } from "@/lib/api/queries";
import { OPTION_LABELS } from "@/lib/constants/agents";
import { formatKlShort, formatRelativeRefresh } from "@/lib/format/time";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

function connectionLabel(mode: string): string {
  switch (mode) {
    case "sse":
      return "Live · SSE";
    case "polling":
      return "Live updates · polling fallback";
    case "connecting":
      return "Connecting…";
    case "offline":
      return "Offline";
    default:
      return mode;
  }
}

export function RunContextBar({
  runId,
  className,
}: {
  runId: string;
  className?: string;
}) {
  const proofLensEnabled = useUiStore((s) => s.proofLensEnabled);
  const setProofLensEnabled = useUiStore((s) => s.setProofLensEnabled);
  const connectionMode = useUiStore((s) => s.connectionMode);
  const [copied, setCopied] = useState(false);

  const cockpit = useQuery({
    ...apiQueries.cockpit(runId),
  });

  const run = cockpit.data?.run;
  const options = cockpit.data?.options ?? [];
  const selectedId = run?.selected_option_id;
  const selectedOption = options.find((o) => o.id === selectedId);
  const optionLabel = selectedOption
    ? (OPTION_LABELS[selectedOption.option_key] ?? selectedOption.label)
    : selectedId
      ? selectedId
      : "—";

  async function copyRunId() {
    await navigator.clipboard.writeText(runId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-y-4 border-b border-[var(--border)] bg-[var(--surface-raised)] px-6 py-3.5",
        className,
      )}
    >
      {cockpit.isLoading ? (
        <div className="flex w-full flex-wrap gap-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-32" />
        </div>
      ) : (
        <>
          {/* Identity + progress */}
          <div className="flex flex-wrap items-end gap-6">
            <Meta label="Request" value={run?.request_id ?? "—"} mono />

            <Meta
              label="Run"
              value={runId}
              mono
              action={
                <button
                  type="button"
                  onClick={() => void copyRunId()}
                  className="ml-1.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                  aria-label="Copy run ID"
                >
                  {copied ? (
                    <Check className="size-3.5 text-[var(--success)]" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </button>
              }
            />

            {run?.status ? (
              <div className="pb-[1px]">
                <StatusPill status={run.status} />
              </div>
            ) : null}

            <div className="mx-2 h-7 w-px bg-[var(--border)]" aria-hidden />

            <Meta label="Node" value={run?.current_node ?? "—"} mono />
            <Meta label="Option" value={optionLabel} />
          </div>

          {/* Metadata + controls */}
          <div className="ml-auto flex flex-wrap items-end gap-6">
            {run?.updated_at ? (
              <span className="hidden pb-1 text-[10px] text-[var(--muted-foreground)] lg:inline">
                Updated {formatKlShort(run.updated_at)}
              </span>
            ) : null}

            <Meta
              label="Refreshed"
              value={
                cockpit.dataUpdatedAt
                  ? formatRelativeRefresh(new Date(cockpit.dataUpdatedAt))
                  : "—"
              }
              mono
            />

            <div className="pb-[1px]">
              <Badge
                variant={
                  connectionMode === "sse"
                    ? "success"
                    : connectionMode === "polling"
                      ? "warning"
                      : "muted"
                }
                className="px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
              >
                {connectionLabel(connectionMode)}
              </Badge>
            </div>

            <div className="mx-2 h-7 w-px bg-[var(--border)]" aria-hidden />

            <div className="flex items-center gap-2 pb-0.5">
              <Label
                htmlFor="proof-lens"
                className="cursor-pointer text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]"
              >
                Proof Lens
              </Label>
              <Switch
                id="proof-lens"
                checked={proofLensEnabled}
                onCheckedChange={setProofLensEnabled}
                className="origin-right scale-75"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
  action,
}: {
  label: string;
  value: string;
  mono?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-end">
      <span className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
        {label}
      </span>
      <div className="flex h-5 items-center">
        <span
          className={cn(
            "truncate text-xs text-[var(--foreground)]",
            mono && "font-mono font-medium",
          )}
          title={value}
        >
          {value}
        </span>
        {action}
      </div>
    </div>
  );
}

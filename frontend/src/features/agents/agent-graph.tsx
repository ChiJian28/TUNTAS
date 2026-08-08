"use client";

import { useMemo } from "react";
import { Loader2, Zap } from "lucide-react";

import type { AgentHandoffView, RunStatus } from "@/lib/api/generated/openapi.types";
import { AGENT_PIPELINE } from "@/lib/constants/agents";
import { formatKlMinute } from "@/lib/format/time";
import { formatRatioPercent } from "@/lib/format/score";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  collectCompletionSignals,
  collectFailureSignals,
  deriveAgentStates,
  type DerivedAgentNode,
} from "./derive-agent-state";

type AgentGraphProps = {
  currentNode?: string | null;
  status?: RunStatus | null;
  handoffs: AgentHandoffView[];
  events?: Array<{
    event_type?: string;
    payload?: Record<string, unknown>;
    kind?: string;
  }>;
  onSelectNode?: (node: DerivedAgentNode) => void;
  className?: string;
};

/** Border-only rings — card stays white; soft fills were too heavy for SaaS density. */
const STATE_STYLES: Record<
  DerivedAgentNode["state"],
  {
    ring: string;
    badge: "muted" | "evidence" | "success" | "warning" | "destructive";
    pulse?: boolean;
  }
> = {
  queued: { ring: "border-[var(--border)]", badge: "muted" },
  active: {
    ring: "border-[var(--evidence)]",
    badge: "evidence",
    pulse: true,
  },
  completed: {
    ring: "border-[var(--success)]/45",
    badge: "success",
  },
  review: {
    ring: "border-[var(--warning)]/55",
    badge: "warning",
  },
  failed: {
    ring: "border-[var(--destructive)]/55",
    badge: "destructive",
  },
};

export function AgentGraph({
  currentNode,
  status,
  handoffs,
  events = [],
  onSelectNode,
  className,
}: AgentGraphProps) {
  const nodes = useMemo(() => {
    const failures = collectFailureSignals(events);
    const completions = collectCompletionSignals(events);
    return deriveAgentStates({
      currentNode,
      status,
      handoffs,
      failures,
      completions,
    });
  }, [currentNode, status, handoffs, events]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const intake = byId.get("intake");
  const parallel = AGENT_PIPELINE.filter((n) => n.branch === "parallel").map(
    (n) => byId.get(n.id)!,
  );
  const serial = AGENT_PIPELINE.filter((n) => n.branch === "serial").map(
    (n) => byId.get(n.id)!,
  );
  const terminal =
    status === "completed" || status === "rejected" || status === "failed";

  return (
    <div className={cn("w-full overflow-x-auto pb-4", className)}>
      <div className="flex min-w-max items-center py-4">
        {/* 1. Intake */}
        {intake ? (
          <div className="flex items-center">
            <AgentNodeCard
              node={intake}
              terminal={terminal}
              onClick={() => onSelectNode?.(intake)}
            />
            <div className="h-px w-6 bg-[var(--border-strong)]" aria-hidden />
          </div>
        ) : null}

        {/* 2. Parallel fork / join bracket */}
        <div className="flex items-stretch">
          <div className="my-6 w-px bg-[var(--border-strong)]" aria-hidden />

          <div className="flex flex-col justify-center gap-4 py-2">
            {parallel.map((node) => (
              <div key={node.id} className="flex items-center">
                <div className="h-px w-4 bg-[var(--border-strong)]" aria-hidden />
                <AgentNodeCard
                  node={node}
                  compact
                  terminal={terminal}
                  onClick={() => onSelectNode?.(node)}
                />
                <div className="h-px w-4 bg-[var(--border-strong)]" aria-hidden />
              </div>
            ))}
          </div>

          <div className="my-6 w-px bg-[var(--border-strong)]" aria-hidden />
        </div>

        {/* 3. Serial pipeline */}
        <div className="flex items-center">
          <div className="h-px w-6 bg-[var(--border-strong)]" aria-hidden />
          {serial.map((node, idx) => (
            <div key={node.id} className="flex items-center">
              {idx > 0 ? (
                <div className="h-px w-6 bg-[var(--border-strong)]" aria-hidden />
              ) : null}
              <AgentNodeCard
                node={node}
                terminal={terminal}
                onClick={() => onSelectNode?.(node)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentNodeCard({
  node,
  onClick,
  compact,
  terminal,
}: {
  node: DerivedAgentNode;
  onClick?: () => void;
  compact?: boolean;
  terminal?: boolean;
}) {
  const style = STATE_STYLES[node.state];
  const showPulse = style.pulse && !terminal;
  const hasMeta =
    !!node.timestamp ||
    node.latencyMs != null ||
    node.citationCoverage != null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col rounded-xl border bg-[var(--surface-raised)] p-3 text-left shadow-sm transition-all hover:border-[var(--border-strong)] hover:shadow-md",
        style.ring,
        compact ? "w-52" : "w-56",
        showPulse &&
          "animate-pulse ring-2 ring-[var(--evidence)] ring-offset-2 ring-offset-[var(--background)]",
      )}
    >
      <div className="mb-2 flex w-full items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
        <span className="font-semibold tracking-tight text-[var(--foreground)] font-[family-name:var(--font-sans)]">
          {node.label}
        </span>
        <Badge
          variant={style.badge}
          className="px-1.5 py-0 text-[10px] capitalize"
        >
          {node.state === "active" ? (
            <span className="flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Active
            </span>
          ) : (
            node.state
          )}
        </Badge>
      </div>

      {hasMeta ? (
        <div className="grid w-full grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[11px] font-[family-name:var(--font-mono)]">
          {node.timestamp ? (
            <>
              <span className="text-[var(--muted-foreground)]">Time</span>
              <span className="text-right tabular-nums text-[var(--body)]">
                {formatKlMinute(node.timestamp)}
              </span>
            </>
          ) : null}
          {node.latencyMs != null ? (
            <>
              <span className="text-[var(--muted-foreground)]">Latency</span>
              <span className="text-right tabular-nums text-[var(--body)]">
                {node.latencyMs}ms
              </span>
            </>
          ) : null}
          {node.citationCoverage != null ? (
            <>
              <span className="text-[var(--muted-foreground)]">Citations</span>
              <span className="text-right font-medium text-[var(--success)]">
                {formatRatioPercent(node.citationCoverage).text}
              </span>
            </>
          ) : null}
        </div>
      ) : (
        <p className="font-mono text-[11px] text-[var(--muted-foreground)]">
          handoffs {node.handoffCount}
          {node.evidenceSource === "event" && node.handoffCount === 0
            ? " · event"
            : ""}
        </p>
      )}

      {node.requiresReview ? (
        <div
          className="absolute -right-2 -top-2 rounded-full bg-[var(--warning)] p-1 text-[var(--surface-raised)] shadow-sm"
          title="Requires review"
        >
          <Zap className="size-3 fill-current" aria-hidden />
        </div>
      ) : null}
    </button>
  );
}

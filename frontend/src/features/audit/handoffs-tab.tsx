"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CopyIdButton } from "@/features/audit/copy-id";
import { JsonViewer } from "@/features/agents/json-viewer";
import type { AgentHandoffView } from "@/lib/api/generated/openapi.types";
import { parseHandoffEnvelope } from "@/lib/schemas/payloads";
import { formatKl } from "@/lib/format/time";
import { formatRatioPercent } from "@/lib/format/score";
import { cn } from "@/lib/utils";

type Props = {
  handoffs: AgentHandoffView[];
  highlightId?: string | null;
};

export function HandoffsTab({ handoffs, highlightId }: Props) {
  const [agent, setAgent] = useState("all");
  const [query, setQuery] = useState(highlightId ?? "");

  useEffect(() => {
    if (highlightId) setQuery(highlightId);
  }, [highlightId]);

  const agents = useMemo(
    () => Array.from(new Set(handoffs.map((h) => h.agent_name))).sort(),
    [handoffs],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return handoffs.filter((h) => {
      if (agent !== "all" && h.agent_name !== agent) return false;
      if (!q) return true;
      return (
        h.id.toLowerCase().includes(q) ||
        h.agent_name.toLowerCase().includes(q) ||
        h.input_hash.toLowerCase().includes(q)
      );
    });
  }, [handoffs, agent, query]);

  if (!handoffs.length) {
    return (
      <EmptyState
        title="No handoffs"
        description="Full handoff archive (latest_per_agent=false) will list every agent output."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] space-y-1">
          <Label className="text-[11px]">Agent</Label>
          <Select value={agent} onValueChange={setAgent}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[200px] flex-1 space-y-1">
          <Label className="text-[11px]">Search</Label>
          <Input
            className="h-8 text-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by id, agent, hash…"
          />
        </div>
      </div>

      <p className="text-[11px] text-[var(--muted-foreground)]">
        Loaded with latest_per_agent=false — full archive, not latest-only.
      </p>

      <ul className="flex flex-col gap-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]">
        {filtered.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-[var(--muted-foreground)]">
            No handoffs match the current filters.
          </li>
        ) : (
          filtered.map((h) => {
            const env = parseHandoffEnvelope(h.output_json);
            const highlighted = highlightId != null && h.id === highlightId;
            const citation = formatRatioPercent(h.citation_coverage);
            return (
              <li
                key={h.id}
                id={`handoff-${h.id}`}
                className={cn(
                  "space-y-3 border-b border-[var(--border)] p-5 transition-colors last:border-b-0",
                  highlighted
                    ? "bg-[var(--primary-soft)]/40"
                    : "hover:bg-[var(--surface)]/50",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="muted"
                    className="border border-[var(--border-strong)] bg-transparent font-mono text-[11px]"
                  >
                    {h.agent_name}
                  </Badge>
                  <span className="font-mono text-[11px] text-[var(--muted-foreground)]">
                    {formatKl(h.created_at)}
                  </span>
                  {h.latency_ms != null ? (
                    <Badge variant="muted" className="font-mono text-[11px]">
                      {h.latency_ms} ms
                    </Badge>
                  ) : null}
                  {h.citation_coverage != null ? (
                    <Badge variant="muted" className="font-mono text-[11px]">
                      Citations {citation.text}
                    </Badge>
                  ) : null}
                  <CopyIdButton value={h.id} label="Handoff ID" />
                </div>
                <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-[var(--body)]">
                  <span>input_hash:</span>
                  <CopyIdButton value={h.input_hash} label="Input hash" />
                </p>
                {h.model_name ? (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    model: {h.model_name}
                  </p>
                ) : null}
                {env.ok ? (
                  <JsonViewer data={env.data} className="max-h-48" />
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs text-[var(--warning)]">
                      Schema not recognized — raw output_json
                    </p>
                    <JsonViewer
                      data={h.output_json}
                      variant="code"
                      className="max-h-48"
                    />
                  </div>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

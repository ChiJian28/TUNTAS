"use client";

import { useMemo, useState } from "react";
import { Copy, Check, ChevronDown, ChevronRight } from "lucide-react";
import { JsonView, allExpanded, collapseAllNested, defaultStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";

import type { AgentHandoffView } from "@/lib/api/generated/openapi.types";
import { parseHandoffEnvelope } from "@/lib/schemas/payloads";
import { formatKl } from "@/lib/format/time";
import { formatRatioPercent } from "@/lib/format/score";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type HandoffInspectorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  handoff: AgentHandoffView | null;
  agentLabel?: string;
};

export function HandoffInspector({
  open,
  onOpenChange,
  handoff,
  agentLabel,
}: HandoffInspectorProps) {
  const [copied, setCopied] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [query, setQuery] = useState("");

  const envelope = useMemo(() => {
    if (!handoff) return null;
    return parseHandoffEnvelope(handoff.output_json ?? {});
  }, [handoff]);

  const displayData = useMemo(() => {
    if (!handoff) return {};
    if (envelope?.ok) return envelope.data;
    return handoff.output_json ?? {};
  }, [handoff, envelope]);

  const filteredData = useMemo(() => {
    if (!query.trim()) return displayData;
    const q = query.trim().toLowerCase();
    try {
      const raw = JSON.stringify(displayData);
      if (!raw.toLowerCase().includes(q)) {
        return { _search: `No matches for "${query}"`, source: displayData };
      }
    } catch {
      /* keep full */
    }
    return displayData;
  }, [displayData, query]);

  async function copyJson() {
    if (!handoff) return;
    const text = JSON.stringify(displayData, null, 2);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const fields = envelope?.ok
    ? {
        schema_version: envelope.data.schema_version,
        source_agent: envelope.data.source_agent ?? handoff?.agent_name,
        evidence_ids: envelope.data.evidence_ids,
        confidence: envelope.data.confidence,
        input_hash: envelope.data.input_hash ?? handoff?.input_hash,
        requires_review: envelope.data.requires_review,
      }
    : {
        schema_version: undefined,
        source_agent: handoff?.agent_name,
        evidence_ids: undefined,
        confidence: undefined,
        input_hash: handoff?.input_hash,
        requires_review: undefined,
      };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[var(--border)] px-6 py-4 text-left">
          <DialogTitle>
            Handoff inspector
            {agentLabel ? ` · ${agentLabel}` : ""}
          </DialogTitle>
          <DialogDescription>
            Persisted agent envelope from the backend. Vendor HTML is never rendered.
          </DialogDescription>
        </DialogHeader>

        {handoff ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid gap-3 border-b border-[var(--border)] px-6 py-4 sm:grid-cols-2">
              <MetaRow label="Handoff ID" value={handoff.id} mono />
              <MetaRow label="Agent" value={handoff.agent_name} mono />
              <MetaRow label="Created" value={formatKl(handoff.created_at)} />
              <MetaRow
                label="Latency"
                value={
                  handoff.latency_ms != null ? `${handoff.latency_ms} ms` : "—"
                }
              />
              <MetaRow label="Model" value={handoff.model_name ?? "—"} mono />
              <MetaRow
                label="Citation coverage"
                value={formatRatioPercent(handoff.citation_coverage).text}
              />
              <MetaRow label="schema_version" value={fields.schema_version ?? "—"} mono />
              <MetaRow label="source_agent" value={String(fields.source_agent ?? "—")} mono />
              <MetaRow
                label="confidence"
                value={
                  typeof fields.confidence === "number"
                    ? String(fields.confidence)
                    : "—"
                }
              />
              <MetaRow label="input_hash" value={fields.input_hash ?? "—"} mono />
              <MetaRow
                label="requires_review"
                value={
                  typeof fields.requires_review === "boolean"
                    ? String(fields.requires_review)
                    : "—"
                }
              />
              <div className="sm:col-span-2">
                <p className="text-xs text-[var(--muted-foreground)]">evidence_ids</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {Array.isArray(fields.evidence_ids) && fields.evidence_ids.length > 0 ? (
                    fields.evidence_ids.map((id) => (
                      <Badge key={id} variant="muted" className="font-mono text-[10px]">
                        {id}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-[var(--muted-foreground)]">—</span>
                  )}
                </div>
              </div>
              {!envelope?.ok ? (
                <p className="sm:col-span-2 text-xs text-[var(--warning)]">
                  Envelope did not match expected schema — showing raw JSON.
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-6 py-3">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search JSON text…"
                className="h-8 min-w-[12rem] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setExpandAll((v) => !v)}
              >
                {expandAll ? (
                  <ChevronDown className="size-3.5" aria-hidden />
                ) : (
                  <ChevronRight className="size-3.5" aria-hidden />
                )}
                {expandAll ? "Collapse nested" : "Expand all"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyJson()}>
                {copied ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <Copy className="size-3.5" aria-hidden />
                )}
                {copied ? "Copied" : "Copy JSON"}
              </Button>
            </div>

            <ScrollArea className="h-[min(420px,50vh)] px-4 py-3">
              <div
                className={cn(
                  "rounded-xl bg-[var(--code-background)] p-3 text-[var(--code-foreground)] text-xs font-mono",
                )}
              >
                <JsonView
                  data={filteredData as object}
                  shouldExpandNode={expandAll ? allExpanded : collapseAllNested}
                  style={defaultStyles}
                  clickToExpandNode
                />
              </div>
              {/* Intentionally never dangerouslySetInnerHTML for vendor HTML */}
            </ScrollArea>
          </div>
        ) : (
          <p className="px-6 py-8 text-sm text-[var(--muted-foreground)]">
            No handoff selected. Nodes without a persisted handoff stay queued.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p
        className={cn(
          "mt-0.5 break-all text-sm text-[var(--foreground)]",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </p>
    </div>
  );
}

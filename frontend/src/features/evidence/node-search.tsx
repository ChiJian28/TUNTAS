"use client";

import { Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { EvidenceNodeView } from "@/lib/api/generated/openapi.types";
import { cn } from "@/lib/utils";
import { toneForType } from "./type-tones";

const MAX_RESULTS = 12;

export function nodeMatchesQuery(node: EvidenceNodeView, q: string): boolean {
  if (!q) return false;
  const hay = [
    node.label,
    node.external_ref,
    node.id,
    node.node_type,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

type EvidenceNodeSearchProps = {
  nodes: EvidenceNodeView[];
  query: string;
  onQueryChange: (q: string) => void;
  onSelectNode: (nodeId: string) => void;
  className?: string;
};

/** Camera portal — search does not filter the graph; it navigates to a node. */
export function EvidenceNodeSearch({
  nodes,
  query,
  onQueryChange,
  onSelectNode,
  className,
}: EvidenceNodeSearchProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (q.length < 1) return [];
    const hits: EvidenceNodeView[] = [];
    for (const n of nodes) {
      if (!nodeMatchesQuery(n, q)) continue;
      hits.push(n);
      if (hits.length >= MAX_RESULTS) break;
    }
    return hits;
  }, [nodes, q]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]"
        aria-hidden
      />
      <Input
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Defer so option mousedown can fire first
          window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Enter" && results[0]) {
            e.preventDefault();
            onSelectNode(results[0].id);
            setOpen(false);
          }
        }}
        placeholder="Search nodes to focus…"
        className="h-7 border-[var(--border-strong)] bg-[var(--surface)] pl-8 text-xs"
        aria-label="Search evidence nodes"
        aria-autocomplete="list"
        aria-expanded={open && q.length > 0}
      />

      {open && q.length > 0 ? (
        <ul
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] py-1 shadow-lg"
          role="listbox"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
              No nodes match “{query.trim()}”
            </li>
          ) : (
            results.map((n) => {
              const tone = toneForType(n.node_type);
              return (
                <li key={n.id} role="option">
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--surface-emphasis)]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onSelectNode(n.id);
                      setOpen(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-[var(--foreground)]">
                        {n.label}
                      </div>
                      <div className="truncate font-mono text-[10px] text-[var(--muted-foreground)]">
                        {n.external_ref || n.id.slice(0, 8)}
                      </div>
                    </div>
                    <Badge
                      variant="muted"
                      className={cn(
                        "shrink-0 border-transparent font-mono text-[9px]",
                        tone.softBg,
                        tone.softText,
                      )}
                      style={{ borderLeft: `2px solid ${tone.accent}` }}
                    >
                      {n.node_type}
                    </Badge>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}

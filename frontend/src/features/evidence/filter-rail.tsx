"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import type { EvidenceNodeView } from "@/lib/api/generated/openapi.types";
import { cn } from "@/lib/utils";
import { EvidenceNodeSearch } from "./node-search";
import { toneForType } from "./type-tones";

type FilterRailProps = {
  nodeTypes: string[];
  selectedTypes: Set<string>;
  onToggleType: (type: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  nodeCount: number;
  edgeCount: number;
  searchNodes: EvidenceNodeView[];
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onSearchSelect: (nodeId: string) => void;
  className?: string;
};

export function EvidenceFilterRail({
  nodeTypes,
  selectedTypes,
  onToggleType,
  onSelectAll,
  onClear,
  nodeCount,
  edgeCount,
  searchNodes,
  searchQuery,
  onSearchQueryChange,
  onSearchSelect,
  className,
}: FilterRailProps) {
  return (
    <aside
      className={cn(
        "flex min-h-0 w-full flex-col overflow-visible rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/90 shadow-sm backdrop-blur-md",
        className,
      )}
    >
      <div className="relative z-20 shrink-0 space-y-2.5 border-b border-[var(--border)] px-3 py-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground)]">
            Navigate
          </h2>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--muted-foreground)]">
            {nodeCount} nodes · {edgeCount} edges
          </p>
        </div>
        <EvidenceNodeSearch
          nodes={searchNodes}
          query={searchQuery}
          onQueryChange={onSearchQueryChange}
          onSelectNode={onSearchSelect}
        />
      </div>

      <ScrollArea className="min-h-0 flex-1 overflow-hidden rounded-b-xl">
        <div className="space-y-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
              Filters
            </Label>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={onSelectAll}
              >
                All
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                onClick={onClear}
              >
                None
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
              Node type
            </Label>
            <ul className="space-y-1">
              {nodeTypes.map((type) => {
                const active = selectedTypes.has(type);
                const tone = toneForType(type);
                return (
                  <li key={type}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-2 py-1.5 transition-colors",
                        active
                          ? cn(
                              "border-transparent",
                              tone.softBg,
                              tone.softText,
                            )
                          : "border-transparent bg-transparent text-[var(--muted-foreground)] opacity-55 hover:opacity-80",
                      )}
                    >
                      <span
                        className="flex min-w-0 items-center gap-2 font-mono text-[11px]"
                        style={
                          active
                            ? {
                                borderLeft: `3px solid ${tone.accent}`,
                                paddingLeft: 6,
                              }
                            : undefined
                        }
                      >
                        <span className="truncate">{type}</span>
                      </span>
                      <Switch
                        checked={active}
                        onCheckedChange={() => onToggleType(type)}
                        className="scale-90"
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="text-[10px] leading-relaxed text-[var(--muted-foreground)]">
            Search pans the camera — filters only hide types in the UI.
          </p>
        </div>
      </ScrollArea>
    </aside>
  );
}

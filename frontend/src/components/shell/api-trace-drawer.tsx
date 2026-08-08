"use client";

import { useEffect, useState } from "react";
import { Bug, ChevronDown, ChevronUp } from "lucide-react";
import {
  subscribeApiTrace,
  type ApiTraceEntry,
} from "@/lib/api/client";
import { formatRelativeRefresh } from "@/lib/format/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const MAX_ENTRIES = 40;

/**
 * Development-only drawer listing recent API traces from subscribeApiTrace.
 */
export function ApiTraceDrawer({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ApiTraceEntry[]>([]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const unsubscribe = subscribeApiTrace((entry) => {
      setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
    });
    return () => {
      unsubscribe();
    };
  }, []);

  if (process.env.NODE_ENV !== "development") return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 z-40",
        // Sit to the right of the run sidebar so it never covers ← Run Center
        "left-[max(1rem,calc(var(--sidebar-width,0px)+1rem))]",
        className,
      )}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto bg-[var(--surface-raised)] shadow-sm"
      >
        <Bug className="size-3.5" aria-hidden />
        API trace
        <Badge variant="muted" className="ml-1">
          {entries.length}
        </Badge>
        {open ? (
          <ChevronDown className="size-3.5" aria-hidden />
        ) : (
          <ChevronUp className="size-3.5" aria-hidden />
        )}
      </Button>
      {open ? (
        <div className="pointer-events-auto mt-2 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-sm">
          <div className="border-b border-[var(--border)] px-3 py-2">
            <p className="text-xs font-medium text-[var(--foreground)]">
              Recent API calls (dev only)
            </p>
          </div>
          <ScrollArea className="h-64">
            <ul className="divide-y divide-[var(--border)]">
              {entries.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
                  No requests yet
                </li>
              ) : (
                entries.map((e) => (
                  <li key={e.id} className="px-3 py-2 text-[11px] font-mono">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[var(--foreground)]">
                        {e.method} {e.path}
                      </span>
                      <span
                        className={cn(
                          e.error || (e.status != null && e.status >= 400)
                            ? "text-[var(--destructive)]"
                            : "text-[var(--success)]",
                        )}
                      >
                        {e.status ?? "err"} · {e.ms}ms
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[var(--muted-foreground)]">
                      <span>{formatRelativeRefresh(e.at)}</span>
                      {e.error ? <span className="truncate max-w-[60%]">{e.error}</span> : null}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { Loader2 } from "lucide-react";

import { AnimatedList } from "@/components/react-bits";
import { formatRelativeRefresh } from "@/lib/format/time";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

export function MutationTray({ className }: { className?: string }) {
  const items = useUiStore((s) => s.mutationTray);

  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 right-4 z-50 w-[min(360px,calc(100vw-2rem))]",
        className,
      )}
      aria-live="polite"
    >
      <AnimatedList
        items={items}
        stagger={0.05}
        className="flex flex-col gap-2"
        renderItem={(item) => (
          <div className="pointer-events-auto mb-2 flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 shadow-sm">
            <Loader2
              className="mt-0.5 size-4 shrink-0 animate-spin text-[var(--primary)]"
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {item.label}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">
                Started {formatRelativeRefresh(item.startedAt)} MYT
              </p>
            </div>
          </div>
        )}
      />
    </div>
  );
}

"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProofLensTag } from "@/components/proof-lens/proof-lens-tag";
import { useUiStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

type Props = {
  observed: string[];
  catalogSize: number;
  /** Dense footer strip for split-screen dossier */
  compact?: boolean;
};

export function EvidenceObservation({
  observed,
  catalogSize,
  compact = false,
}: Props) {
  const proofLensEnabled = useUiStore((s) => s.proofLensEnabled);

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
            Evidence signals
          </p>
          <span className="font-mono text-[10px] text-[var(--muted-foreground)]">
            {catalogSize > 0
              ? `${observed.length}/${catalogSize}`
              : `${observed.length} observed`}
          </span>
        </div>
        {observed.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            No behavioural keywords observed yet.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {observed.map((s) => (
              <li key={s}>
                <Badge variant="success" className="font-mono text-[10px]">
                  {s}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg text-[var(--foreground)]">
          Evidence observation
        </h2>
        {proofLensEnabled ? (
          <ProofLensTag
            kind="Measured"
            endpoint="session turns + rubric signals"
          />
        ) : null}
      </div>
      <p className="mb-3 shrink-0 text-xs text-[var(--muted-foreground)]">
        Observed behavioural signals only. Full rubric answers are not revealed
        during the drill.
      </p>
      <ScrollArea
        className={cn(
          "min-h-0 flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4",
        )}
      >
        {observed.length === 0 ? (
          <EmptyState
            className="border-0 bg-transparent py-8"
            title="No signals observed yet"
            description="Signals appear when learner actions match required behavioural keywords."
          />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {observed.map((s) => (
              <li key={s}>
                <Badge variant="success" className="font-mono">
                  {s}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {catalogSize > 0 ? (
          <p className="mt-4 text-xs text-[var(--muted-foreground)]">
            {observed.length} of {catalogSize} signal keywords observed in
            transcript (catalog size from rubric; answers hidden).
          </p>
        ) : (
          <p className="mt-4 text-xs text-[var(--muted-foreground)]">
            Signal catalog unavailable — rubric may be empty or unrecognized.
          </p>
        )}
      </ScrollArea>
    </div>
  );
}

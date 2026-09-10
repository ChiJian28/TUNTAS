"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { apiQueries } from "@/lib/api/queries";
import { REVIEW_GATES, reviewHref } from "@/lib/constants/gates";
import { cn } from "@/lib/utils";

export function GateStrip({ runId }: { runId: string }) {
  const gates = useQuery(apiQueries.gates(runId));
  const chain = gates.data;
  if (!chain?.gates?.length) return null;

  return (
    <nav
      aria-label="Review gates"
      className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-2"
    >
      {REVIEW_GATES.map((item, i) => {
        const g = chain.gates.find((row) => row.gate_key === item.key);
        if (!g) return null;
        const current = chain.current_gate === item.key;
        return (
          <span key={item.key} className="inline-flex items-center gap-1">
            {i > 0 ? (
              <span className="px-1 text-[10px] text-[var(--muted-foreground)]" aria-hidden>
                →
              </span>
            ) : null}
            <Link
              href={reviewHref(runId, item.key)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                current
                  ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--foreground)]"
                  : g.status === "approved"
                    ? "border-transparent bg-[var(--success-soft)] text-[var(--success)]"
                    : g.status === "skipped"
                      ? "border-[var(--border)] text-[var(--muted-foreground)] line-through"
                      : g.status === "rejected"
                        ? "border-transparent bg-[var(--destructive-soft)] text-[var(--destructive)]"
                        : "border-[var(--border)] text-[var(--muted-foreground)]",
              )}
            >
              {g.sequence}. {g.label}
              {g.status === "approved" ? " ✓" : g.status === "skipped" ? " —" : current ? " ●" : ""}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";

import { apiQueries } from "@/lib/api/queries";
import { TuntasApiError } from "@/lib/api/errors";
import { formatKlShort } from "@/lib/format/time";
import { formatRatioPercent } from "@/lib/format/score";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ProofLensTag } from "@/components/proof-lens/proof-lens-tag";
import { CountUp } from "@/components/react-bits";
import { useUiStore } from "@/stores/ui-store";
import type { MetricsSummary } from "@/lib/api/generated/openapi.types";
import { cn } from "@/lib/utils";

/** Format API ratio as percent parts for CountUp, or null when unknown / out of range. */
function ratioAsPercent(value: number | null | undefined): {
  value: number;
  warning?: string;
} | null {
  if (value == null || Number.isNaN(value)) return null;
  const formatted = formatRatioPercent(value);
  if (formatted.warning) return null;
  return { value: value * 100 };
}

function formatLatencyFootnote(ms: number | null | undefined): string | null {
  if (ms == null || Number.isNaN(ms)) return null;
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s Avg latency`;
  }
  return `${Math.round(ms)} ms Avg latency`;
}

type ThemeCardProps = {
  title: string;
  hero: ReactNode;
  heroClassName?: string;
  footnote: ReactNode;
};

function ThemeCard({ title, hero, heroClassName, footnote }: ThemeCardProps) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex flex-col justify-between gap-4 px-5 py-5 sm:min-h-[148px]">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          {title}
        </p>
        <div
          className={cn(
            "font-mono text-4xl font-medium tabular-nums tracking-tight sm:text-5xl",
            heroClassName ?? "text-[var(--foreground)]",
          )}
        >
          {hero}
        </div>
        <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
          {footnote}
        </p>
      </CardContent>
    </Card>
  );
}

function MetricsThemeCards({ m }: { m: MetricsSummary }) {
  const citation = ratioAsPercent(m.citation_coverage_avg);
  const artifact = ratioAsPercent(m.artifact_completeness_avg);
  const budget = ratioAsPercent(m.avg_budget_utilization);
  const latencyNote = formatLatencyFootnote(m.avg_handoff_latency_ms);

  const governanceAlert =
    m.hard_constraint_violations > 0 || m.approval_bypass_attempts > 0;

  const governanceFootnote = (
    <>
      <span
        className={cn(
          m.hard_constraint_violations > 0 && "text-[var(--destructive)]",
        )}
      >
        <span className="font-mono tabular-nums">
          {m.hard_constraint_violations}
        </span>{" "}
        Violations
      </span>
      {" · "}
      <span
        className={cn(
          m.approval_bypass_attempts > 0 && "text-[var(--destructive)]",
        )}
      >
        <span className="font-mono tabular-nums">
          {m.approval_bypass_attempts}
        </span>{" "}
        Bypass attempts
      </span>
      {governanceAlert ? (
        <span className="mt-1 block text-[var(--destructive)]">
          Attention required
        </span>
      ) : null}
    </>
  );

  const efficiencyParts = [
    budget != null ? (
      <span key="budget">
        <span className="font-mono tabular-nums">{Math.round(budget.value)}%</span>{" "}
        Budget utilized
      </span>
    ) : (
      <span key="budget">Budget utilized Unknown</span>
    ),
    latencyNote ? (
      <span key="lat" className="font-mono tabular-nums">
        {latencyNote}
      </span>
    ) : (
      <span key="lat">Avg latency Unknown</span>
    ),
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ThemeCard
        title="Pipeline Status"
        heroClassName={
          m.runs_awaiting_approval > 0
            ? "text-[var(--primary)]"
            : "text-[var(--foreground)]"
        }
        hero={
          <span className="inline-flex flex-col gap-1">
            <CountUp
              value={m.runs_awaiting_approval}
              className="font-mono tabular-nums"
            />
            <span className="font-sans text-sm font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
              Awaiting approval
            </span>
          </span>
        }
        footnote={
          <>
            <span className="font-mono tabular-nums">{m.runs_total}</span> Total
            Runs
            {" · "}
            <span className="font-mono tabular-nums">{m.runs_completed}</span>{" "}
            Completed
          </>
        }
      />

      <ThemeCard
        title="Governance & Risk"
        hero={
          citation ? (
            <span className="inline-flex flex-col gap-1">
              <CountUp
                value={citation.value}
                decimals={0}
                suffix="%"
                className="font-mono tabular-nums"
              />
              <span className="font-sans text-sm font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
                Citation coverage
              </span>
            </span>
          ) : (
            <span className="inline-flex flex-col gap-1">
              <span>Unknown</span>
              <span className="font-sans text-sm font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
                Citation coverage
              </span>
            </span>
          )
        }
        footnote={governanceFootnote}
      />

      <ThemeCard
        title="Operational Efficiency"
        hero={
          artifact ? (
            <span className="inline-flex flex-col gap-1">
              <CountUp
                value={artifact.value}
                decimals={0}
                suffix="%"
                className="font-mono tabular-nums"
              />
              <span className="font-sans text-sm font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
                Artifact completeness
              </span>
            </span>
          ) : (
            <span className="inline-flex flex-col gap-1">
              <span>Unknown</span>
              <span className="font-sans text-sm font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
                Artifact completeness
              </span>
            </span>
          )
        }
        footnote={
          <>
            {efficiencyParts[0]}
            {" · "}
            {efficiencyParts[1]}
          </>
        }
      />
    </div>
  );
}

export default function RunsPage() {
  const proofLens = useUiStore((s) => s.proofLensEnabled);

  const me = useQuery({ ...apiQueries.me });
  const metrics = useQuery({ ...apiQueries.metrics });
  const runs = useQuery({ ...apiQueries.runs(30) });

  const metricsError = metrics.error as TuntasApiError | null;
  const runsError = runs.error as TuntasApiError | null;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <section className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="font-display text-4xl leading-tight text-[var(--foreground)] sm:text-5xl">
            From training spend to provable readiness
          </p>
          <p className="mt-3 text-base text-[var(--body)]">
            Board, audit, and BNM-facing evidence — AI recommends, solvers prove
            feasibility, humans decide.
          </p>
          {me.data ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {[me.data.subject, me.data.role, me.data.auth_mode].map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--muted-foreground)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : me.isLoading ? (
            <Skeleton className="mt-3 h-6 w-56 rounded-full" />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href="/runs/new">
              <Plus className="size-4" aria-hidden />
              Create run
            </Link>
          </Button>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-[var(--foreground)]">
            Executive metrics
          </h2>
          {proofLens ? (
            <ProofLensTag
              kind="Measured"
              endpoint="GET /v1/metrics/summary"
              timestamp={
                metrics.dataUpdatedAt
                  ? new Date(metrics.dataUpdatedAt).toISOString()
                  : undefined
              }
            />
          ) : null}
        </div>
        {metrics.isLoading ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[148px] rounded-2xl" />
            ))}
          </div>
        ) : metrics.isError ? (
          <ErrorState
            message={metricsError?.message ?? "Failed to load metrics"}
            status={metricsError?.status}
            endpoint={metricsError?.endpoint ?? "GET /v1/metrics/summary"}
            onRetry={() => void metrics.refetch()}
          />
        ) : metrics.data ? (
          <MetricsThemeCards m={metrics.data} />
        ) : null}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-[var(--foreground)]">
            Recent runs
          </h2>
          {proofLens ? (
            <ProofLensTag
              kind="Measured"
              endpoint="GET /v1/runs"
              timestamp={
                runs.dataUpdatedAt
                  ? new Date(runs.dataUpdatedAt).toISOString()
                  : undefined
              }
            />
          ) : null}
        </div>
        {runs.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : runs.isError ? (
          <ErrorState
            message={runsError?.message ?? "Failed to load runs"}
            status={runsError?.status}
            endpoint={runsError?.endpoint ?? "GET /v1/runs"}
            onRetry={() => void runs.refetch()}
          />
        ) : !runs.data?.length ? (
          <EmptyState
            title="No runs yet"
            description="Create a run from a JSON trigger or the synthetic demo fixture."
            action={
              <Button asChild>
                <Link href="/runs/new">Create run</Link>
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Request</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Employees</th>
                  <th className="px-4 py-3 font-medium">Current node</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {runs.data.map((run) => (
                  <tr key={run.id} className="hover:bg-[var(--surface)]/80">
                    <td className="px-4 py-3">
                      <Link
                        href={`/runs/${run.id}/overview`}
                        className="font-medium text-[var(--foreground)] underline-offset-2 transition-colors hover:text-[var(--primary)] hover:underline"
                      >
                        {run.request_id}
                      </Link>
                      <p className="mt-0.5 font-mono text-[10px] text-[var(--muted-foreground)]">
                        {run.id}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={run.status} />
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {run.employee_count}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {run.current_node ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                      {formatKlShort(run.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

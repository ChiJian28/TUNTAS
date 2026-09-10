"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WhatIfPanel } from "@/features/portfolios/what-if-panel";
import { apiQueries } from "@/lib/api/queries";
import { OPTION_LABELS } from "@/lib/constants/agents";
import { formatMyr } from "@/lib/format/money";
import { formatRatioPercent } from "@/lib/format/score";

function text(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number") return String(v);
  return JSON.stringify(v);
}

export function OperationsDossier({ runId }: { runId: string }) {
  const options = useQuery(apiQueries.options(runId));
  const cockpit = useQuery(apiQueries.cockpit(runId));
  const gates = useQuery(apiQueries.gates(runId));
  const circular = gates.data?.path === "circular";
  const brief = useQuery({
    ...apiQueries.impactBrief(runId),
    enabled: circular,
  });
  const coverageTarget = cockpit.data?.request?.min_operational_coverage_ratio;
  const affected = brief.data?.affected_employees ?? [];

  return (
    <div className="space-y-6">
      {circular ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">
              Retraining cohort — 7 staff
            </CardTitle>
            <CardDescription>
              Operations signs coverage for these people only. Membership is the
              impact brief, not an LLM roster.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {brief.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <ul className="space-y-2 text-sm">
                {affected.map((e) => (
                  <li
                    key={text(e.employee_ref)}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                  >
                    <span>
                      <span className="font-medium">
                        {text(e.pseudonym) !== "—"
                          ? text(e.pseudonym)
                          : text(e.employee_ref)}
                      </span>
                      <span className="ml-2 font-mono text-[11px] text-[var(--muted-foreground)]">
                        {text(e.employee_ref)}
                      </span>
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {text(e.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">
            Coverage & constraint band
          </CardTitle>
          <CardDescription>
            OR-Tools scores, not an LLM week-by-week plan. Reject only if Hard
            OK is no or the solver is INFEASIBLE. The coverage column is
            remaining staff in the smallest unit — 50% in a two-person team can
            still satisfy the 70% scheduling floor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {coverageTarget != null ? (
            <p className="text-sm">
              Minimum operational coverage:{" "}
              <span className="font-mono">
                {formatRatioPercent(coverageTarget).text}
              </span>
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  <th className="pb-2 pr-3">Option</th>
                  <th className="pb-2 pr-3">Coverage</th>
                  <th className="pb-2 pr-3">Cost / head</th>
                  <th className="pb-2 pr-3">Solver</th>
                  <th className="pb-2">Hard OK</th>
                </tr>
              </thead>
              <tbody>
                {(options.data ?? []).map((o) => (
                  <tr
                    key={o.id}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="py-2 pr-3 font-medium">
                      {OPTION_LABELS[o.option_key] ?? o.label}
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {formatRatioPercent(o.operational_coverage).text}
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {formatMyr(o.cost_per_employee_myr)}
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {o.solver_status ?? "—"}
                    </td>
                    <td className="py-2">
                      <Badge
                        variant={o.hard_constraint_ok ? "success" : "destructive"}
                      >
                        {o.hard_constraint_ok ? "yes" : "no"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <WhatIfPanel runId={runId} />
    </div>
  );
}

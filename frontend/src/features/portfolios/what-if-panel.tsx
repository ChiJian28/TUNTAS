"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CountUp } from "@/components/react-bits";
import { CopyIdButton } from "@/features/audit/copy-id";
import {
  invalidateAfterWhatIf,
  whatIf,
} from "@/lib/api/mutations";
import { normalizeApiError } from "@/lib/api/errors";
import type { WhatIfResponse } from "@/lib/api/generated/openapi.types";
import { apiQueries } from "@/lib/api/queries";
import { formatKl } from "@/lib/format/time";
import { formatMyr } from "@/lib/format/money";
import { formatRatioPercent } from "@/lib/format/score";
import { OPTION_LABELS } from "@/lib/constants/agents";
import { useUiStore } from "@/stores/ui-store";

function numOrEmpty(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "";
  return String(v);
}

function parseOptionalNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function WhatIfPanel({ runId }: { runId: string }) {
  const qc = useQueryClient();
  const cockpitQuery = useQuery(apiQueries.cockpit(runId));
  const request = cockpitQuery.data?.request;
  const whatIfDraft = useUiStore((s) => s.whatIfDraft);
  const setWhatIfDraft = useUiStore((s) => s.setWhatIfDraft);
  const pushMutation = useUiStore((s) => s.pushMutation);
  const popMutation = useUiStore((s) => s.popMutation);

  /** null = use committed/draft baseline; string = user-edited local draft */
  const [maxCost, setMaxCost] = useState<string | null>(null);
  const [totalBudget, setTotalBudget] = useState<string | null>(null);
  const [minCoverage, setMinCoverage] = useState<string | null>(null);
  const [apply, setApply] = useState(true);
  const [lastResponse, setLastResponse] = useState<{
    at: string;
    data: WhatIfResponse;
  } | null>(null);

  const baselineMax = numOrEmpty(
    whatIfDraft.maxCostPerEmployeeMyr ??
      request?.max_budget_per_employee_myr ??
      null,
  );
  const baselineTotal = numOrEmpty(
    whatIfDraft.totalBudgetMyr ?? request?.total_budget_myr ?? null,
  );
  const baselineCoverage = numOrEmpty(
    whatIfDraft.minOperationalCoverageRatio ??
      request?.min_operational_coverage_ratio ??
      null,
  );

  const maxCostValue = maxCost ?? baselineMax;
  const totalBudgetValue = totalBudget ?? baselineTotal;
  const minCoverageValue = minCoverage ?? baselineCoverage;

  const mutation = useMutation({
    mutationFn: () =>
      whatIf(runId, {
        max_cost_per_employee_myr: parseOptionalNumber(maxCostValue),
        total_budget_myr: parseOptionalNumber(totalBudgetValue),
        min_operational_coverage_ratio: parseOptionalNumber(minCoverageValue),
        apply,
        allow_coverage_relax:
          (parseOptionalNumber(minCoverageValue) ?? 0.7) < 0.9,
      }),
    onMutate: () => {
      const id = pushMutation("Solving CP-SAT…");
      return { id };
    },
    onSuccess: (data) => {
      setLastResponse({ at: new Date().toISOString(), data });
      setWhatIfDraft({
        maxCostPerEmployeeMyr:
          parseOptionalNumber(maxCostValue) ?? undefined,
        totalBudgetMyr: parseOptionalNumber(totalBudgetValue) ?? undefined,
        minOperationalCoverageRatio:
          parseOptionalNumber(minCoverageValue) ?? undefined,
      });
      setMaxCost(null);
      setTotalBudget(null);
      setMinCoverage(null);
      invalidateAfterWhatIf(qc, runId);
      if (String(data.solver_status ?? "").toLowerCase().includes("infeasible")) {
        toast.error(data.infeasible_reason || "OR-Tools returned INFEASIBLE");
      } else if (data.applied && data.checkpoint_synced) {
        toast.success("Applied and ready for approval");
      } else if (!data.applied) {
        toast.message("Preview only — not applied to checkpoint");
      } else {
        toast.message("What-if completed");
      }
    },
    onError: (error) => {
      const err = normalizeApiError(error);
      toast.error(err.message);
    },
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx?.id) popMutation(ctx.id);
    },
  });

  function resetToCommitted() {
    setMaxCost(null);
    setTotalBudget(null);
    setMinCoverage(null);
    setWhatIfDraft({});
    setApply(true);
  }

  const err =
    mutation.isError && mutation.error
      ? normalizeApiError(mutation.error)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Constraint stress test</CardTitle>
        <CardDescription>
          Draft values locally; press Recalculate to POST /what-if. No client-side
          solver math. Infeasible is a valid result.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="max-cost">Max cost per employee (MYR)</Label>
            <Input
              id="max-cost"
              type="number"
              inputMode="decimal"
              value={maxCostValue}
              onChange={(e) => setMaxCost(e.target.value)}
              disabled={mutation.isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="total-budget">Total budget (MYR)</Label>
            <Input
              id="total-budget"
              type="number"
              inputMode="decimal"
              value={totalBudgetValue}
              onChange={(e) => setTotalBudget(e.target.value)}
              disabled={mutation.isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="min-coverage">
              Min operational coverage (0–1 ratio)
            </Label>
            <Input
              id="min-coverage"
              type="number"
              step="0.01"
              min="0"
              max="1"
              inputMode="decimal"
              value={minCoverageValue}
              onChange={(e) => setMinCoverage(e.target.value)}
              disabled={mutation.isPending}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
            <div>
              <Label htmlFor="apply-toggle">Apply to checkpoint</Label>
              <p className="text-xs text-[var(--muted-foreground)]">
                Default on. Off = preview only.
              </p>
            </div>
            <Switch
              id="apply-toggle"
              checked={apply}
              onCheckedChange={setApply}
              disabled={mutation.isPending}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || cockpitQuery.isLoading}
          >
            {mutation.isPending ? "Solving CP-SAT…" : "Recalculate"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={resetToCommitted}
            disabled={mutation.isPending || !request}
          >
            Reset to committed values
          </Button>
        </div>

        {request ? (
          <div className="min-w-0 space-y-1.5 text-xs text-[var(--muted-foreground)]">
            <p>
              Committed: max {formatMyr(request.max_budget_per_employee_myr)} ·
              total {formatMyr(request.total_budget_myr)} · coverage{" "}
              {
                formatRatioPercent(request.min_operational_coverage_ratio)
                  .text
              }
            </p>
            <p className="min-w-0 text-xs text-[var(--muted-foreground)]">
              <span className="mr-1">portfolio_version</span>
              <span className="break-all font-mono text-[var(--foreground)]">
                {request.portfolio_version ??
                  cockpitQuery.data?.portfolio_version ??
                  "Unknown"}
              </span>{" "}
              <CopyIdButton
                value={
                  request.portfolio_version ??
                  cockpitQuery.data?.portfolio_version ??
                  "Unknown"
                }
                label="portfolio_version"
                className="inline-flex h-6 align-middle"
                showValue={false}
              />
            </p>
          </div>
        ) : null}

        {err ? (
          <ErrorState
            message={err.message}
            status={err.status}
            endpoint={`/v1/runs/${runId}/what-if`}
          />
        ) : null}

        {lastResponse ? (
          <div className="min-w-0 space-y-2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={lastResponse.data.applied ? "success" : "muted"}>
                applied: {String(lastResponse.data.applied)}
              </Badge>
              <Badge
                variant={
                  lastResponse.data.checkpoint_synced ? "success" : "warning"
                }
              >
                checkpoint_synced:{" "}
                {String(lastResponse.data.checkpoint_synced)}
              </Badge>
            </div>
            {lastResponse.data.portfolio_version ? (
              <p className="min-w-0 text-xs text-[var(--muted-foreground)]">
                <span className="mr-1">portfolio_version</span>
                <span className="break-all font-mono text-[var(--foreground)]">
                  {lastResponse.data.portfolio_version}
                </span>{" "}
                <CopyIdButton
                  value={lastResponse.data.portfolio_version}
                  label="portfolio_version"
                  className="inline-flex h-6 align-middle"
                  showValue={false}
                />
              </p>
            ) : null}
            <p className="text-xs text-[var(--muted-foreground)]">
              Response at {formatKl(lastResponse.at)}
            </p>
            {lastResponse.data.applied &&
            lastResponse.data.checkpoint_synced ? (
              <p className="text-sm text-[var(--success)]">
                Applied and ready for approval
              </p>
            ) : null}
            <ul className="space-y-1 text-xs">
              {lastResponse.data.solver_status ? (
                <li>
                  <Badge
                    variant={
                      String(lastResponse.data.solver_status)
                        .toLowerCase()
                        .includes("infeasible")
                        ? "destructive"
                        : "success"
                    }
                    className="text-[10px]"
                  >
                    {lastResponse.data.solver_status}
                  </Badge>
                  {lastResponse.data.infeasible_reason ? (
                    <p className="mt-1 text-[11px] leading-snug text-[var(--muted-foreground)]">
                      {lastResponse.data.infeasible_reason}
                    </p>
                  ) : null}
                </li>
              ) : null}
              {lastResponse.data.options.map((o) => (
                <li
                  key={o.option_key}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="font-medium">
                    {OPTION_LABELS[o.option_key] ?? o.option_key}
                  </span>
                  <CountUp value={o.total_cost_myr} prefix="RM " />
                  <Badge
                    variant={
                      String(o.solver_status ?? "")
                        .toLowerCase()
                        .includes("infeasible")
                        ? "destructive"
                        : o.hard_constraint_ok
                          ? "success"
                          : "warning"
                    }
                  >
                    {o.solver_status ??
                      (o.hard_constraint_ok ? "OK" : "constraint failed")}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { motion } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, type ReactNode } from "react";

import { CountUp } from "@/components/react-bits/count-up";
import { ProofLensTag } from "@/components/proof-lens/proof-lens-tag";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { OPTION_LABELS, AGENT_PIPELINE } from "@/lib/constants/agents";
import { normalizeApiError } from "@/lib/api/errors";
import type {
  AgentHandoffView,
  OptionKey,
  PortfolioOptionDetail,
} from "@/lib/api/generated/openapi.types";
import { apiQueries } from "@/lib/api/queries";
import { formatMyr } from "@/lib/format/money";
import { formatRatioPercent } from "@/lib/format/score";
import {
  parseHandoffEnvelope,
  safeParsePayload,
  secretariatPayloadSchema,
} from "@/lib/schemas/payloads";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

const OPTION_ORDER: OptionKey[] = ["cost", "balanced", "coverage"];

const VALUE_CLS =
  "font-mono text-xs font-medium tabular-nums text-[var(--foreground)] font-[family-name:var(--font-mono)]";

function optionLabel(key: string) {
  return OPTION_LABELS[key] ?? key;
}

function metricStatus(
  metrics: Record<string, unknown>,
  keys: string[],
): string {
  for (const k of keys) {
    const v = metrics[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "boolean") return v ? "OK" : "Failed";
  }
  return "Unknown";
}

function findRecommended(handoffs: AgentHandoffView[]): string | null {
  const entry = AGENT_PIPELINE.find((a) => a.id === "secretariat");
  const names =
    entry && "agentNames" in entry ? entry.agentNames : ([] as readonly string[]);
  const h = handoffs.find((item) =>
    names.some((n) => item.agent_name.toLowerCase().includes(n.toLowerCase())),
  );
  if (!h) return null;
  const env = parseHandoffEnvelope(h.output_json);
  if (!env.ok) return null;
  const payload = safeParsePayload(secretariatPayloadSchema, env.data.payload);
  if (!payload.ok) return null;
  return payload.data.recommended_option_key ?? null;
}

function MetricRow({
  label,
  children,
  valueClassName,
}: {
  label: string;
  children: ReactNode;
  valueClassName?: string;
}) {
  return (
    <>
      <dt className="pr-3 text-[var(--muted-foreground)]">{label}</dt>
      <dd className={cn(VALUE_CLS, "text-right", valueClassName)}>{children}</dd>
    </>
  );
}

export function OptionCards({ runId }: { runId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const optionFromUrl = searchParams.get("option");
  const selectedOptionKey = useUiStore((s) => s.selectedOptionKey);
  const setSelectedOptionKey = useUiStore((s) => s.setSelectedOptionKey);
  const proofLensEnabled = useUiStore((s) => s.proofLensEnabled);

  const optionsQuery = useQuery(apiQueries.options(runId));
  const handoffsQuery = useQuery(apiQueries.handoffs(runId, true));

  const recommended = useMemo(
    () => findRecommended(handoffsQuery.data ?? []),
    [handoffsQuery.data],
  );

  const ordered = useMemo(() => {
    const list = optionsQuery.data ?? [];
    const byKey = new Map(list.map((o) => [o.option_key, o]));
    const result: PortfolioOptionDetail[] = [];
    for (const key of OPTION_ORDER) {
      const hit = byKey.get(key);
      if (hit) result.push(hit);
    }
    for (const o of list) {
      if (!OPTION_ORDER.includes(o.option_key)) result.push(o);
    }
    return result;
  }, [optionsQuery.data]);

  const balanced = ordered.find((o) => o.option_key === "balanced");

  useEffect(() => {
    if (optionFromUrl && optionFromUrl !== selectedOptionKey) {
      setSelectedOptionKey(optionFromUrl);
    }
  }, [optionFromUrl, selectedOptionKey, setSelectedOptionKey]);

  function selectOption(key: string, hardOk: boolean) {
    if (!hardOk) return;
    setSelectedOptionKey(key);
    const params = new URLSearchParams(searchParams.toString());
    params.set("option", key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (optionsQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </CardContent>
      </Card>
    );
  }

  if (optionsQuery.isError) {
    const err = normalizeApiError(optionsQuery.error);
    return (
      <ErrorState
        message={err.message}
        status={err.status}
        endpoint={`/v1/runs/${runId}/options`}
        onRetry={() => void optionsQuery.refetch()}
      />
    );
  }

  if (ordered.length === 0) {
    return (
      <EmptyState
        title="No portfolio options yet"
        description="Awaiting Optimizer / Secretariat handoff and portfolio persistence."
      />
    );
  }

  const activeKey = optionFromUrl ?? selectedOptionKey;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Portfolio options</CardTitle>
        <CardDescription>
          cost → Budget Saver · balanced → Balanced · coverage → Max Risk
          Reduction. Hard-constraint failures cannot be selected for approve.
          {recommended
            ? ` Secretariat recommends ${optionLabel(recommended)}.`
            : " Recommended label only appears from Secretariat handoff."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-3 lg:grid-cols-3">
        {ordered.map((opt) => {
          const selected = activeKey === opt.option_key;
          const coverage = formatRatioPercent(opt.coverage_score);
          const opCov = formatRatioPercent(opt.operational_coverage);
          const deltaCost =
            balanced && opt.option_key !== "balanced"
              ? opt.total_cost_myr - balanced.total_cost_myr
              : null;
          const canSelect = opt.hard_constraint_ok;
          const prereq = metricStatus(opt.metrics ?? {}, [
            "prerequisites_status",
            "prerequisites",
            "prerequisite_status",
          ]);
          const capacity = metricStatus(opt.metrics ?? {}, [
            "capacity_status",
            "capacity",
          ]);

          return (
            <motion.div
              key={opt.id || opt.option_key}
              layout
              aria-pressed={selected}
              data-selected={selected ? "true" : "false"}
              className={cn(
                "relative flex min-w-0 flex-col rounded-2xl border p-4 transition-colors",
                selected
                  ? "border-[var(--primary)] bg-[var(--primary-soft)] ring-2 ring-[var(--primary)]/35 shadow-[inset_3px_0_0_0_var(--primary)]"
                  : "border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--border-strong)]",
                !canSelect && "opacity-70",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-display text-lg">
                    {optionLabel(opt.option_key)}
                  </h3>
                  <p className="font-mono text-[11px] text-[var(--muted-foreground)]">
                    {opt.option_key}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {selected ? (
                    <Badge variant="soft-primary" className="gap-1 font-semibold">
                      <Check className="size-3" aria-hidden />
                      Selected
                    </Badge>
                  ) : null}
                  {recommended === opt.option_key ? (
                    <Badge variant="soft-primary">Recommended</Badge>
                  ) : null}
                </div>
              </div>

              {opt.hard_constraint_ok ? (
                <p className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--success)]">
                  <Check className="size-3.5 shrink-0" aria-hidden />
                  Hard constraints OK
                </p>
              ) : (
                <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--destructive)]">
                  <X className="size-3.5 shrink-0" aria-hidden />
                  Hard constraints failed
                </p>
              )}

              <dl className="mt-4 grid grid-cols-[1fr_auto] items-baseline gap-y-1.5 text-xs">
                <MetricRow label="Total cost">
                  <CountUp
                    value={opt.total_cost_myr}
                    prefix="RM "
                    className={VALUE_CLS}
                  />
                </MetricRow>
                <MetricRow label="Cost / employee">
                  <CountUp
                    value={opt.cost_per_employee_myr}
                    prefix="RM "
                    className={VALUE_CLS}
                  />
                </MetricRow>
                <MetricRow
                  label="Competency coverage"
                  valueClassName={
                    coverage.warning ? undefined : "text-[var(--success)]"
                  }
                >
                  {coverage.warning ? (
                    <>
                      {coverage.text}
                      <span className="ml-1 text-[var(--warning)]">!</span>
                    </>
                  ) : opt.coverage_score >= 0 && opt.coverage_score <= 1 ? (
                    <CountUp
                      value={opt.coverage_score * 100}
                      decimals={0}
                      suffix="%"
                      className={cn(VALUE_CLS, "text-[var(--success)]")}
                    />
                  ) : (
                    coverage.text
                  )}
                </MetricRow>
                <MetricRow label="Risk reduction">
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <CountUp
                      value={opt.risk_reduction_score}
                      decimals={2}
                      className={VALUE_CLS}
                    />
                    <Badge
                      variant="warning"
                      className="px-1.5 py-0 text-[10px] font-sans"
                    >
                      Modelled
                    </Badge>
                  </span>
                </MetricRow>
                <MetricRow label="Operational coverage">
                  {opCov.warning ? (
                    opCov.text
                  ) : opt.operational_coverage >= 0 &&
                    opt.operational_coverage <= 1 ? (
                    <CountUp
                      value={opt.operational_coverage * 100}
                      decimals={0}
                      suffix="%"
                      className={VALUE_CLS}
                    />
                  ) : (
                    opCov.text
                  )}
                </MetricRow>
                <MetricRow label="Assignments">
                  <CountUp
                    value={opt.assignments?.length ?? 0}
                    className={VALUE_CLS}
                  />
                </MetricRow>
                <MetricRow label="Solver status">
                  {opt.solver_status ?? "Unknown"}
                </MetricRow>
                <MetricRow label="Prerequisites">{prereq}</MetricRow>
                <MetricRow label="Capacity">{capacity}</MetricRow>
                {deltaCost != null ? (
                  <MetricRow label="Δ vs Balanced">
                    {deltaCost >= 0 ? "+" : ""}
                    {formatMyr(deltaCost)}
                  </MetricRow>
                ) : null}
              </dl>

              {(opt.challenger_flags ?? []).length > 0 ? (
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-medium text-[var(--muted-foreground)]">
                    Challenger flags
                  </p>
                  {(opt.challenger_flags ?? []).slice(0, 3).map((f, i) => {
                    const sev = String(
                      (f as { severity?: string }).severity ?? "",
                    ).toLowerCase();
                    return (
                      <Badge
                        key={i}
                        variant={sev === "critical" ? "destructive" : "warning"}
                        className="mr-1"
                      >
                        {sev === "critical" ? "Critical" : sev || "Flag"} ·{" "}
                        {String(
                          (f as { message?: string; reason?: string }).message ??
                            (f as { reason?: string }).reason ??
                            (f as { course_code?: string }).course_code ??
                            "flag",
                        ).slice(0, 40)}
                      </Badge>
                    );
                  })}
                </div>
              ) : null}

              {proofLensEnabled ? (
                <div className="mt-3">
                  <ProofLensTag
                    kind="Modelled"
                    endpoint={`/v1/runs/${runId}/options`}
                    id={opt.id}
                  />
                </div>
              ) : null}

              <div className="mt-4 grow" />
              <Button
                type="button"
                size="sm"
                variant={selected ? "default" : "secondary"}
                disabled={!canSelect}
                onClick={() => selectOption(opt.option_key, canSelect)}
                title={
                  canSelect
                    ? "Select for approval"
                    : "Cannot select — hard_constraint_ok is false"
                }
              >
                {selected
                  ? "Selected"
                  : canSelect
                    ? "Select for approve"
                    : "Cannot select"}
              </Button>
            </motion.div>
          );
        })}
      </CardContent>
    </Card>
  );
}

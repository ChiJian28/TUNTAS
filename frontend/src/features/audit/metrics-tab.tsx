"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProofLensTag } from "@/components/proof-lens/proof-lens-tag";
import { CountUp } from "@/components/react-bits";
import type { MetricsSummary } from "@/lib/api/generated/openapi.types";
import { formatRatioPercent } from "@/lib/format/score";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

type Props = {
  metrics: MetricsSummary | undefined;
  fetchedAt?: string;
};

type MetricRow = {
  label: string;
  value: number | null;
  decimals?: number;
  suffix?: string;
  /** Raw text when value cannot be CountUp'd safely */
  textFallback?: string;
};

/** Only MetricsSummary fields — no token usage / e2e runtime / schema pass / rubric delta. */
export function MetricsTab({ metrics, fetchedAt }: Props) {
  const proofLensEnabled = useUiStore((s) => s.proofLensEnabled);

  const rows = useMemo((): MetricRow[] => {
    if (!metrics) return [];
    return [
      { label: "Runs total", value: metrics.runs_total },
      { label: "Awaiting approval", value: metrics.runs_awaiting_approval },
      { label: "Completed", value: metrics.runs_completed },
      {
        label: "Hard-constraint violations",
        value: metrics.hard_constraint_violations,
      },
      ratioRow("Avg budget utilization", metrics.avg_budget_utilization),
      ratioRow("Citation coverage avg", metrics.citation_coverage_avg),
      {
        label: "Approval bypass attempts",
        value: metrics.approval_bypass_attempts,
      },
      {
        label: "Avg handoff latency (ms)",
        value:
          metrics.avg_handoff_latency_ms != null
            ? Math.round(metrics.avg_handoff_latency_ms)
            : null,
        textFallback:
          metrics.avg_handoff_latency_ms == null ? "Unknown" : undefined,
      },
      ratioRow("Artifact completeness avg", metrics.artifact_completeness_avg),
    ];
  }, [metrics]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg text-[var(--foreground)]">
          Global metrics
        </h3>
        {proofLensEnabled ? (
          <ProofLensTag
            kind="Measured"
            endpoint="GET /v1/metrics/summary"
            timestamp={fetchedAt}
          />
        ) : null}
      </div>

      {!metrics ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          Metrics unavailable.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row, index) => (
            <Card
              key={row.label}
              className={cn(
                "shadow-none",
                index < 3 &&
                  "border-[var(--border-strong)] bg-[var(--surface)]",
              )}
            >
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-[var(--muted-foreground)]">
                  {row.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-2xl font-medium tabular-nums text-[var(--foreground)] font-[family-name:var(--font-mono)]">
                  {row.textFallback != null ? (
                    row.textFallback
                  ) : row.value == null ? (
                    "Unknown"
                  ) : (
                    <CountUp
                      value={row.value}
                      decimals={row.decimals ?? 0}
                      suffix={row.suffix}
                      className="font-mono tabular-nums"
                    />
                  )}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AssumptionCalculator />
    </div>
  );
}

function ratioRow(label: string, value: number | null | undefined): MetricRow {
  if (value == null) {
    return { label, value: null, textFallback: "Unknown" };
  }
  const formatted = formatRatioPercent(value);
  if (formatted.warning) {
    return { label, value: null, textFallback: formatted.text };
  }
  return {
    label,
    value: value * 100,
    decimals: 0,
    suffix: "%",
  };
}

function AssumptionCalculator() {
  const [hours, setHours] = useState("40");
  const [rate, setRate] = useState("120");

  const saved = useMemo(() => {
    const h = Number(hours);
    const r = Number(rate);
    if (!Number.isFinite(h) || !Number.isFinite(r)) return null;
    return h * r;
  }, [hours, rate]);

  return (
    <Card className="border-[var(--warning)]/30 bg-[var(--warning-soft)]/40 shadow-none">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Manual hours saved</CardTitle>
          <Badge variant="warning">Assumption</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-[var(--body)]">
          Optional calculator for demo narrative only. Not an achieved result
          from MetricsSummary or assurance.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="hours-saved" className="text-[11px]">
              Assumed hours saved
            </Label>
            <Input
              id="hours-saved"
              className="h-8 text-xs"
              type="number"
              min={0}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hourly-rate" className="text-[11px]">
              Assumed hourly rate (MYR)
            </Label>
            <Input
              id="hourly-rate"
              className="h-8 text-xs"
              type="number"
              min={0}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
        </div>
        <p className="font-mono text-xl font-medium tabular-nums text-[var(--foreground)]">
          {saved == null ? (
            "—"
          ) : (
            <CountUp value={saved} prefix="RM " className="font-mono tabular-nums" />
          )}{" "}
          <span className="font-sans text-sm font-normal text-[var(--muted-foreground)]">
            assumed — not measured
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

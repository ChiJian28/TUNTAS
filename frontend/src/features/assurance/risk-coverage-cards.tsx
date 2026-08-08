"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProofLensTag } from "@/components/proof-lens/proof-lens-tag";
import {
  parseControlCoverage,
  parseResidualRisk,
} from "@/features/assurance/parse-assurance";
import { JsonViewer } from "@/features/agents/json-viewer";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import type { ReactNode } from "react";

function LedgerRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-[11px] text-[var(--muted-foreground)]">{label}</dt>
      <dd className="text-right font-mono text-xs font-medium tabular-nums text-[var(--foreground)] font-[family-name:var(--font-mono)]">
        {children}
      </dd>
    </>
  );
}

type ResidualProps = {
  residualRisk: Record<string, unknown>;
  snapshotId?: string;
  fetchedAt?: string;
};

export function ResidualRiskCard({
  residualRisk,
  snapshotId,
  fetchedAt,
}: ResidualProps) {
  const proofLensEnabled = useUiStore((s) => s.proofLensEnabled);
  const parsed = parseResidualRisk(residualRisk);
  const highRisk =
    parsed.ok &&
    parsed.score != null &&
    !Number.isNaN(parsed.score) &&
    ((parsed.score >= 0 && parsed.score <= 1 && parsed.score >= 0.6) ||
      (parsed.score > 1 && parsed.score >= 60));

  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1 p-4 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight">
            Residual capability risk
          </CardTitle>
          {proofLensEnabled ? (
            <ProofLensTag
              kind="Measured"
              endpoint="GET /v1/runs/{run_id}/assurance"
              timestamp={fetchedAt}
              id={snapshotId}
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        {!parsed.ok ? (
          <div className="space-y-2">
            <p className="text-sm text-[var(--warning)]">
              Schema not recognized — showing raw payload.
            </p>
            <JsonViewer data={parsed.raw} variant="code" />
          </div>
        ) : (
          <>
            <p
              className={cn(
                "font-mono text-4xl font-medium tracking-tighter tabular-nums font-[family-name:var(--font-mono)]",
                highRisk
                  ? "text-[var(--destructive)]"
                  : "text-[var(--foreground)]",
              )}
            >
              {parsed.scoreText}
            </p>
            {parsed.scoreWarning ? (
              <p className="text-xs text-[var(--warning)]">{parsed.scoreWarning}</p>
            ) : null}
            <dl className="grid grid-cols-[1fr_auto] items-baseline gap-y-1.5 border-t border-dashed border-[var(--border)] pt-3">
              <LedgerRow label="Unproven employees">
                {parsed.unproven ?? "Unknown"}
              </LedgerRow>
              <LedgerRow label="Partial proof">
                {parsed.partial ?? "Unknown"}
              </LedgerRow>
              <LedgerRow label="Assignments">
                {parsed.assignments ?? "Unknown"}
              </LedgerRow>
              <LedgerRow label="Policy clauses linked">
                {parsed.clauses ?? "Unknown"}
              </LedgerRow>
            </dl>
            {parsed.summary ? (
              <p className="text-xs leading-relaxed text-[var(--body)]">
                {parsed.summary}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

type CoverageProps = {
  controlCoverage: Record<string, unknown>;
  snapshotId?: string;
  fetchedAt?: string;
};

export function ControlCoverageCard({
  controlCoverage,
  snapshotId,
  fetchedAt,
}: CoverageProps) {
  const proofLensEnabled = useUiStore((s) => s.proofLensEnabled);
  const parsed = parseControlCoverage(controlCoverage);

  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1 p-4 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight">
            Control coverage
          </CardTitle>
          {proofLensEnabled ? (
            <ProofLensTag
              kind="Modelled"
              endpoint="GET /v1/runs/{run_id}/assurance"
              timestamp={fetchedAt}
              id={snapshotId}
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        {!parsed.ok ? (
          <div className="space-y-2">
            <p className="text-sm text-[var(--warning)]">
              Schema not recognized — showing raw payload.
            </p>
            <JsonViewer data={parsed.raw} variant="code" />
          </div>
        ) : (
          <>
            <p className="font-mono text-4xl font-medium tracking-tighter tabular-nums text-[var(--foreground)] font-[family-name:var(--font-mono)]">
              {parsed.coverageText}
            </p>
            {parsed.coverageWarning ? (
              <p className="text-xs text-[var(--warning)]">
                {parsed.coverageWarning}
              </p>
            ) : null}
            <dl className="grid grid-cols-[1fr_auto] items-baseline gap-y-1.5 border-t border-dashed border-[var(--border)] pt-3">
              <LedgerRow label="Selected option">
                {parsed.selectedOptionKey ?? "Unknown"}
              </LedgerRow>
              <LedgerRow label="Hard constraints">
                {parsed.hardConstraintOk === true
                  ? "OK"
                  : parsed.hardConstraintOk === false
                    ? "Failed"
                    : "Unknown"}
              </LedgerRow>
              <dt className="text-[11px] text-[var(--muted-foreground)]">
                Evidence class
              </dt>
              <dd className="text-right">
                <Badge
                  variant="warning"
                  className="px-1.5 py-0 text-[10px] font-sans"
                >
                  Modelled
                </Badge>
              </dd>
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}

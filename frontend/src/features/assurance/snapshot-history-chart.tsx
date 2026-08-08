"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ProofLensTag } from "@/components/proof-lens/proof-lens-tag";
import { EmptyState } from "@/components/ui/empty-state";
import {
  chronologicalSnapshots,
  parseResidualRisk,
} from "@/features/assurance/parse-assurance";
import type { AssuranceSnapshotView } from "@/lib/api/generated/openapi.types";
import { formatKlShort } from "@/lib/format/time";
import { useUiStore } from "@/stores/ui-store";

type Props = {
  snapshots: AssuranceSnapshotView[];
  fetchedAt?: string;
};

export function SnapshotHistoryChart({ snapshots, fetchedAt }: Props) {
  const proofLensEnabled = useUiStore((s) => s.proofLensEnabled);
  const chronological = chronologicalSnapshots(snapshots);

  const data = chronological.map((snap) => {
    const residual = parseResidualRisk(snap.residual_risk);
    return {
      id: snap.id,
      at: formatKlShort(snap.created_at),
      residual:
        residual.score != null && residual.score >= 0 && residual.score <= 1
          ? Number((residual.score * 100).toFixed(2))
          : residual.score,
    };
  });

  if (!data.length) {
    return (
      <EmptyState
        title="No assurance snapshots yet"
        description="Snapshots appear after schedule baseline or post-simulation refresh."
      />
    );
  }

  const sparse = data.length < 2;
  const single = data[0];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-medium text-[var(--foreground)]">
          Snapshot history
        </h3>
        {proofLensEnabled ? (
          <ProofLensTag
            kind="Measured"
            endpoint={`GET /v1/runs/{run_id}/assurance`}
            timestamp={fetchedAt}
            id={snapshots[0]?.id}
          />
        ) : null}
      </div>

      {sparse ? (
        <div className="relative flex min-h-[16rem] flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6 text-center">
          <p className="font-mono text-3xl font-medium tabular-nums tracking-tighter text-[var(--foreground)] font-[family-name:var(--font-mono)]">
            {single.residual == null || Number.isNaN(single.residual)
              ? "—"
              : `${single.residual}%`}
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Residual capability risk · {single.at}
          </p>
          <p className="mt-4 max-w-sm text-sm text-[var(--body)]">
            Awaiting more snapshots to render a trendline. Refresh after
            simulations to build history.
          </p>
          <p className="mt-2 font-mono text-[10px] text-[var(--muted-foreground)]">
            {single.id.slice(0, 8)}…
          </p>
        </div>
      ) : (
        <div className="h-64 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                stroke="var(--border)"
                strokeDasharray="4 6"
                strokeOpacity={0.55}
                vertical={false}
              />
              <XAxis
                dataKey="at"
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={40}
                label={{
                  value: "Residual %",
                  angle: -90,
                  position: "insideLeft",
                  style: { fill: "var(--muted-foreground)", fontSize: 10 },
                }}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                }}
                formatter={(value) => [
                  typeof value === "number" ? `${value}%` : String(value),
                  "Residual risk",
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="residual"
                name="Residual capability risk"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={{ r: 4, fill: "var(--primary)", strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="text-xs text-[var(--muted-foreground)]">
        Chart uses a chronological copy of newest-first API data (cache not
        mutated).
      </p>
    </div>
  );
}

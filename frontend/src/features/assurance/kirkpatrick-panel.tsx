"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProofLensTag } from "@/components/proof-lens/proof-lens-tag";
import {
  parseKirkpatrick,
  type ParsedKirkpatrickLevel,
} from "@/features/assurance/parse-assurance";
import { JsonViewer } from "@/features/agents/json-viewer";
import { formatRatioPercent } from "@/lib/format/score";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

type Props = {
  kirkpatrick: Record<string, unknown>;
  snapshotId?: string;
  fetchedAt?: string;
};

function statusBadgeVariant(
  status: string | undefined,
  level: ParsedKirkpatrickLevel,
): "success" | "warning" | "muted" | "evidence" | "destructive" {
  if (level.key === "L3") {
    return level.green ? "success" : "warning";
  }
  if (level.key === "L4") return "warning";
  const s = (status ?? "").toLowerCase();
  if (s.includes("complete") || s.includes("pass") || s.includes("ok")) {
    return "success";
  }
  if (s.includes("pending") || s.includes("await")) return "warning";
  if (s.includes("fail") || s.includes("risk")) return "destructive";
  return "muted";
}

function LevelCard({ level }: { level: ParsedKirkpatrickLevel }) {
  const proofLensEnabled = useUiStore((s) => s.proofLensEnabled);

  return (
    <Card
      className={cn(
        "shadow-none",
        level.green && "border-[var(--success)]/45 bg-[var(--success-soft)]/35",
        level.key === "L3" &&
          !level.green &&
          "border-[var(--warning)]/40 bg-[var(--warning-soft)]/25",
      )}
    >
      <CardHeader className="space-y-2 p-4 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight">
            {level.label}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1">
            {level.key === "L3" ? (
              <Badge
                variant={level.green ? "success" : "warning"}
                className="px-1.5 py-0 text-[10px]"
              >
                {level.green ? "Behaviour proof" : "No Level 3 proof"}
              </Badge>
            ) : null}
            {level.key === "L4" ? (
              <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                {level.kind}
              </Badge>
            ) : null}
            {level.status ? (
              <Badge
                variant={statusBadgeVariant(level.status, level)}
                className="px-1.5 py-0 text-[10px]"
              >
                {level.status}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0 text-sm">
        {level.key === "L3" ? (
          <dl className="grid grid-cols-[1fr_auto] items-baseline gap-y-1.5 text-xs">
            <dt className="text-[var(--muted-foreground)]">Level 3 proofs</dt>
            <dd className="text-right font-mono font-medium tabular-nums text-[var(--foreground)] font-[family-name:var(--font-mono)]">
              {level.level3Proofs ?? "Unknown"}
            </dd>
            <dt className="text-[var(--muted-foreground)]">Attempts</dt>
            <dd className="text-right font-mono font-medium tabular-nums text-[var(--foreground)] font-[family-name:var(--font-mono)]">
              {level.attempts ?? "Unknown"}
            </dd>
          </dl>
        ) : null}
        {level.key === "L4" && level.coverageProxy != null ? (
          <p className="text-xs text-[var(--body)]">
            Coverage proxy:{" "}
            <span className="font-mono font-medium tabular-nums text-[var(--foreground)]">
              {formatRatioPercent(level.coverageProxy).text}
            </span>{" "}
            <span className="text-[var(--muted-foreground)]">
              (Modelled — not claimed cash ROI)
            </span>
          </p>
        ) : null}
        {level.note ? (
          <p className="line-clamp-3 text-xs leading-snug text-[var(--body)]">
            {level.note}
          </p>
        ) : null}
        {!level.raw ? (
          <p className="text-xs text-[var(--muted-foreground)]">Unknown</p>
        ) : null}
        {proofLensEnabled ? (
          <ProofLensTag
            kind={level.kind}
            endpoint="GET /v1/runs/{run_id}/assurance"
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function KirkpatrickPanel({
  kirkpatrick,
  snapshotId,
  fetchedAt,
}: Props) {
  const proofLensEnabled = useUiStore((s) => s.proofLensEnabled);
  const levels = parseKirkpatrick(kirkpatrick);
  const unrecognized = levels.every((l) => !l.raw);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-medium text-[var(--foreground)]">
          Kirkpatrick L1–L4
        </h3>
        {proofLensEnabled ? (
          <ProofLensTag
            kind="Measured"
            endpoint="GET /v1/runs/{run_id}/assurance"
            timestamp={fetchedAt}
            id={snapshotId}
          />
        ) : null}
      </div>
      {unrecognized ? (
        <div className="space-y-2">
          <p className="text-sm text-[var(--warning)]">
            Schema not recognized — showing raw payload.
          </p>
          <JsonViewer data={kirkpatrick} variant="code" />
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {levels.map((level) => (
            <LevelCard key={level.key} level={level} />
          ))}
        </div>
      )}
      <p className="text-xs text-[var(--muted-foreground)]">
        L3 turns green only with deterministic behaviour proof from data. L4 /
        ROI / predicted risk reduction are Assumption or Modelled — not measured
        cash results.
      </p>
    </div>
  );
}

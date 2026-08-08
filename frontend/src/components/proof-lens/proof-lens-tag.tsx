"use client";

import * as React from "react";
import {
  CircleHelp,
  FlaskConical,
  LineChart,
  Ruler,
  type LucideIcon,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatKlShort } from "@/lib/format/time";
import { cn } from "@/lib/utils";

export type ProofLensKind =
  | "Measured"
  | "Modelled"
  | "Assumption"
  | "Unknown";

const KIND_CONFIG: Record<
  ProofLensKind,
  {
    icon: LucideIcon;
    chip: string;
    dot: string;
    hint: string;
  }
> = {
  Measured: {
    icon: Ruler,
    chip: "border-[var(--success)]/25 bg-[var(--success-soft)] text-[var(--success)]",
    dot: "bg-[var(--success)]",
    hint: "Observed from API / persisted evidence",
  },
  Modelled: {
    icon: LineChart,
    chip: "border-[var(--warning)]/25 bg-[var(--warning-soft)] text-[var(--warning)]",
    dot: "bg-[var(--warning)]",
    hint: "Solver or model output — not realized outcome",
  },
  Assumption: {
    icon: FlaskConical,
    chip: "border-[var(--evidence)]/25 bg-[var(--evidence-soft)] text-[var(--evidence)]",
    dot: "bg-[var(--evidence)]",
    hint: "Assumption-tagged — do not treat as proven result",
  },
  Unknown: {
    icon: CircleHelp,
    chip: "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-foreground)]",
    dot: "bg-[var(--muted-foreground)]",
    hint: "Provenance not classified",
  },
};

export interface ProofLensTagProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
  kind: ProofLensKind;
  endpoint?: string;
  timestamp?: string;
  hash?: string;
  id?: string;
}

function formatFetched(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return formatKlShort(value);
}

function ProofLensTag({
  kind,
  endpoint,
  timestamp,
  hash,
  id,
  className,
  ...props
}: ProofLensTagProps) {
  const config = KIND_CONFIG[kind];
  const Icon = config.icon;
  const rows = [
    endpoint ? { label: "Endpoint", value: endpoint } : null,
    timestamp
      ? { label: "Fetched", value: formatFetched(timestamp) }
      : null,
    id ? { label: "ID", value: id } : null,
    hash ? { label: "Hash", value: hash } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const hasMeta = rows.length > 0;

  const chipClass = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide",
    "font-[family-name:var(--font-sans)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]",
    config.chip,
    className,
  );

  const chipInner = (
    <>
      <span
        className={cn("size-1.5 shrink-0 rounded-full", config.dot)}
        aria-hidden
      />
      <Icon className="size-3 shrink-0 opacity-90" aria-hidden />
      <span>{kind}</span>
    </>
  );

  if (!hasMeta) {
    return (
      <span
        className={chipClass}
        title={config.hint}
        aria-label={`Proof Lens: ${kind}. ${config.hint}`}
        {...props}
      >
        {chipInner}
      </span>
    );
  }

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            chipClass,
            "cursor-help transition-shadow hover:shadow-sm",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
          )}
          aria-label={`Proof Lens: ${kind}. Shows provenance details.`}
          {...props}
        >
          {chipInner}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] border-[var(--border-strong)] bg-[var(--surface-raised)] p-0 text-[var(--foreground)] shadow-md"
      >
        <div className="border-b border-[var(--border)] px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                config.chip,
              )}
            >
              <Icon className="size-3" aria-hidden />
              {kind}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Proof Lens
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
            {config.hint}
          </p>
        </div>
        <dl className="space-y-2 px-3 py-2.5">
          {rows.map((row) => (
            <div key={row.label} className="grid gap-0.5">
              <dt className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                {row.label}
              </dt>
              <dd className="break-all font-mono text-[11px] leading-snug text-[var(--foreground)]">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </TooltipContent>
    </Tooltip>
  );
}

export { ProofLensTag };

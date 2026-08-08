import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  PauseCircle,
  ShieldAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

type StatusConfig = {
  icon: LucideIcon;
  label: string;
  className: string;
};

const STATUS_MAP: Record<string, StatusConfig> = {
  approved: {
    icon: CheckCircle2,
    label: "Approved",
    className: "bg-[var(--success-soft)] text-[var(--success)] border-[var(--success)]/20",
  },
  verified: {
    icon: CheckCircle2,
    label: "Verified",
    className: "bg-[var(--success-soft)] text-[var(--success)] border-[var(--success)]/20",
  },
  completed: {
    icon: CheckCircle2,
    label: "Completed",
    className: "bg-[var(--success-soft)] text-[var(--success)] border-[var(--success)]/20",
  },
  success: {
    icon: CheckCircle2,
    label: "Success",
    className: "bg-[var(--success-soft)] text-[var(--success)] border-[var(--success)]/20",
  },
  pending: {
    icon: Clock,
    label: "Pending",
    className: "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning)]/20",
  },
  modelled: {
    icon: Clock,
    label: "Modelled",
    className: "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning)]/20",
  },
  stale: {
    icon: Clock,
    label: "Stale",
    className: "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning)]/20",
  },
  warning: {
    icon: AlertCircle,
    label: "Warning",
    className: "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning)]/20",
  },
  running: {
    icon: Loader2,
    label: "Running",
    className: "bg-[var(--evidence-soft)] text-[var(--evidence)] border-[var(--evidence)]/20",
  },
  active: {
    icon: Loader2,
    label: "Active",
    className: "bg-[var(--evidence-soft)] text-[var(--evidence)] border-[var(--evidence)]/20",
  },
  evidence: {
    icon: ShieldAlert,
    label: "Evidence",
    className: "bg-[var(--evidence-soft)] text-[var(--evidence)] border-[var(--evidence)]/20",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    className: "bg-[var(--destructive-soft)] text-[var(--destructive)] border-[var(--destructive)]/20",
  },
  error: {
    icon: XCircle,
    label: "Error",
    className: "bg-[var(--destructive-soft)] text-[var(--destructive)] border-[var(--destructive)]/20",
  },
  destructive: {
    icon: XCircle,
    label: "Critical",
    className: "bg-[var(--destructive-soft)] text-[var(--destructive)] border-[var(--destructive)]/20",
  },
  veto: {
    icon: ShieldAlert,
    label: "Veto",
    className: "bg-[var(--destructive-soft)] text-[var(--destructive)] border-[var(--destructive)]/20",
  },
  paused: {
    icon: PauseCircle,
    label: "Paused",
    className: "bg-[var(--surface)] text-[var(--muted-foreground)] border-[var(--border)]",
  },
  unknown: {
    icon: HelpCircle,
    label: "Unknown",
    className: "bg-[var(--surface)] text-[var(--muted-foreground)] border-[var(--border)]",
  },
};

const DEFAULT_CONFIG: StatusConfig = {
  icon: HelpCircle,
  label: "Unknown",
  className: "bg-[var(--surface)] text-[var(--muted-foreground)] border-[var(--border)]",
};

function resolveStatusConfig(status: string): StatusConfig {
  const key = status.trim().toLowerCase();
  const mapped = STATUS_MAP[key];
  if (mapped) return mapped;

  return {
    ...DEFAULT_CONFIG,
    label: status,
  };
}

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: string;
  label?: string;
}

function StatusPill({ status, label, className, ...props }: StatusPillProps) {
  const config = resolveStatusConfig(status);
  const Icon = config.icon;
  const displayLabel = label ?? config.label;
  const isSpinning = status.trim().toLowerCase() === "running";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium font-[family-name:var(--font-sans)]",
        config.className,
        className,
      )}
      {...props}
    >
      <Icon
        className={cn("size-3.5 shrink-0", isSpinning && "animate-spin")}
        aria-hidden
      />
      <span>{displayLabel}</span>
    </span>
  );
}

export { StatusPill };

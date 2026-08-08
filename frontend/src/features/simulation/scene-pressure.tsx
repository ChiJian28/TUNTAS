"use client";

import {
  Activity,
  Shield,
  ShieldAlert,
  AlertTriangle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PressureLevel } from "@/features/simulation/turn-utils";

const PRESSURE_UI: Record<
  PressureLevel,
  {
    label: string;
    hint: string;
    bar: string;
    fill: string;
    icon: typeof Shield;
    badge: "evidence" | "warning" | "destructive";
    level: number;
  }
> = {
  calm: {
    label: "Controlled",
    hint: "Standard operating pressure",
    bar: "bg-[var(--evidence-soft)]",
    fill: "bg-[var(--evidence)]",
    icon: Shield,
    badge: "evidence",
    level: 1,
  },
  elevated: {
    label: "Elevated",
    hint: "Stakeholder pressure rising",
    bar: "bg-[var(--warning-soft)]",
    fill: "bg-[var(--warning)]",
    icon: AlertTriangle,
    badge: "warning",
    level: 2,
  },
  critical: {
    label: "Critical",
    hint: "Regulatory / loss risk active",
    bar: "bg-[var(--destructive-soft)]",
    fill: "bg-[var(--destructive)]",
    icon: ShieldAlert,
    badge: "destructive",
    level: 3,
  },
};

export function ScenePressure({
  pressure,
  difficulty,
  className,
}: {
  pressure: PressureLevel;
  difficulty: string;
  className?: string;
}) {
  const ui = PRESSURE_UI[pressure];
  const Icon = ui.icon;

  return (
    <div
      className={cn(
        "flex min-w-[10.5rem] flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/90 px-3 py-2 backdrop-blur",
        className,
      )}
      title={ui.hint}
      aria-label={`Scene pressure: ${ui.label}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
          <Activity className="size-3" aria-hidden />
          Pressure
        </span>
        <Badge variant={ui.badge} className="gap-1 text-[10px]">
          <Icon className="size-3" aria-hidden />
          {difficulty || ui.label}
        </Badge>
      </div>
      <div className={cn("flex h-1.5 gap-1 overflow-hidden rounded-full", ui.bar)}>
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cn(
              "h-full flex-1 rounded-full transition-colors",
              n <= ui.level ? ui.fill : "bg-transparent",
            )}
          />
        ))}
      </div>
      <p className="text-[10px] leading-snug text-[var(--muted-foreground)]">
        {ui.hint}
      </p>
    </div>
  );
}

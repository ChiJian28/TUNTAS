"use client";

import { AlertTriangle, ShieldAlert, Shield } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { ScenarioView } from "@/lib/api/generated/openapi.types";
import { GOLDEN_SCENARIOS } from "@/lib/constants/agents";
import { cn } from "@/lib/utils";

type Props = {
  scenario: ScenarioView | null;
  difficulty: string;
  employeeRef: string;
  employeeLabel?: string;
  /** Dense header for split-screen dossier */
  compact?: boolean;
};

function DifficultyIcon({ difficulty }: { difficulty: string }) {
  const d = difficulty.toLowerCase();
  if (d === "critical" || d === "high") {
    return <ShieldAlert className="size-4 text-[var(--destructive)]" aria-hidden />;
  }
  if (d === "elevated" || d === "medium") {
    return <AlertTriangle className="size-4 text-[var(--warning)]" aria-hidden />;
  }
  return <Shield className="size-4 text-[var(--evidence)]" aria-hidden />;
}

export function CaseBrief({
  scenario,
  difficulty,
  employeeRef,
  employeeLabel,
  compact = false,
}: Props) {
  const isGolden =
    scenario != null &&
    (GOLDEN_SCENARIOS as readonly string[]).includes(scenario.code);

  if (compact) {
    return (
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display text-base leading-snug text-[var(--foreground)]">
              {scenario?.title ?? "Scenario"}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {scenario?.role_focus ?? "Unknown role"} ·{" "}
              <span className="font-mono">
                {employeeLabel ?? employeeRef}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {scenario?.code ? (
              <Badge variant="muted" className="font-mono text-[10px]">
                {scenario.code}
              </Badge>
            ) : null}
            {isGolden ? (
              <Badge variant="soft-primary" className="text-[10px]">
                Golden
              </Badge>
            ) : null}
            <Badge
              variant={
                difficulty.toLowerCase() === "critical"
                  ? "destructive"
                  : difficulty.toLowerCase() === "elevated"
                    ? "warning"
                    : "evidence"
              }
              className="inline-flex items-center gap-1 text-[10px]"
            >
              <DifficultyIcon difficulty={difficulty} />
              {difficulty}
            </Badge>
          </div>
        </div>
        <ScrollArea className="h-20 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-2.5">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--body)]">
            {scenario?.prompt?.trim() ||
              "No prompt returned by GET /scenarios for this scenario."}
          </p>
        </ScrollArea>
      </div>
    );
  }

  return (
    <Card className="flex h-auto min-h-0 flex-col border-0 bg-transparent shadow-none lg:h-full">
      <CardHeader className="shrink-0 px-0 pt-0">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Case brief
        </p>
        <CardTitle className="text-lg">
          {scenario?.title ?? "Scenario"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-0">
        <div className="flex shrink-0 flex-wrap gap-2">
          {scenario?.code ? (
            <Badge variant="muted" className="font-mono">
              {scenario.code}
            </Badge>
          ) : null}
          {isGolden ? <Badge variant="soft-primary">Golden</Badge> : null}
          <Badge
            variant={
              difficulty.toLowerCase() === "critical"
                ? "destructive"
                : difficulty.toLowerCase() === "elevated"
                  ? "warning"
                  : "evidence"
            }
            className={cn("inline-flex items-center gap-1")}
          >
            <DifficultyIcon difficulty={difficulty} />
            {difficulty}
          </Badge>
        </div>

        <dl className="shrink-0 space-y-2 text-sm">
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Role focus</dt>
            <dd className="text-[var(--foreground)]">
              {scenario?.role_focus ?? "Unknown"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Employee</dt>
            <dd className="font-mono text-[var(--foreground)]">
              {employeeLabel ?? employeeRef}
            </dd>
            {employeeLabel && employeeLabel !== employeeRef ? (
              <dd className="font-mono text-xs text-[var(--muted-foreground)]">
                {employeeRef}
              </dd>
            ) : null}
          </div>
        </dl>

        <Separator className="shrink-0" />

        <div className="flex min-h-0 flex-1 flex-col">
          <p className="mb-1 shrink-0 text-xs font-medium text-[var(--muted-foreground)]">
            Scenario provenance
          </p>
          <ScrollArea className="h-36 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 lg:h-full lg:min-h-0">
            <p className="whitespace-pre-wrap text-sm text-[var(--body)]">
              {scenario?.prompt?.trim() ||
                "No prompt returned by GET /scenarios for this scenario."}
            </p>
          </ScrollArea>
        </div>

        <p className="shrink-0 text-xs text-[var(--muted-foreground)]">
          Rubric answers are not shown here. Score and Level appear only after
          finalize.
        </p>
      </CardContent>
    </Card>
  );
}

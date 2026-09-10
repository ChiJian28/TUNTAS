"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { GateDecisionCard } from "@/features/review/gate-decision-card";
import { EmployeeDrawer } from "@/features/runs/employee-drawer";
import { apiQueries } from "@/lib/api/queries";
import type { ReviewGateKey } from "@/lib/api/generated/openapi.types";
import { DISCLAIMER } from "@/lib/constants/agents";
import { TuntasApiError } from "@/lib/api/errors";

type Props = {
  runId: string;
  gateKey: ReviewGateKey;
  children: ReactNode;
  aside?: ReactNode;
};

export function ReviewShell({ runId, gateKey, children, aside }: Props) {
  const gates = useQuery(apiQueries.gates(runId));

  if (gates.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (gates.isError) {
    const err = gates.error as TuntasApiError;
    return (
      <ErrorState
        message={err.message}
        status={err.status}
        endpoint={err.endpoint}
        onRetry={() => void gates.refetch()}
      />
    );
  }

  const chain = gates.data;
  const gate = chain?.gates.find((g) => g.gate_key === gateKey);

  if (!gate || !chain) {
    return (
      <ErrorState
        message="Review chain has no row for this gate."
        onRetry={() => void gates.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Review · Gate {gate.sequence} of {chain.gates.length}
        </p>
        <h1 className="font-display text-3xl text-[var(--foreground)]">
          {gate.label}
        </h1>
        <p className="max-w-3xl text-sm text-[var(--body)]">{gate.prompt}</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant={chain.path === "circular" ? "evidence" : "muted"}>
            Path: {chain.path === "circular" ? "Scenario B (circular)" : "Capability"}
          </Badge>
          <Badge variant="muted">Current: {chain.current_gate ?? "—"}</Badge>
          {chain.commit_unlocked ? (
            <Badge variant="success">Management COMMIT unlocked</Badge>
          ) : (
            <Badge variant="warning">
              COMMIT locked
              {chain.commit_blocked_by.length
                ? ` · waiting ${chain.commit_blocked_by.join(", ")}`
                : ""}
            </Badge>
          )}
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">{DISCLAIMER}</p>
        <p className="text-xs">
          <Link
            href={`/runs/${runId}/evidence`}
            className="text-[var(--link)] underline"
          >
            Open Evidence Spine
          </Link>
          {" · "}
          <Link
            href={`/runs/${runId}/audit?tab=gates`}
            className="text-[var(--link)] underline"
          >
            Gate audit
          </Link>
        </p>
      </header>

      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">{children}</div>
        <aside className="min-w-0 space-y-6 lg:sticky lg:top-4 lg:self-start">
          {aside ?? <GateDecisionCard runId={runId} gate={gate} />}
        </aside>
      </div>
      <EmployeeDrawer runId={runId} />
    </div>
  );
}

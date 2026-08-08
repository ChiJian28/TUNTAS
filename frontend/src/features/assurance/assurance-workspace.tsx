"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { ProofLensTag } from "@/components/proof-lens/proof-lens-tag";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { KirkpatrickPanel } from "@/features/assurance/kirkpatrick-panel";
import { QuickProofDrawer } from "@/features/assurance/quick-proof-drawer";
import {
  latestSnapshot,
} from "@/features/assurance/parse-assurance";
import {
  ControlCoverageCard,
  ResidualRiskCard,
} from "@/features/assurance/risk-coverage-cards";
import { ScenarioLauncher } from "@/features/assurance/scenario-launcher";
import { SnapshotHistoryChart } from "@/features/assurance/snapshot-history-chart";
import { apiQueries } from "@/lib/api/queries";
import {
  invalidateAfterAssuranceRefresh,
  refreshAssurance,
} from "@/lib/api/mutations";
import { TuntasApiError } from "@/lib/api/errors";
import { formatKl } from "@/lib/format/time";
import { useUiStore } from "@/stores/ui-store";

type Props = {
  runId: string;
};

export function AssuranceWorkspace({ runId }: Props) {
  const qc = useQueryClient();
  const proofLensEnabled = useUiStore((s) => s.proofLensEnabled);
  const pushMutation = useUiStore((s) => s.pushMutation);
  const popMutation = useUiStore((s) => s.popMutation);

  const assuranceQ = useQuery(apiQueries.assurance(runId));
  const scenariosQ = useQuery(apiQueries.scenarios(runId));
  const employeesQ = useQuery(apiQueries.employees(runId));

  const refreshMut = useMutation({
    mutationFn: () => refreshAssurance(runId),
    onMutate: () => {
      const id = pushMutation("Refreshing assurance");
      return { id };
    },
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx?.id) popMutation(ctx.id);
    },
    onSuccess: () => {
      invalidateAfterAssuranceRefresh(qc, runId);
      toast.success("Assurance refreshed");
    },
    onError: (err) => {
      toast.error(
        err instanceof TuntasApiError ? err.message : "Refresh failed",
      );
    },
  });

  const loading =
    assuranceQ.isLoading || scenariosQ.isLoading || employeesQ.isLoading;
  const error = assuranceQ.error ?? scenariosQ.error ?? employeesQ.error;

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    const apiErr = error instanceof TuntasApiError ? error : null;
    return (
      <div className="p-6">
        <ErrorState
          message={apiErr?.message ?? "Failed to load assurance"}
          status={apiErr?.status}
          endpoint={apiErr?.endpoint}
          onRetry={() => {
            void assuranceQ.refetch();
            void scenariosQ.refetch();
            void employeesQ.refetch();
          }}
        />
      </div>
    );
  }

  const snapshots = assuranceQ.data ?? [];
  const latest = latestSnapshot(snapshots);
  const fetchedAt = assuranceQ.dataUpdatedAt
    ? new Date(assuranceQ.dataUpdatedAt).toISOString()
    : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="flex flex-col items-start justify-between gap-6 border-b border-[var(--border)] pb-6 lg:flex-row lg:items-end">
        <div className="max-w-2xl space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
            Assurance Workspace
          </p>
          <h1 className="font-display text-3xl tracking-tight text-[var(--foreground)]">
            Readiness & Residual Risk
          </h1>
          <p className="text-sm leading-relaxed text-[var(--body)]">
            Attendance is not proof. Kirkpatrick L3 requires deterministic
            behaviour evidence from simulation attempts.
          </p>
          {latest ? (
            <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--muted-foreground)]">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--success)] opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-[var(--success)]" />
              </span>
              Latest snapshot {formatKl(latest.created_at)} ·{" "}
              <span className="font-mono">{latest.id.slice(0, 8)}…</span>
            </div>
          ) : null}
        </div>

        <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto">
          <Button
            variant="outline"
            size="sm"
            asChild
            className="border-[var(--border-strong)] bg-[var(--surface-raised)]"
          >
            <Link href={`/runs/${runId}/overview`}>Back to overview</Link>
          </Button>
          <QuickProofDrawer
            runId={runId}
            scenarios={scenariosQ.data ?? []}
            employees={employeesQ.data ?? []}
          />
          <Button
            size="sm"
            className="gap-2 bg-[var(--foreground)] text-white shadow-sm hover:bg-black hover:text-white"
            disabled={refreshMut.isPending}
            onClick={() => refreshMut.mutate()}
          >
            <RefreshCw
              className={`size-3.5 ${refreshMut.isPending ? "animate-spin" : ""}`}
              aria-hidden
            />
            {refreshMut.isPending ? "Refreshing…" : "Refresh Assurance"}
          </Button>
        </div>
      </header>

      {proofLensEnabled ? (
        <ProofLensTag
          kind="Measured"
          endpoint={`GET /v1/runs/${runId}/assurance`}
          timestamp={fetchedAt}
          id={latest?.id}
        />
      ) : null}

      {!latest ? (
        <EmptyState
          title="No assurance snapshot"
          description="Run schedule commit or click Refresh after simulations to create a baseline."
          action={
            <Button
              size="sm"
              disabled={refreshMut.isPending}
              onClick={() => refreshMut.mutate()}
            >
              Refresh now
            </Button>
          }
        />
      ) : (
        <>
          <KirkpatrickPanel
            kirkpatrick={latest.kirkpatrick}
            snapshotId={latest.id}
            fetchedAt={fetchedAt}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <ResidualRiskCard
              residualRisk={latest.residual_risk}
              snapshotId={latest.id}
              fetchedAt={fetchedAt}
            />
            <ControlCoverageCard
              controlCoverage={latest.control_coverage}
              snapshotId={latest.id}
              fetchedAt={fetchedAt}
            />
          </div>
        </>
      )}

      <SnapshotHistoryChart snapshots={snapshots} fetchedAt={fetchedAt} />

      <section className="space-y-3">
        <h2 className="font-display text-xl text-[var(--foreground)]">
          Scenario launcher
        </h2>
        <p className="text-sm text-[var(--body)]">
          Golden drills: SCN-FRAUD-MULE, SCN-AML-ESC, SCN-PDPA-VENDOR, SCN-CS-SE.
          Employee query param is required to start.
        </p>
        <ScenarioLauncher
          runId={runId}
          scenarios={scenariosQ.data ?? []}
          employees={employeesQ.data ?? []}
        />
      </section>
    </div>
  );
}

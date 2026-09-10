"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApprovalTab } from "@/features/audit/approval-tab";
import { ArtifactsTab } from "@/features/audit/artifacts-tab";
import { EventsTab } from "@/features/audit/events-tab";
import { GatesTab } from "@/features/audit/gates-tab";
import { HandoffsTab } from "@/features/audit/handoffs-tab";
import { MetricsTab } from "@/features/audit/metrics-tab";
import { ProofLensTag } from "@/components/proof-lens/proof-lens-tag";
import { apiQueries } from "@/lib/api/queries";
import { TuntasApiError } from "@/lib/api/errors";
import { useUiStore } from "@/stores/ui-store";

type Props = {
  runId: string;
};

export function AuditWorkspace({ runId }: Props) {
  const searchParams = useSearchParams();
  const handoffDeepLink = searchParams.get("handoff");
  const tabParam = searchParams.get("tab");
  const proofLensEnabled = useUiStore((s) => s.proofLensEnabled);

  const [tab, setTab] = useState(
    handoffDeepLink ? "handoffs" : tabParam || "events",
  );

  useEffect(() => {
    if (handoffDeepLink) setTab("handoffs");
    else if (tabParam === "gates") setTab("gates");
  }, [handoffDeepLink, tabParam]);

  const meQ = useQuery(apiQueries.me);
  const eventsQ = useQuery(apiQueries.events(runId));
  const handoffsQ = useQuery(apiQueries.handoffs(runId, false));
  const approvalQ = useQuery(apiQueries.approval(runId));
  const approvalsQ = useQuery(apiQueries.approvals(runId));
  const gatesQ = useQuery(apiQueries.gates(runId));
  const artifactsQ = useQuery(apiQueries.artifacts(runId));
  const metricsQ = useQuery(apiQueries.metrics);

  const loading =
    eventsQ.isLoading ||
    handoffsQ.isLoading ||
    approvalQ.isLoading ||
    approvalsQ.isLoading ||
    gatesQ.isLoading ||
    artifactsQ.isLoading ||
    metricsQ.isLoading ||
    meQ.isLoading;

  const firstError =
    eventsQ.error ||
    handoffsQ.error ||
    approvalQ.error ||
    approvalsQ.error ||
    gatesQ.error ||
    artifactsQ.error ||
    metricsQ.error ||
    meQ.error;

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (firstError) {
    const apiErr = firstError instanceof TuntasApiError ? firstError : null;
    return (
      <div className="p-6">
        <ErrorState
          message={apiErr?.message ?? "Failed to load audit data"}
          status={apiErr?.status}
          endpoint={apiErr?.endpoint}
          onRetry={() => {
            void eventsQ.refetch();
            void handoffsQ.refetch();
            void approvalQ.refetch();
            void approvalsQ.refetch();
            void gatesQ.refetch();
            void artifactsQ.refetch();
            void metricsQ.refetch();
            void meQ.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Audit & integrity
          </p>
          <h1 className="font-display text-3xl text-[var(--foreground)]">
            Traceable evidence trail
          </h1>
          <p className="max-w-2xl text-sm text-[var(--body)]">
            Events, handoffs, approvals, artifact hashes, and operational
            metrics — without inventing cryptographic chain claims.
          </p>
          {meQ.data ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-[var(--muted-foreground)]">
                Viewing as
              </span>
              <Badge variant="soft-primary" className="font-mono">
                {meQ.data.subject}
              </Badge>
              <Badge variant="muted">{meQ.data.role}</Badge>
              <Badge variant="muted">{meQ.data.auth_mode}</Badge>
            </div>
          ) : null}
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/runs/${runId}/overview`}>Back to overview</Link>
        </Button>
      </header>

      {proofLensEnabled ? (
        <ProofLensTag
          kind="Measured"
          endpoint={`GET /v1/runs/${runId}/events`}
          timestamp={
            eventsQ.dataUpdatedAt
              ? new Date(eventsQ.dataUpdatedAt).toISOString()
              : undefined
          }
        />
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-6 rounded-none border-b border-[var(--border)] bg-transparent p-0">
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="handoffs">
            Handoffs
            {handoffDeepLink ? (
              <span className="ml-1 text-[10px] opacity-70">deep-link</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="approval">Approval</TabsTrigger>
          <TabsTrigger value="gates">Gates</TabsTrigger>
          <TabsTrigger value="artifacts">Artifact integrity</TabsTrigger>
          <TabsTrigger value="metrics">Global metrics</TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="mt-4">
          <EventsTab events={eventsQ.data ?? []} />
        </TabsContent>
        <TabsContent value="handoffs" className="mt-4">
          {handoffDeepLink ? (
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">
              Deep-link handoff={" "}
              <span className="font-mono">{handoffDeepLink}</span> — filter or
              scroll to match in the archive below.
            </p>
          ) : null}
          <HandoffsTab
            handoffs={handoffsQ.data ?? []}
            highlightId={handoffDeepLink}
          />
        </TabsContent>
        <TabsContent value="approval" className="mt-4">
          <ApprovalTab
            latest={approvalQ.data}
            history={approvalsQ.data ?? []}
          />
        </TabsContent>
        <TabsContent value="gates" className="mt-4">
          <GatesTab chain={gatesQ.data} />
        </TabsContent>
        <TabsContent value="artifacts" className="mt-4">
          <ArtifactsTab artifacts={artifactsQ.data ?? []} />
        </TabsContent>
        <TabsContent value="metrics" className="mt-4">
          <MetricsTab
            metrics={metricsQ.data}
            fetchedAt={
              metricsQ.dataUpdatedAt
                ? new Date(metricsQ.dataUpdatedAt).toISOString()
                : undefined
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

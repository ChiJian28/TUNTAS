"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiQueries } from "@/lib/api/queries";
import { TuntasApiError } from "@/lib/api/errors";
import { recommendedNextAction } from "@/features/agents/derive-agent-state";
import { AgentGraph } from "@/features/agents/agent-graph";
import { HandoffInspector } from "@/features/agents/handoff-inspector";
import { PersistedTimeline } from "@/features/agents/persisted-timeline";
import type { DerivedAgentNode } from "@/features/agents/derive-agent-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Badge } from "@/components/ui/badge";
import { ProofLensTag } from "@/components/proof-lens/proof-lens-tag";
import { useUiStore } from "@/stores/ui-store";
import { AICB_ATTRIBUTION, DISCLAIMER } from "@/lib/constants/agents";
import type { AgentHandoffView } from "@/lib/api/generated/openapi.types";

export default function OverviewPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const search = useSearchParams();
  const proofLens = useUiStore((s) => s.proofLensEnabled);
  const [inspectHandoff, setInspectHandoff] = useState<AgentHandoffView | null>(
    null,
  );

  const cockpit = useQuery(apiQueries.cockpit(runId));
  const timeline = useQuery({
    ...apiQueries.timeline(runId),
    enabled: !!cockpit.data,
  });
  const handoffs = useQuery({
    ...apiQueries.handoffs(runId, true),
    enabled: !!cockpit.data,
  });
  const events = useQuery({
    ...apiQueries.events(runId),
    enabled: !!cockpit.data,
  });

  const handoffById = useMemo(() => {
    const map = new Map<string, AgentHandoffView>();
    (handoffs.data ?? []).forEach((h) => map.set(h.id, h));
    (cockpit.data?.handoffs ?? []).forEach((h) => {
      if (!map.has(h.id)) map.set(h.id, h);
    });
    return map;
  }, [handoffs.data, cockpit.data?.handoffs]);

  /** Merge /events + timeline events so deterministic nodes (optimizer) complete via event. */
  const graphEvents = useMemo(() => {
    const fromApi = (events.data ?? []).map((e) => ({
      event_type: e.event_type,
      payload: e.payload,
      at: e.created_at,
      created_at: e.created_at,
    }));
    const fromTimeline = (timeline.data?.items ?? [])
      .filter(
        (i): i is Extract<(typeof i), { kind: "event" }> => i.kind === "event",
      )
      .map((i) => ({
        event_type: i.event_type,
        payload: i.payload,
        at: i.at,
        created_at: i.at,
      }));
    const fromCockpit = (cockpit.data?.latest_events ?? []).map((e) => ({
      event_type:
        typeof e.event_type === "string"
          ? e.event_type
          : typeof e.type === "string"
            ? e.type
            : "",
      payload:
        e.payload && typeof e.payload === "object"
          ? (e.payload as Record<string, unknown>)
          : (e as Record<string, unknown>),
      at: typeof e.created_at === "string" ? e.created_at : undefined,
      created_at: typeof e.created_at === "string" ? e.created_at : undefined,
    }));
    const merged = [...fromApi, ...fromTimeline, ...fromCockpit];
    const seen = new Set<string>();
    return merged.filter((e) => {
      const key = `${e.event_type}|${e.at ?? e.created_at ?? ""}`;
      if (!e.event_type || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [events.data, timeline.data?.items, cockpit.data?.latest_events]);

  function openNode(node: DerivedAgentNode) {
    const first = node.handoffs[0];
    if (first) setInspectHandoff(first);
  }

  if (cockpit.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (cockpit.isError) {
    const err = cockpit.error as TuntasApiError;
    return (
      <ErrorState
        message={err.message}
        status={err.status}
        endpoint={err.endpoint}
        onRetry={() => void cockpit.refetch()}
      />
    );
  }

  const bundle = cockpit.data!;
  const next = recommendedNextAction({
    status: bundle.run.status,
    currentNode: bundle.run.current_node,
    awaitingApproval: bundle.run.awaiting_approval,
    currentGate: bundle.review?.current_gate,
  });
  const deepHandoff = search.get("handoff");
  const allHandoffs = handoffs.data ?? bundle.handoffs;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
          Overview
        </p>
        <h1 className="font-display text-3xl text-[var(--foreground)]">
          Parallel agent console
        </h1>
        <p className="max-w-2xl text-sm text-[var(--body)]">
          Timeline and node states come from persisted backend events and handoffs —
          not client timers.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={bundle.run.status} />
          {bundle.request?.synthetic ? (
            <Badge variant="warning">Demo Data</Badge>
          ) : null}
          {proofLens ? (
            <ProofLensTag
              kind="Measured"
              endpoint="GET /v1/runs/{id}/cockpit"
              timestamp={bundle.run.updated_at}
              id={bundle.run.id}
            />
          ) : null}
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">{DISCLAIMER}</p>
        <p className="text-[11px] text-[var(--muted-foreground)]">{AICB_ATTRIBUTION}</p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recommended next action</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-[var(--foreground)]">{next.label}</span>
            {next.href ? (
              <Link
                href={`/runs/${runId}/${next.href}`}
                className="text-[var(--link)] underline"
              >
                Open
              </Link>
            ) : null}
          </div>
          <p className="text-[var(--muted-foreground)]">{next.description}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">Agent graph</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentGraph
            currentNode={bundle.run.current_node}
            status={bundle.run.status}
            handoffs={allHandoffs}
            events={graphEvents}
            onSelectNode={openNode}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">Persisted timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.isError ? (
            <ErrorState
              message={(timeline.error as TuntasApiError).message}
              status={(timeline.error as TuntasApiError).status}
              onRetry={() => void timeline.refetch()}
            />
          ) : timeline.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (timeline.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No persisted timeline items yet. Execute the run to start agents.
            </p>
          ) : (
            <PersistedTimeline
              items={timeline.data?.items ?? []}
              handoffById={handoffById}
              onOpenHandoff={setInspectHandoff}
            />
          )}
        </CardContent>
      </Card>

      <HandoffInspector
        handoff={
          inspectHandoff ??
          (deepHandoff ? handoffById.get(deepHandoff) ?? null : null)
        }
        open={!!inspectHandoff || (!!deepHandoff && handoffById.has(deepHandoff))}
        onOpenChange={(open) => {
          if (!open) setInspectHandoff(null);
        }}
      />
    </div>
  );
}

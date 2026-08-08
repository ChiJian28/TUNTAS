"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeApiError } from "@/lib/api/errors";
import type { EvidenceNodeView } from "@/lib/api/generated/openapi.types";
import { apiQueries } from "@/lib/api/queries";
import { formatKl } from "@/lib/format/time";
import { cn } from "@/lib/utils";
import { toneForType } from "./type-tones";

type NodeInspectorProps = {
  runId: string;
  node: EvidenceNodeView | null;
  mode: string | null;
  onToggleLineage: () => void;
  className?: string;
};

function LedgerRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="shrink-0 text-[var(--muted-foreground)]">{label}</dt>
      <dd className="min-w-0 overflow-x-auto font-mono text-[var(--foreground)]">
        <span className="inline-block max-w-full break-all">{children}</span>
      </dd>
    </>
  );
}

function CodeSnippet({
  title,
  children,
  maxHeightClass = "max-h-56",
}: {
  title: string;
  children: string;
  maxHeightClass?: string;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)]">
      <div className="border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          {title}
        </p>
      </div>
      <div className={cn(maxHeightClass, "overflow-auto bg-[var(--surface-raised)]")}>
        <pre className="w-max min-w-full p-3 font-mono text-[10px] leading-relaxed whitespace-pre text-[var(--body)]">
          {children}
        </pre>
      </div>
    </section>
  );
}

export function EvidenceNodeInspector({
  runId,
  node,
  mode,
  onToggleLineage,
  className,
}: NodeInspectorProps) {
  const lineageEnabled = mode === "lineage" && Boolean(node?.id);
  const lineageQuery = useQuery({
    ...apiQueries.lineage(node?.id ?? ""),
    enabled: lineageEnabled,
  });

  const tone = node ? toneForType(node.node_type) : null;

  return (
    <aside
      className={cn(
        "flex w-80 min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-lg",
        className,
      )}
    >
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground)]">
          Inspector
        </h2>
        <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
          ?node=&amp;mode=lineage
        </p>
      </div>
      {/* Native overflow so long IDs / JSON can scroll horizontally */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="space-y-4 p-4">
          {!node ? (
            <EmptyState
              title="No node selected"
              description="Click a graph node to inspect payload and lineage."
              className="py-8"
            />
          ) : (
            <>
              <div className="space-y-2">
                <Badge
                  variant="muted"
                  className={cn(
                    "border-transparent font-mono text-[10px]",
                    tone?.softBg,
                    tone?.softText,
                  )}
                  style={{
                    borderLeft: `3px solid ${tone?.accent ?? "var(--border)"}`,
                  }}
                >
                  {node.node_type}
                </Badge>
                <h3 className="text-sm font-semibold leading-snug break-words text-[var(--foreground)]">
                  {node.label}
                </h3>
              </div>

              <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-2 font-mono text-[11px]">
                  <LedgerRow label="ID">{node.id}</LedgerRow>
                  <LedgerRow label="Ref">{node.external_ref}</LedgerRow>
                  {node.content_hash ? (
                    <LedgerRow label="Hash">{node.content_hash}</LedgerRow>
                  ) : null}
                  {node.created_at ? (
                    <LedgerRow label="Created">
                      {formatKl(node.created_at)}
                    </LedgerRow>
                  ) : null}
                </dl>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-[11px]"
                  variant={mode === "lineage" ? "default" : "outline"}
                  onClick={onToggleLineage}
                >
                  {mode === "lineage" ? "Lineage on" : "Load lineage"}
                </Button>
                {node.node_type.toLowerCase().includes("employee") ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[11px]"
                    asChild
                  >
                    <Link
                      href={`/runs/${runId}/delivery?employee=${encodeURIComponent(node.external_ref)}`}
                    >
                      Open employee
                    </Link>
                  </Button>
                ) : null}
              </div>

              <CodeSnippet title="Payload">
                {JSON.stringify(node.payload ?? {}, null, 2)}
              </CodeSnippet>

              {mode === "lineage" ? (
                <section className="space-y-2">
                  <h4 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    Lineage
                  </h4>
                  {lineageQuery.isLoading ? (
                    <Skeleton className="h-24 w-full" />
                  ) : null}
                  {lineageQuery.isError ? (
                    <ErrorState
                      message={normalizeApiError(lineageQuery.error).message}
                      status={normalizeApiError(lineageQuery.error).status}
                      endpoint={`/v1/evidence/${node.id}/lineage`}
                      onRetry={() => void lineageQuery.refetch()}
                    />
                  ) : null}
                  {lineageQuery.data ? (
                    <div className="min-w-0 space-y-2 text-[11px]">
                      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 font-mono">
                        <LedgerRow label="Root">
                          {lineageQuery.data.root_node_id}
                        </LedgerRow>
                        <LedgerRow label="Size">
                          {(lineageQuery.data.nodes ?? []).length} nodes ·{" "}
                          {(lineageQuery.data.edges ?? []).length} edges
                        </LedgerRow>
                      </dl>
                      <CodeSnippet title="Lineage JSON" maxHeightClass="max-h-48">
                        {JSON.stringify(lineageQuery.data, null, 2)}
                      </CodeSnippet>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { normalizeApiError } from "@/lib/api/errors";
import type {
  BlastRadiusResponse,
  EvidenceNodeView,
} from "@/lib/api/generated/openapi.types";
import {
  blastReopen,
  invalidateAfterBlastReopen,
} from "@/lib/api/mutations";
import { apiQueries } from "@/lib/api/queries";
import { useUiStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

const ORTC = "BNM_ORTC_2026";

export function affectedNodeIdsFromBlast(
  blast: BlastRadiusResponse | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!blast) return ids;
  for (const n of blast.affected_nodes ?? []) {
    if (typeof n === "string") {
      ids.add(n);
      continue;
    }
    if (n && typeof n === "object") {
      const obj = n as { id?: unknown; node_id?: unknown };
      if (obj.id != null) ids.add(String(obj.id));
      if (obj.node_id != null) ids.add(String(obj.node_id));
    }
  }
  return ids;
}

export function greenNodeIdsFromBlast(
  blast: BlastRadiusResponse | null | undefined,
  nodes: EvidenceNodeView[],
): Set<string> {
  const ids = new Set<string>();
  if (!blast) return ids;
  const featured = blast.featured_green as
    | { course_code?: string; employee_ref?: string }
    | undefined;
  const refs = new Set(
    [featured?.course_code, featured?.employee_ref].filter(Boolean) as string[],
  );
  if (refs.size === 0) return ids;
  for (const n of nodes) {
    if (refs.has(n.external_ref)) ids.add(n.id);
  }
  return ids;
}

type CountMatch = { expected?: number; found?: number; match?: boolean };

function ExpectedVsFoundChip({
  blast,
}: {
  blast: BlastRadiusResponse;
}) {
  const ingestRequired = Boolean(
    (blast as { ingest_required?: boolean }).ingest_required,
  );
  const evs = (blast.expected_vs_found ?? null) as {
    stale_programs?: CountMatch;
    affected_employees?: CountMatch;
    false_positives?: unknown[];
    false_negatives?: unknown[];
    course_false_negatives?: unknown[];
    employee_false_negatives?: unknown[];
    match?: boolean;
  } | null;
  if (!evs && !ingestRequired) return null;
  const stale = evs?.stale_programs;
  const emp = evs?.affected_employees;
  const fp = (evs?.false_positives ?? []).length;
  const courseFn = (evs?.course_false_negatives ?? []).length;
  const empFn = (evs?.employee_false_negatives ?? []).length;
  const fn = (evs?.false_negatives ?? []).length;
  const fnLabel =
    evs?.course_false_negatives || evs?.employee_false_negatives
      ? `FN ${courseFn}c+${empFn}e`
      : `FN ${fn}`;
  const ok = Boolean(evs?.match) && !ingestRequired;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge
        variant={ingestRequired ? "warning" : ok ? "success" : "destructive"}
        className="text-[10px]"
      >
        {ingestRequired
          ? "Ingest circular first"
          : `Expected vs Found ${ok ? "match" : "mismatch"}`}
      </Badge>
      <span className="font-mono text-[10px] text-[var(--muted-foreground)]">
        stale {stale?.found ?? "—"}/{stale?.expected ?? 3} · emp {emp?.found ?? "—"}/
        {emp?.expected ?? 7} · FP {fp} · {fnLabel}
      </span>
    </div>
  );
}

/** Compact floating trigger for framework blast-radius assessment. */
export function BlastRadiusPanel({
  runId,
  onImpact,
  onAffected,
  initialFramework,
  autoAssess = false,
  graphReady = true,
  className,
}: {
  runId: string;
  onImpact?: (response: BlastRadiusResponse | null) => void;
  onAffected?: (nodeIds: string[]) => void;
  initialFramework?: string;
  autoAssess?: boolean;
  /** Wait for Evidence graph fetch — auto-assess before this is a silent miss. */
  graphReady?: boolean;
  className?: string;
}) {
  const qc = useQueryClient();
  const pushMutation = useUiStore((s) => s.pushMutation);
  const popMutation = useUiStore((s) => s.popMutation);

  const cockpit = useQuery(apiQueries.cockpit(runId));
  const frameworks = useMemo(() => {
    const fromCockpit = cockpit.data?.request?.frameworks ?? [];
    return [...new Set([initialFramework, ORTC, ...fromCockpit].filter(Boolean))] as string[];
  }, [cockpit.data?.request?.frameworks, initialFramework]);

  const [framework, setFramework] = useState(initialFramework || ORTC);
  const selectedFramework = framework || frameworks[0] || ORTC;
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const didAuto = useRef(false);

  const blast = useQuery({
    ...apiQueries.blastRadius(runId, selectedFramework),
    enabled: false,
    retry: false,
  });

  const reopen = useMutation({
    mutationFn: () =>
      blastReopen(runId, {
        framework_code: selectedFramework,
        reason: reason.trim() || undefined,
      }),
    onMutate: () => {
      const id = pushMutation("Reopening affected paths…");
      return { id };
    },
    onSuccess: (res) => {
      if (!res.langgraph_interrupt_rearmed) {
        toast.error(
          "Reopen returned without langgraph_interrupt_rearmed=true — HITL gate may not be armed.",
        );
      } else {
        toast.success(
          `Rearmed interrupt. Status: ${res.status}. Walk department gates from Compliance — Management COMMIT stays locked.`,
        );
      }
      invalidateAfterBlastReopen(qc, runId);
      setConfirmOpen(false);
    },
    onError: (err) => toast.error(normalizeApiError(err).message),
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx?.id) popMutation(ctx.id);
    },
  });

  async function assess(opts?: { silent?: boolean }) {
    if (!selectedFramework) return;
    const result = await blast.refetch();
    if (result.data) {
      onImpact?.(result.data);
      const ids = [...affectedNodeIdsFromBlast(result.data)];
      onAffected?.(ids);
      if (!opts?.silent) {
        toast.message("Framework impact assessed (audit event written by GET).");
      }
    } else if (result.error) {
      onImpact?.(null);
      onAffected?.([]);
      toast.error(normalizeApiError(result.error).message);
    }
  }

  useEffect(() => {
    if (!autoAssess || !selectedFramework || !graphReady) return;
    if (didAuto.current) return;
    didAuto.current = true;
    void (async () => {
      const result = await blast.refetch();
      if (result.data) {
        onImpact?.(result.data);
        onAffected?.([...affectedNodeIdsFromBlast(result.data)]);
        return;
      }
      didAuto.current = false;
      if (result.error) {
        toast.error(normalizeApiError(result.error).message);
      }
    })();
    // One-shot from ?blast=1 after the graph is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAssess, selectedFramework, graphReady]);

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Framework impact
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted-foreground)]">
          Circular-scoped blast — not a document diff. GET writes an audit event.
          Auto-assess only when URL has blast=1.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={selectedFramework}
          onValueChange={setFramework}
          disabled={frameworks.length === 0}
        >
          <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
            <SelectValue placeholder="Framework" />
          </SelectTrigger>
          <SelectContent>
            {frameworks.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 gap-1 bg-[var(--foreground)] px-2.5 text-xs text-white hover:bg-black hover:text-white"
          disabled={!selectedFramework || blast.isFetching}
          onClick={() => void assess()}
        >
          {blast.isFetching ? "…" : "Assess"}
        </Button>
      </div>

      {blast.data ? (
        <div className="space-y-2 border-t border-[var(--border)] pt-3 text-[11px]">
          <ExpectedVsFoundChip blast={blast.data} />
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="warning" className="text-[10px]">
              {(blast.data.affected_courses ?? []).length} stale
            </Badge>
            <Badge variant="warning" className="text-[10px]">
              {(blast.data.affected_employees ?? []).length} staff
            </Badge>
            <span className="text-[var(--muted-foreground)]">
              {(blast.data.affected_nodes ?? []).length} nodes
            </span>
          </div>
          {!confirmOpen ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => setConfirmOpen(true)}
            >
              Reopen paths
            </Button>
          ) : (
            <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
              <Label htmlFor="reopen-reason" className="text-[10px]">
                Reason
              </Label>
              <Textarea
                id="reopen-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="min-h-0 text-xs"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={reopen.isPending || reason.trim().length < 3}
                  onClick={() => reopen.mutate()}
                >
                  Confirm
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  onClick={() => setConfirmOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {reopen.data ? (
            <div className="space-y-1">
              <Badge
                variant={
                  reopen.data.langgraph_interrupt_rearmed
                    ? "success"
                    : "destructive"
                }
                className="text-[10px]"
              >
                rearmed: {String(reopen.data.langgraph_interrupt_rearmed)}
              </Badge>
              {reopen.data.langgraph_interrupt_rearmed &&
              reopen.data.status === "awaiting_approval" ? (
                <p className="text-[var(--success)]">
                  <Link href={`/runs/${runId}/review/compliance`} className="underline">
                    Walk review gates from Compliance
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

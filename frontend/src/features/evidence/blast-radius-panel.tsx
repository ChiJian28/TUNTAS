"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
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
import type { BlastRadiusResponse } from "@/lib/api/generated/openapi.types";
import {
  blastReopen,
  invalidateAfterBlastReopen,
} from "@/lib/api/mutations";
import { apiQueries } from "@/lib/api/queries";
import { useUiStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

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

/** Compact floating trigger for framework blast-radius assessment. */
export function BlastRadiusPanel({
  runId,
  onImpact,
  onAffected,
  className,
}: {
  runId: string;
  onImpact?: (response: BlastRadiusResponse | null) => void;
  onAffected?: (nodeIds: string[]) => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const pushMutation = useUiStore((s) => s.pushMutation);
  const popMutation = useUiStore((s) => s.popMutation);

  const cockpit = useQuery(apiQueries.cockpit(runId));
  const frameworks = cockpit.data?.request?.frameworks ?? [];

  const [framework, setFramework] = useState("");
  const selectedFramework = framework || frameworks[0] || "";
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

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
          `Rearmed interrupt. Status: ${res.status}. Proceed to Plan for /resume.`,
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

  async function assess() {
    if (!selectedFramework) return;
    const result = await blast.refetch();
    if (result.data) {
      onImpact?.(result.data);
      const ids = [...affectedNodeIdsFromBlast(result.data)];
      onAffected?.(ids);
      toast.message("Framework impact assessed (audit event written by GET).");
    } else if (result.error) {
      onImpact?.(null);
      onAffected?.([]);
      toast.error(normalizeApiError(result.error).message);
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Framework impact
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted-foreground)]">
          Blast radius only — not a document diff. GET writes an audit event.
        </p>
      </div>

      {frameworks.length === 0 ? (
        <p className="text-[11px] text-[var(--muted-foreground)]">
          No frameworks on cockpit.request.
        </p>
      ) : (
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
      )}

      {blast.data ? (
        <div className="space-y-2 border-t border-[var(--border)] pt-3 text-[11px]">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="warning" className="text-[10px]">
              {(blast.data.affected_nodes ?? []).length} nodes
            </Badge>
            <span className="text-[var(--muted-foreground)]">
              Emp {(blast.data.affected_employees ?? []).length} · Courses{" "}
              {(blast.data.affected_courses ?? []).length}
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
                  <Link href={`/runs/${runId}/plan`} className="underline">
                    Open Plan for /resume
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

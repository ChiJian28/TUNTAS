"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/ui/error-state";
import {
  decideGate,
  invalidateAfterGateDecision,
} from "@/lib/api/mutations";
import { extractCriticalFlags, normalizeApiError, TuntasApiError } from "@/lib/api/errors";
import { apiQueries } from "@/lib/api/queries";
import type { ReviewGateView } from "@/lib/api/generated/openapi.types";
import { reviewHref } from "@/lib/constants/gates";
import { newIdempotencyKey } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

const STAGES = [
  { value: "parallel_intake", label: "Parallel intake (Diagnostic / Policy / Vendor)" },
  { value: "learning_architect", label: "Learning Architect" },
  { value: "challenger", label: "Challenger" },
  { value: "optimizer", label: "Optimizer" },
  { value: "secretariat", label: "Secretariat" },
] as const;

type Props = {
  runId: string;
  gate: ReviewGateView;
};

export function GateDecisionCard({ runId, gate }: Props) {
  const qc = useQueryClient();
  const router = useRouter();
  const me = useQuery(apiQueries.me);
  const pushMutation = useUiStore((s) => s.pushMutation);
  const popMutation = useUiStore((s) => s.popMutation);

  const [decision, setDecision] = useState<"approve" | "reject" | "revise">(
    "approve",
  );
  const [rationale, setRationale] = useState("");
  const [returnToStage, setReturnToStage] = useState(gate.revise_stage ?? "");
  const [submitError, setSubmitError] = useState<TuntasApiError | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      return decideGate(
        runId,
        gate.gate_key,
        {
          decision,
          rationale: rationale.trim(),
          return_to_stage:
            decision === "revise" && returnToStage
              ? (returnToStage as (typeof STAGES)[number]["value"])
              : null,
        },
        newIdempotencyKey(),
      );
    },
    onMutate: () => {
      setSubmitError(null);
      const id = pushMutation(
        decision === "approve"
          ? `Approving ${gate.label}…`
          : decision === "revise"
            ? `Revising ${gate.label}…`
            : `Rejecting ${gate.label}…`,
      );
      return { id };
    },
    onSuccess: (res) => {
      toast.success(res.message || `${gate.label}: ${res.decision}`);
      invalidateAfterGateDecision(qc, runId);
      const next = res.current_gate;
      if (next && next !== gate.gate_key) {
        router.push(reviewHref(runId, next));
      }
    },
    onError: (err) => {
      const e = normalizeApiError(err);
      setSubmitError(e);
      toast.error(e.message);
    },
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx?.id) popMutation(ctx.id);
    },
  });

  if (gate.commits) {
    return null;
  }

  const actor = me.data?.subject ?? "—";
  const role = me.data?.role ?? "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-xl">
          {gate.label} gate
        </CardTitle>
        <CardDescription>{gate.prompt}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant={gate.status === "approved" ? "success" : gate.status === "rejected" ? "destructive" : "muted"}>
            {gate.status}
          </Badge>
          {gate.skipped ? <Badge variant="muted">Skipped on circular path</Badge> : null}
          {gate.decision ? (
            <Badge variant="muted">Last: {gate.decision}</Badge>
          ) : null}
        </div>

        {!gate.can_decide ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            {gate.blocked_by === "commits_via_post_decision"
              ? "This gate commits via Management /decision."
              : gate.blocked_by === "skipped_on_circular_path"
                ? "Not on the Scenario B path. Capability runs still require this gate."
                : gate.blocked_by?.startsWith("prior_gates")
                  ? `Waiting on prior gates: ${gate.missing_priors.join(", ") || "—"}.`
                  : gate.blocked_by?.startsWith("waiting_for")
                    ? `Not current. Walk the chain in order. Current: ${gate.blocked_by.replace("waiting_for:", "")}.`
                    : gate.blocked_by === "insufficient_role"
                      ? `Role ${role} cannot decide this gate.`
                      : gate.blocked_by === "already_approved"
                        ? "Already approved. Later revise can reset from this stage."
                        : `Gate inactive (${gate.blocked_by ?? "not ready"}). Delivery stays locked.`
            }
          </p>
        ) : null}

        {gate.rationale ? (
          <blockquote className="border-l-2 border-[var(--border-strong)] pl-3 text-sm">
            “{gate.rationale}”
            {gate.actor_id ? (
              <footer className="mt-1 font-mono text-[11px] text-[var(--muted-foreground)]">
                {gate.actor_id} ({gate.actor_role})
              </footer>
            ) : null}
          </blockquote>
        ) : null}

        <div className="space-y-2">
          <Label>Decision</Label>
          <div className="flex flex-wrap gap-2">
            {(["approve", "reject", "revise"] as const).map((d) => (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={decision === d ? "default" : "outline"}
                onClick={() => setDecision(d)}
                disabled={mutation.isPending || !gate.can_decide}
              >
                {d}
              </Button>
            ))}
          </div>
        </div>

        {decision === "revise" ? (
          <div className="space-y-2">
            <Label>Return to stage</Label>
            <Select value={returnToStage} onValueChange={setReturnToStage}>
              <SelectTrigger>
                <SelectValue placeholder="Select stage" />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor={`rationale-${gate.gate_key}`}>Rationale (min 8 chars)</Label>
          <Textarea
            id={`rationale-${gate.gate_key}`}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={3}
            disabled={mutation.isPending || !gate.can_decide}
          />
        </div>

        <p className="text-xs text-[var(--muted-foreground)]">
          Actor:{" "}
          <span className="font-mono">
            {actor} ({role})
          </span>
          . This does not schedule sessions or write artifacts.
        </p>

        <Button
          type="button"
          disabled={
            mutation.isPending ||
            !gate.can_decide ||
            rationale.trim().length < 8 ||
            (decision === "revise" && !returnToStage)
          }
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Submitting…" : `Submit ${decision}`}
        </Button>

        {submitError ? (
          <ErrorState
            message={submitError.message}
            status={submitError.status}
            endpoint={`/v1/runs/${runId}/gates/${gate.gate_key}`}
          />
        ) : null}

        {submitError && extractCriticalFlags(submitError).length > 0 ? (
          <pre className="overflow-x-auto rounded-lg bg-[var(--destructive-soft)] p-3 font-mono text-xs">
            {JSON.stringify(extractCriticalFlags(submitError), null, 2)}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}

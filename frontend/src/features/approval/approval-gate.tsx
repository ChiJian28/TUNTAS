"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
  decide,
  resumeDecision,
  invalidateAfterDecision,
} from "@/lib/api/mutations";
import { extractCriticalFlags, normalizeApiError, TuntasApiError } from "@/lib/api/errors";
import { apiQueries } from "@/lib/api/queries";
import { OPTION_LABELS } from "@/lib/constants/agents";
import { newIdempotencyKey } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

const DEMO_CONDITION =
  "Employee data must not be uploaded outside Malaysia.";

type Mode = "decision" | "resume";

export function ApprovalGate({
  runId,
  mode = "decision",
}: {
  runId: string;
  mode?: Mode;
}) {
  const qc = useQueryClient();
  const selectedOptionKey = useUiStore((s) => s.selectedOptionKey);
  const pushMutation = useUiStore((s) => s.pushMutation);
  const popMutation = useUiStore((s) => s.popMutation);

  const me = useQuery(apiQueries.me);
  const cockpit = useQuery(apiQueries.cockpit(runId));
  const options = useQuery(apiQueries.options(runId));

  const [decision, setDecision] = useState<"approve" | "reject" | "revise">(
    "approve",
  );
  const [rationale, setRationale] = useState("");
  const [conditions, setConditions] = useState<string[]>([]);
  const [conditionDraft, setConditionDraft] = useState("");
  const [returnToStage, setReturnToStage] = useState<
    "learning_architect" | "challenger" | "optimizer" | "secretariat" | ""
  >("");

  const optionKey = selectedOptionKey;
  const selected = useMemo(
    () =>
      (options.data ?? cockpit.data?.options ?? []).find(
        (o) => o.option_key === optionKey,
      ),
    [options.data, cockpit.data?.options, optionKey],
  );

  const canApprove =
    !!optionKey &&
    selected?.hard_constraint_ok !== false &&
    rationale.trim().length >= 8;

  const [submitError, setSubmitError] = useState<TuntasApiError | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!optionKey) {
        throw new TuntasApiError({
          message: "Select a portfolio option before deciding",
          status: 400,
          detail: "option_key required",
        });
      }
      const body = {
        option_key: optionKey,
        decision,
        rationale: rationale.trim(),
        conditions,
        acting_manager_id: me.data?.subject ?? null,
        return_to_stage:
          decision === "revise" && returnToStage ? returnToStage : null,
        expected_portfolio_version:
          cockpit.data?.portfolio_version ??
          cockpit.data?.request?.portfolio_version ??
          null,
      };
      const key = newIdempotencyKey();
      if (mode === "resume") return resumeDecision(runId, body, key);
      return decide(runId, body, key);
    },
    onMutate: () => {
      setSubmitError(null);
      const id = pushMutation(
        decision === "approve"
          ? "Committing approval…"
          : decision === "revise"
            ? "Submitting revise…"
            : "Rejecting…",
      );
      return { id };
    },
    onSuccess: (res) => {
      toast.success(res.message || `Decision: ${res.status}`);
      invalidateAfterDecision(qc, runId);
    },
    onError: (err) => {
      const e = normalizeApiError(err);
      setSubmitError(e);
      const flags = extractCriticalFlags(e);
      if (e.status === 409) {
        toast.error(`Stale gate / already decided — ${e.message}`);
      } else if (e.status === 400 && flags.length) {
        toast.error(`Critical veto: ${e.message}`);
      } else {
        toast.error(e.message);
      }
    },
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx?.id) popMutation(ctx.id);
    },
  });

  function addCondition(text: string) {
    const t = text.trim();
    if (!t) return;
    setConditions((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setConditionDraft("");
  }

  if (cockpit.isError) {
    const err = cockpit.error as TuntasApiError;
    return <ErrorState message={err.message} status={err.status} />;
  }

  const status = cockpit.data?.run.status;
  const awaiting =
    status === "awaiting_approval" || cockpit.data?.run.awaiting_approval;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-xl">
          {mode === "resume" ? "Re-approval gate" : "Management approval"}
        </CardTitle>
        <CardDescription>
          AI recommends; algorithms prove feasibility; humans decide. Schedule and
          artifacts stay locked until this mutation succeeds.
          {mode === "resume"
            ? " Using POST /resume after policy reopen."
            : " Using POST /decision for the initial gate."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!awaiting && status !== "needs_policy_recompile" ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            Gate inactive for status <span className="font-mono">{status ?? "—"}</span>.
            Delivery remains locked until a successful approval response.
          </p>
        ) : null}

        <div className="space-y-1 text-sm">
          <p className="text-xs text-[var(--muted-foreground)]">Selected option</p>
          <p className="font-medium text-[var(--foreground)]">
            {optionKey
              ? (OPTION_LABELS[optionKey] ?? optionKey)
              : "None — select from portfolio cards (?option=)"}
          </p>
          {selected?.hard_constraint_ok === false ? (
            <Badge variant="destructive">Hard constraints failed — cannot approve</Badge>
          ) : null}
        </div>

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
                disabled={mutation.isPending}
              >
                {d}
              </Button>
            ))}
          </div>
        </div>

        {decision === "revise" ? (
          <div className="space-y-2">
            <Label>Return to stage</Label>
            <Select
              value={returnToStage}
              onValueChange={(v) =>
                setReturnToStage(v as typeof returnToStage)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select stage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="learning_architect">Learning Architect</SelectItem>
                <SelectItem value="challenger">Challenger</SelectItem>
                <SelectItem value="optimizer">Optimizer</SelectItem>
                <SelectItem value="secretariat">Secretariat</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="rationale">Rationale (min 8 chars)</Label>
          <Textarea
            id="rationale"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={3}
            disabled={mutation.isPending}
          />
        </div>

        <div className="space-y-2">
          <Label>Conditions</Label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => addCondition(DEMO_CONDITION)}
              disabled={mutation.isPending}
            >
              Employee data must not be uploaded outside Malaysia.
            </Button>
          </div>
          <div className="flex gap-2">
            <Textarea
              value={conditionDraft}
              onChange={(e) => setConditionDraft(e.target.value)}
              rows={2}
              placeholder="Additional condition"
              disabled={mutation.isPending}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => addCondition(conditionDraft)}
              disabled={mutation.isPending}
            >
              Add
            </Button>
          </div>
          <ul className="space-y-1 text-sm">
            {conditions.map((c) => (
              <li
                key={c}
                className="flex items-start justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1"
              >
                <span>{c}</span>
                <button
                  type="button"
                  className="text-xs text-[var(--link)] underline"
                  onClick={() =>
                    setConditions((prev) => prev.filter((x) => x !== c))
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-[var(--muted-foreground)]">
          Actor:{" "}
          <span className="font-mono">
            {me.data?.subject ?? "—"} ({me.data?.role ?? "—"})
          </span>
        </p>

        <Button
          type="button"
          disabled={
            mutation.isPending ||
            !optionKey ||
            rationale.trim().length < 8 ||
            (decision === "approve" && !canApprove) ||
            (decision === "revise" && !returnToStage)
          }
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Submitting…" : `Submit ${decision}`}
        </Button>

        {submitError ? (
          <ErrorState
            message={
              submitError.status === 409
                ? `Conflict — stale gate / already decided. ${submitError.message}`
                : submitError.message
            }
            status={submitError.status}
            endpoint={
              mode === "resume"
                ? `/v1/runs/${runId}/resume`
                : `/v1/runs/${runId}/decision`
            }
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

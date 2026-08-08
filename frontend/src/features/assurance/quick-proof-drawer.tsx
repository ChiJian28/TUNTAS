"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { JsonViewer } from "@/features/agents/json-viewer";
import {
  invalidateAfterSimProof,
  quickProof,
} from "@/lib/api/mutations";
import type {
  EmployeeListItem,
  ScenarioView,
  SimulationAttemptResponse,
} from "@/lib/api/generated/openapi.types";
import { TuntasApiError } from "@/lib/api/errors";
import {
  safeParsePayload,
  scenarioRubricItemSchema,
  simulationFeedbackSchema,
} from "@/lib/schemas/payloads";
import { formatRatioPercent } from "@/lib/format/score";

type Props = {
  runId: string;
  scenarios: ScenarioView[];
  employees: EmployeeListItem[];
};

export function QuickProofDrawer({ runId, scenarios, employees }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id ?? "");
  const [employeeRef, setEmployeeRef] = useState(
    employees[0]?.employee_ref ?? "",
  );
  const [actionsText, setActionsText] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<SimulationAttemptResponse | null>(null);

  const scenario = useMemo(
    () => scenarios.find((s) => s.id === scenarioId) ?? null,
    [scenarios, scenarioId],
  );

  const criteria = useMemo(() => {
    if (!scenario?.rubric?.length) return [];
    return scenario.rubric
      .map((item) => safeParsePayload(scenarioRubricItemSchema, item))
      .filter((r) => r.ok)
      .map((r) => (r.ok ? r.data.criterion : undefined))
      .filter((c): c is string => Boolean(c));
  }, [scenario]);

  const mutation = useMutation({
    mutationFn: async () => {
      const actions = actionsText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const responses: Record<string, unknown> = {
        actions,
        notes,
      };
      return quickProof(scenarioId, {
        employee_ref: employeeRef,
        responses,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      invalidateAfterSimProof(qc, runId);
      if (data.assurance_error) {
        toast.warning("Partial success — attempt scored, assurance refresh failed", {
          description: data.assurance_error,
        });
      } else {
        toast.success("Quick Proof submitted");
      }
    },
    onError: (err) => {
      const message =
        err instanceof TuntasApiError ? err.message : "Quick Proof failed";
      toast.error(message);
    },
  });

  const feedback = result
    ? safeParsePayload(simulationFeedbackSchema, result.feedback)
    : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Quick Proof (analyst)
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Quick Proof</DialogTitle>
          <DialogDescription>
            Analyst-only structured attempt. Does not replace the adaptive
            multi-turn theatre. Score comes from deterministic rubric only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Scenario</Label>
            <Select value={scenarioId} onValueChange={setScenarioId}>
              <SelectTrigger>
                <SelectValue placeholder="Select scenario" />
              </SelectTrigger>
              <SelectContent>
                {scenarios.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.code} — {s.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Employee ref</Label>
            {employees.length > 0 ? (
              <Select value={employeeRef} onValueChange={setEmployeeRef}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.employee_ref} value={e.employee_ref}>
                      {e.pseudonym || e.employee_ref}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={employeeRef}
                onChange={(e) => setEmployeeRef(e.target.value)}
                placeholder="EMP-…"
              />
            )}
          </div>

          {criteria.length > 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">
                Rubric criteria (answers not shown)
              </p>
              <ul className="list-inside list-disc text-sm text-[var(--body)]">
                {criteria.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="qp-actions">
              Actions (one per line — behavioural signals)
            </Label>
            <Textarea
              id="qp-actions"
              rows={5}
              value={actionsText}
              onChange={(e) => setActionsText(e.target.value)}
              placeholder={"escalate to AML\ndocument STR rationale\nverify customer identity"}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qp-notes">Notes</Label>
            <Textarea
              id="qp-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Free-text rationale included in scoring blob"
            />
          </div>

          {result ? (
            <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    result.assurance_error ? "warning" : "success"
                  }
                >
                  {result.assurance_error ? "Partial success" : "Scored"}
                </Badge>
                <Badge variant="evidence">
                  Level {result.level_awarded}
                </Badge>
                <span className="text-sm tabular-nums text-[var(--foreground)]">
                  Score {formatRatioPercent(result.score).text}
                </span>
              </div>
              <dl className="space-y-1 text-xs font-mono text-[var(--body)]">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-[var(--muted-foreground)]">attempt_id</dt>
                  <dd className="break-all">{result.attempt_id}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-[var(--muted-foreground)]">
                    evidence_hash
                  </dt>
                  <dd className="break-all">{result.evidence_hash}</dd>
                </div>
              </dl>
              {result.assurance_error ? (
                <p className="text-sm text-[var(--warning)]">
                  Assurance error (HTTP 200 partial): {result.assurance_error}
                </p>
              ) : null}
              {feedback?.ok && feedback.data.text ? (
                <p className="text-sm text-[var(--body)]">{feedback.data.text}</p>
              ) : (
                <JsonViewer data={result.feedback} variant="code" />
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            disabled={
              mutation.isPending || !scenarioId || !employeeRef.trim()
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Submitting…" : "Submit structured attempt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

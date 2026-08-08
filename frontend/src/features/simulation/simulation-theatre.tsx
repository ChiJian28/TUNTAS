"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionBar } from "@/features/simulation/action-bar";
import { CaseBrief } from "@/features/simulation/case-brief";
import { EvidenceObservation } from "@/features/simulation/evidence-observation";
import { NarrativeTimeline } from "@/features/simulation/narrative-timeline";
import {
  deriveCanFinalize,
  deriveObservedSignals,
  difficultyTintClass,
  extractSignalCatalog,
  latestChoices,
  parseTurn,
  parseTurns,
  pressureFromDifficulty,
  scenarioTheme,
  sceneProgress,
  type ParsedTurn,
} from "@/features/simulation/turn-utils";
import { ScenePressure } from "@/features/simulation/scene-pressure";
import { apiQueries } from "@/lib/api/queries";
import {
  abandonSim,
  finalizeSim,
  invalidateAfterSimProof,
  simTurn,
  startSimSession,
} from "@/lib/api/mutations";
import { TuntasApiError } from "@/lib/api/errors";
import type { SimulationAttemptResponse } from "@/lib/api/generated/openapi.types";
import {
  safeParsePayload,
  simulationFeedbackSchema,
} from "@/lib/schemas/payloads";
import { formatRatioPercent } from "@/lib/format/score";
import { useUiStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

type Props = {
  runId: string;
  scenarioId: string;
};

export function SimulationTheatre({ runId, scenarioId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const employeeRef = searchParams.get("employee")?.trim() ?? "";
  const resumeSessionId = searchParams.get("session")?.trim() ?? "";

  const qc = useQueryClient();
  const pushMutation = useUiStore((s) => s.pushMutation);
  const popMutation = useUiStore((s) => s.popMutation);

  const scenariosQ = useQuery(apiQueries.scenarios(runId));
  const employeesQ = useQuery({
    ...apiQueries.employees(runId),
    enabled: Boolean(employeeRef),
  });
  const resumeQ = useQuery({
    ...apiQueries.simSession(resumeSessionId),
    enabled: Boolean(resumeSessionId),
  });

  const [sessionId, setSessionId] = useState<string | null>(
    resumeSessionId || null,
  );
  const [status, setStatus] = useState<string>("idle");
  const [difficulty, setDifficulty] = useState("standard");
  const [turns, setTurns] = useState<ParsedTurn[]>([]);
  const [canFinalize, setCanFinalize] = useState(false);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const [finalResult, setFinalResult] = useState<SimulationAttemptResponse | null>(
    null,
  );
  const [startedOnce, setStartedOnce] = useState(false);

  const scenario = useMemo(() => {
    const list = scenariosQ.data ?? [];
    return (
      list.find((s) => s.id === scenarioId) ??
      list.find((s) => s.code === scenarioId) ??
      null
    );
  }, [scenariosQ.data, scenarioId]);

  /** Canonical UUID for API calls — route may use SCN-* code. */
  const resolvedScenarioId = scenario?.id ?? null;

  // Canonicalize SCN-* (or any code) URLs to UUID once scenarios load.
  useEffect(() => {
    if (!scenario) return;
    if (scenario.id === scenarioId) return;
    if (scenario.code !== scenarioId) return;
    const params = new URLSearchParams(searchParams.toString());
    const qs = params.toString();
    router.replace(
      `/runs/${runId}/simulate/${scenario.id}${qs ? `?${qs}` : ""}`,
    );
  }, [scenario, scenarioId, runId, router, searchParams]);

  const employeeLabel = useMemo(() => {
    const emp = employeesQ.data?.find((e) => e.employee_ref === employeeRef);
    return emp?.pseudonym ?? employeeRef;
  }, [employeesQ.data, employeeRef]);

  const signalCatalog = useMemo(
    () => extractSignalCatalog(scenario?.rubric),
    [scenario?.rubric],
  );

  const observed = useMemo(
    () => deriveObservedSignals(turns, signalCatalog),
    [turns, signalCatalog],
  );

  const chips = latestChoices(turns);
  const theme = scenarioTheme(scenario?.code);
  const pressure = pressureFromDifficulty(difficulty);
  const progress = sceneProgress(turns, canFinalize);

  // Restore from GET /sessions/{id}
  useEffect(() => {
    if (!resumeQ.data) return;
    const sess = resumeQ.data;
    if (resolvedScenarioId && sess.scenario_id !== resolvedScenarioId) {
      toast.error("Resume session does not match this scenario");
      return;
    }
    if (employeeRef && sess.employee_ref !== employeeRef) {
      toast.warning("Employee query differs from session employee_ref");
    }
    const parsed = parseTurns(sess.turns);
    setSessionId(sess.session_id);
    setStatus(sess.status);
    setDifficulty(sess.difficulty || "standard");
    setTurns(parsed);
    setCanFinalize(deriveCanFinalize(sess.status, parsed));
    setStartedOnce(true);
  }, [resumeQ.data, resolvedScenarioId, employeeRef]);

  const startMut = useMutation({
    mutationFn: () => {
      if (!resolvedScenarioId) throw new Error("Scenario not resolved");
      return startSimSession(resolvedScenarioId, employeeRef);
    },
    onMutate: () => {
      const id = pushMutation("Starting simulation session");
      return { id };
    },
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx?.id) popMutation(ctx.id);
    },
    onSuccess: (data) => {
      const turn0 = parseTurn(data.turn, 0);
      setSessionId(data.session_id);
      setStatus(data.status);
      setDifficulty(data.difficulty || "standard");
      setTurns([turn0]);
      setCanFinalize(false);
      setFinalResult(null);
      setStartedOnce(true);
      const idForUrl = resolvedScenarioId ?? scenarioId;
      const url = `/runs/${runId}/simulate/${idForUrl}?employee=${encodeURIComponent(employeeRef)}&session=${encodeURIComponent(data.session_id)}`;
      router.replace(url);
      toast.success("Session started");
    },
    onError: (err) => {
      toast.error(
        err instanceof TuntasApiError ? err.message : "Failed to start session",
      );
    },
  });

  const turnMut = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error("No session");
      const learner_action =
        rationale.trim() ||
        selectedAction ||
        "No action provided";
      return simTurn(sessionId, {
        learner_action,
        actions: selectedAction ? [selectedAction] : undefined,
      });
    },
    onMutate: () => {
      const id = pushMutation("Submitting simulation turn");
      return { id };
    },
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx?.id) popMutation(ctx.id);
    },
    onSuccess: (data) => {
      const learner = parseTurn(data.learner_turn, turns.length);
      const npc = parseTurn(data.turn, turns.length + 1);
      setTurns((prev) => [...prev, learner, npc]);
      setStatus(data.status);
      setDifficulty(data.difficulty || difficulty);
      setCanFinalize(Boolean(data.can_finalize));
      setRationale("");
      setSelectedAction(null);
    },
    onError: (err) => {
      toast.error(
        err instanceof TuntasApiError
          ? `${err.message} — same action may not be idempotent; retry carefully.`
          : "Turn failed",
      );
    },
  });

  const finalizeMut = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error("No session");
      return finalizeSim(sessionId);
    },
    onMutate: () => {
      const id = pushMutation("Finalizing simulation");
      return { id };
    },
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx?.id) popMutation(ctx.id);
    },
    onSuccess: (data) => {
      setFinalResult(data);
      setStatus(data.status ?? "completed");
      setCanFinalize(false);
      invalidateAfterSimProof(qc, runId);
      if (data.assurance_error) {
        toast.warning("Partial success — scored but assurance refresh failed", {
          description: data.assurance_error,
        });
      } else {
        toast.success("Deterministic score ready");
      }
    },
    onError: (err) => {
      toast.error(
        err instanceof TuntasApiError ? err.message : "Finalize failed",
      );
    },
  });

  const abandonMut = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error("No session");
      return abandonSim(sessionId);
    },
    onSuccess: (data) => {
      setStatus(data.status);
      setCanFinalize(false);
      toast.message("Session abandoned");
    },
    onError: (err) => {
      toast.error(
        err instanceof TuntasApiError ? err.message : "Abandon failed",
      );
    },
  });

  const sessionActive = status === "in_progress";
  const busy =
    startMut.isPending ||
    turnMut.isPending ||
    finalizeMut.isPending ||
    abandonMut.isPending;

  if (!employeeRef && !resumeSessionId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
        <ErrorState
          message="Employee query param is required to start a simulation (?employee=EMP-…)."
          endpoint={`/runs/${runId}/simulate/${scenarioId}`}
        />
      </div>
    );
  }

  if (scenariosQ.isLoading || (resumeSessionId && resumeQ.isLoading)) {
    return (
      <div className="min-h-screen space-y-4 bg-[var(--background)] p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-[70vh] w-full" />
      </div>
    );
  }

  if (scenariosQ.error || resumeQ.error) {
    const err =
      (scenariosQ.error instanceof TuntasApiError && scenariosQ.error) ||
      (resumeQ.error instanceof TuntasApiError && resumeQ.error) ||
      null;
    return (
      <div className="min-h-screen bg-[var(--background)] p-6">
        <ErrorState
          message={err?.message ?? "Failed to load simulation"}
          status={err?.status}
          endpoint={err?.endpoint}
          onRetry={() => {
            void scenariosQ.refetch();
            if (resumeSessionId) void resumeQ.refetch();
          }}
        />
      </div>
    );
  }

  if (!scenario || !resolvedScenarioId) {
    const codes = (scenariosQ.data ?? []).map((s) => s.code).filter(Boolean);
    return (
      <div className="min-h-screen bg-[var(--background)] p-6">
        <ErrorState
          message={`Scenario not found for “${scenarioId}”. Use a scenario UUID or code from this run.`}
          endpoint={`GET /v1/runs/${runId}/scenarios`}
          onRetry={() => void scenariosQ.refetch()}
        />
        {codes.length ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            Available codes:{" "}
            <span className="font-mono">{codes.join(", ")}</span>
          </p>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            No scenarios returned for this run yet.
          </p>
        )}
        <div className="mt-4">
          <Button asChild variant="outline">
            <Link href={`/runs/${runId}/assurance`}>Back to Assurance</Link>
          </Button>
        </div>
      </div>
    );
  }

  const feedback = finalResult
    ? safeParsePayload(simulationFeedbackSchema, finalResult.feedback)
    : null;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden transition-colors",
        difficultyTintClass(difficulty),
      )}
    >
      <div
        className={cn("h-1 w-full bg-gradient-to-r", theme.accentBar)}
        aria-hidden
      />
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)]/90 px-4 py-3 backdrop-blur">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Adaptive Simulation Theatre
            </p>
            <Badge className={cn("border text-[10px] font-medium", theme.chip)}>
              {theme.label}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl text-[var(--foreground)]">
              {scenario?.title ?? "Simulation"}
            </h1>
            <Badge variant="muted">{employeeLabel}</Badge>
            {sessionId ? (
              <Badge variant="evidence" className="font-mono text-[10px]">
                {sessionId.slice(0, 8)}…
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScenePressure pressure={pressure} difficulty={difficulty} />
          {!startedOnce && employeeRef ? (
            <Button
              size="sm"
              disabled={startMut.isPending}
              onClick={() => startMut.mutate()}
            >
              {startMut.isPending ? "Starting…" : "Start session"}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" asChild>
            <Link href={`/runs/${runId}/assurance`}>Exit to assurance</Link>
          </Button>
        </div>
      </header>

      {/* Split-screen: left dossier · right decision — independent scroll */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section
          aria-label="Case dossier"
          className="flex min-h-0 max-h-[46vh] flex-col border-b border-[var(--border)] bg-[var(--surface)]/40 lg:max-h-none lg:w-[56%] lg:border-b-0 lg:border-r"
        >
          <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
              Case dossier
            </p>
            <CaseBrief
              scenario={scenario}
              difficulty={difficulty}
              employeeRef={employeeRef || resumeQ.data?.employee_ref || ""}
              employeeLabel={employeeLabel}
              compact
            />
          </div>

          <div className="min-h-0 flex-1 overflow-hidden px-4 py-3">
            <NarrativeTimeline
              turns={turns}
              typing={turnMut.isPending}
              theme={theme}
              progressLabel={progress.label}
              beat={progress.beat}
              totalHint={progress.totalHint}
            />
          </div>

          <div className="shrink-0 border-t border-[var(--border)] px-4 py-3">
            <EvidenceObservation
              observed={observed}
              catalogSize={signalCatalog.length}
              compact
            />
          </div>
        </section>

        <section
          aria-label="Decision panel"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--background)]/40 lg:w-[44%]"
        >
          <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 md:p-5">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                Decision panel
              </p>
              <p className="mt-1 text-sm text-[var(--body)]">
                Keep the dossier in view on the left. Choose one action, add
                rationale if needed, then submit.
              </p>
            </div>

            {finalResult ? (
              <div className="space-y-2 rounded-2xl border border-[var(--success)]/30 bg-[var(--success-soft)] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="success">
                    Score from finalize (deterministic)
                  </Badge>
                  {finalResult.assurance_error ? (
                    <Badge variant="warning">Partial success</Badge>
                  ) : null}
                </div>
                <p className="font-display text-2xl text-[var(--foreground)]">
                  Level {finalResult.level_awarded} ·{" "}
                  {formatRatioPercent(finalResult.score).text}
                </p>
                <dl className="space-y-1 text-xs font-mono">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-[var(--muted-foreground)]">
                      attempt_id
                    </dt>
                    <dd className="break-all">{finalResult.attempt_id}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-[var(--muted-foreground)]">
                      evidence_hash
                    </dt>
                    <dd className="break-all">{finalResult.evidence_hash}</dd>
                  </div>
                </dl>
                {finalResult.assurance_error ? (
                  <p className="text-sm text-[var(--warning)]">
                    {finalResult.assurance_error}
                  </p>
                ) : null}
                {feedback?.ok && feedback.data.text ? (
                  <p className="text-sm text-[var(--body)]">
                    {feedback.data.text}
                  </p>
                ) : null}
              </div>
            ) : null}

            <ActionBar
              options={chips}
              selectedAction={selectedAction}
              onSelectAction={setSelectedAction}
              rationale={rationale}
              onRationaleChange={setRationale}
              onSubmit={() => turnMut.mutate()}
              onFinalize={() => finalizeMut.mutate()}
              onAbandon={() => abandonMut.mutate()}
              canFinalize={canFinalize}
              disabled={!sessionActive || busy}
              submitting={turnMut.isPending}
              finalizing={finalizeMut.isPending}
              abandoning={abandonMut.isPending}
              sessionActive={sessionActive}
              progressLabel={progress.label}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

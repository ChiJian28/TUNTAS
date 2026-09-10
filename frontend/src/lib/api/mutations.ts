import type { QueryClient } from "@tanstack/react-query";
import type {
  AdaptiveSessionStartResponse,
  AdaptiveSessionView,
  AdaptiveTurnResponse,
  AssuranceRefreshResponse,
  BlastReopenRequest,
  BlastReopenResponse,
  CreateRunRequest,
  CreateRunResponse,
  DecisionRequest,
  DecisionResponse,
  ExecuteRunResponse,
  GateDecisionRequest,
  ReviewChainView,
  SimulationAttemptRequest,
  SimulationAttemptResponse,
  WhatIfRequest,
  WhatIfResponse,
} from "./generated/openapi.types";
import { apiPost } from "./client";
import { queryKeys } from "./query-keys";
import { newIdempotencyKey } from "@/lib/utils";

export async function createRun(body: CreateRunRequest) {
  return apiPost<CreateRunResponse>("/v1/runs", body);
}

export async function executeRun(runId: string) {
  return apiPost<ExecuteRunResponse>(`/v1/runs/${runId}/execute`);
}

export async function whatIf(runId: string, body: WhatIfRequest) {
  return apiPost<WhatIfResponse>(`/v1/runs/${runId}/what-if`, body);
}

export async function decide(
  runId: string,
  body: DecisionRequest,
  idempotencyKey?: string,
) {
  return apiPost<DecisionResponse>(`/v1/runs/${runId}/decision`, body, {
    headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() },
  });
}

export async function decideGate(
  runId: string,
  gateKey: string,
  body: GateDecisionRequest,
  idempotencyKey?: string,
) {
  return apiPost<ReviewChainView>(
    `/v1/runs/${runId}/gates/${gateKey}`,
    body,
    {
      headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() },
    },
  );
}

export async function resumeDecision(
  runId: string,
  body: DecisionRequest,
  idempotencyKey?: string,
) {
  return apiPost<DecisionResponse>(`/v1/runs/${runId}/resume`, body, {
    headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() },
  });
}

export async function refreshAssurance(runId: string) {
  return apiPost<AssuranceRefreshResponse>(
    `/v1/runs/${runId}/assurance/refresh`,
  );
}

export async function blastReopen(runId: string, body: BlastReopenRequest) {
  return apiPost<BlastReopenResponse>(
    `/v1/runs/${runId}/blast-radius/reopen`,
    body,
  );
}

export async function startSimSession(
  scenarioId: string,
  employeeRef: string,
) {
  return apiPost<AdaptiveSessionStartResponse>(
    `/v1/simulations/${scenarioId}/sessions`,
    { employee_ref: employeeRef },
  );
}

export async function simTurn(
  sessionId: string,
  body: { learner_action: string; actions?: string[] },
) {
  return apiPost<AdaptiveTurnResponse>(
    `/v1/simulations/sessions/${sessionId}/turns`,
    body,
  );
}

export async function finalizeSim(sessionId: string) {
  return apiPost<SimulationAttemptResponse>(
    `/v1/simulations/sessions/${sessionId}/finalize`,
  );
}

export async function abandonSim(sessionId: string) {
  return apiPost<AdaptiveSessionView>(
    `/v1/simulations/sessions/${sessionId}/abandon`,
  );
}

export async function quickProof(
  scenarioId: string,
  body: SimulationAttemptRequest,
) {
  return apiPost<SimulationAttemptResponse>(
    `/v1/simulations/${scenarioId}/attempts`,
    body,
  );
}

export function invalidateAfterCreate(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["runs"] });
  void qc.invalidateQueries({ queryKey: queryKeys.metrics });
}

export function invalidateAfterExecute(qc: QueryClient, runId: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.run(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.cockpit(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.timeline(runId) });
  void qc.invalidateQueries({ queryKey: ["handoffs", runId] });
  void qc.invalidateQueries({ queryKey: queryKeys.options(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.gates(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.runStatus(runId) });
}

export function invalidateAfterWhatIf(qc: QueryClient, runId: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.options(runId) });
  void qc.invalidateQueries({ queryKey: ["option", runId] });
  void qc.invalidateQueries({ queryKey: queryKeys.cockpit(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.run(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.timeline(runId) });
}

export function invalidateAfterDecision(qc: QueryClient, runId: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.run(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.cockpit(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.timeline(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.approval(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.approvals(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.gates(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.sessions(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.assignments(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.artifacts(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.assurance(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.runStatus(runId) });
}

export function invalidateAfterGateDecision(qc: QueryClient, runId: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.gates(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.cockpit(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.run(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.runStatus(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.timeline(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.events(runId) });
  void qc.invalidateQueries({ queryKey: ["handoffs", runId] });
}

export function invalidateAfterSimProof(qc: QueryClient, runId: string) {
  void qc.invalidateQueries({ queryKey: ["employee", runId] });
  void qc.invalidateQueries({ queryKey: queryKeys.assurance(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.cockpit(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.evidenceGraph(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.timeline(runId) });
}

export function invalidateAfterAssuranceRefresh(qc: QueryClient, runId: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.assurance(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.cockpit(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.evidenceGraph(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.timeline(runId) });
}

export function invalidateAfterBlastReopen(qc: QueryClient, runId: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.run(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.cockpit(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.timeline(runId) });
  void qc.invalidateQueries({ queryKey: ["handoffs", runId] });
  void qc.invalidateQueries({ queryKey: queryKeys.options(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.approval(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.gates(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.evidenceGraph(runId) });
  void qc.invalidateQueries({ queryKey: queryKeys.runStatus(runId) });
}

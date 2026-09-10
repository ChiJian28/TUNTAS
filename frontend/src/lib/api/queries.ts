import type {
  AgentHandoffView,
  ApprovalDecisionView,
  ArtifactView,
  AssuranceSnapshotView,
  BlastRadiusResponse,
  CockpitBundle,
  EmployeeDetail,
  EmployeeListItem,
  EvidenceGraphResponse,
  EvidenceLineageResponse,
  HealthResponse,
  ImpactBriefResponse,
  MeResponse,
  MetricsSummary,
  PortfolioOptionDetail,
  ReviewChainView,
  RunDetail,
  RunEvent,
  RunListItem,
  RunStatusView,
  ScenarioView,
  ScheduleAssignmentView,
  TimelineResponse,
  TrainingSessionView,
  AdaptiveSessionView,
} from "./generated/openapi.types";
import { apiGet } from "./client";
import { queryKeys } from "./query-keys";

export const apiQueries = {
  health: {
    queryKey: queryKeys.health,
    queryFn: () => apiGet<HealthResponse>("/health"),
  },
  me: {
    queryKey: queryKeys.me,
    queryFn: () => apiGet<MeResponse>("/v1/me"),
  },
  metrics: {
    queryKey: queryKeys.metrics,
    queryFn: () => apiGet<MetricsSummary>("/v1/metrics/summary"),
  },
  runs: (limit = 30) => ({
    queryKey: queryKeys.runs(limit),
    queryFn: () => apiGet<RunListItem[]>("/v1/runs", { params: { limit } }),
  }),
  run: (runId: string) => ({
    queryKey: queryKeys.run(runId),
    queryFn: () => apiGet<RunDetail>(`/v1/runs/${runId}`),
  }),
  runStatus: (runId: string) => ({
    queryKey: queryKeys.runStatus(runId),
    queryFn: () => apiGet<RunStatusView>(`/v1/runs/${runId}/status`),
  }),
  cockpit: (runId: string) => ({
    queryKey: queryKeys.cockpit(runId),
    queryFn: () => apiGet<CockpitBundle>(`/v1/runs/${runId}/cockpit`),
  }),
  events: (runId: string) => ({
    queryKey: queryKeys.events(runId),
    queryFn: () => apiGet<RunEvent[]>(`/v1/runs/${runId}/events`),
  }),
  timeline: (runId: string) => ({
    queryKey: queryKeys.timeline(runId),
    queryFn: () => apiGet<TimelineResponse>(`/v1/runs/${runId}/timeline`),
  }),
  handoffs: (runId: string, latestPerAgent = true) => ({
    queryKey: queryKeys.handoffs(runId, latestPerAgent),
    queryFn: () =>
      apiGet<AgentHandoffView[]>(`/v1/runs/${runId}/handoffs`, {
        params: { latest_per_agent: latestPerAgent },
      }),
  }),
  options: (runId: string) => ({
    queryKey: queryKeys.options(runId),
    queryFn: () => apiGet<PortfolioOptionDetail[]>(`/v1/runs/${runId}/options`),
  }),
  option: (runId: string, optionKey: string) => ({
    queryKey: queryKeys.option(runId, optionKey),
    queryFn: () =>
      apiGet<PortfolioOptionDetail>(`/v1/runs/${runId}/options/${optionKey}`),
  }),
  employees: (runId: string) => ({
    queryKey: queryKeys.employees(runId),
    queryFn: () => apiGet<EmployeeListItem[]>(`/v1/runs/${runId}/employees`),
  }),
  employee: (runId: string, employeeRef: string) => ({
    queryKey: queryKeys.employee(runId, employeeRef),
    queryFn: () =>
      apiGet<EmployeeDetail>(`/v1/runs/${runId}/employees/${encodeURIComponent(employeeRef)}`),
  }),
  scenarios: (runId: string) => ({
    queryKey: queryKeys.scenarios(runId),
    queryFn: () => apiGet<ScenarioView[]>(`/v1/runs/${runId}/scenarios`),
  }),
  sessions: (runId: string) => ({
    queryKey: queryKeys.sessions(runId),
    queryFn: () => apiGet<TrainingSessionView[]>(`/v1/runs/${runId}/sessions`),
  }),
  assignments: (runId: string) => ({
    queryKey: queryKeys.assignments(runId),
    queryFn: () =>
      apiGet<ScheduleAssignmentView[]>(`/v1/runs/${runId}/assignments`),
  }),
  artifacts: (runId: string) => ({
    queryKey: queryKeys.artifacts(runId),
    queryFn: () => apiGet<ArtifactView[]>(`/v1/runs/${runId}/artifacts`),
  }),
  assurance: (runId: string) => ({
    queryKey: queryKeys.assurance(runId),
    queryFn: () =>
      apiGet<AssuranceSnapshotView[]>(`/v1/runs/${runId}/assurance`),
  }),
  approval: (runId: string) => ({
    queryKey: queryKeys.approval(runId),
    queryFn: () =>
      apiGet<ApprovalDecisionView | null>(`/v1/runs/${runId}/approval`),
  }),
  approvals: (runId: string) => ({
    queryKey: queryKeys.approvals(runId),
    queryFn: () =>
      apiGet<ApprovalDecisionView[]>(`/v1/runs/${runId}/approvals`),
  }),
  gates: (runId: string) => ({
    queryKey: queryKeys.gates(runId),
    queryFn: () => apiGet<ReviewChainView>(`/v1/runs/${runId}/gates`),
  }),
  impactBrief: (runId: string, frameworkCode = "BNM_ORTC_2026") => ({
    queryKey: queryKeys.impactBrief(runId, frameworkCode),
    queryFn: () =>
      apiGet<ImpactBriefResponse>(`/v1/runs/${runId}/impact-brief`, {
        params: { framework_code: frameworkCode },
      }),
  }),
  evidenceGraph: (runId: string) => ({
    queryKey: queryKeys.evidenceGraph(runId),
    queryFn: () =>
      apiGet<EvidenceGraphResponse>(`/v1/runs/${runId}/evidence-graph`),
  }),
  lineage: (nodeId: string) => ({
    queryKey: queryKeys.lineage(nodeId),
    queryFn: () =>
      apiGet<EvidenceLineageResponse>(`/v1/evidence/${nodeId}/lineage`),
    enabled: false as const,
  }),
  blastRadius: (runId: string, frameworkCode: string) => ({
    queryKey: queryKeys.blastRadius(runId, frameworkCode),
    queryFn: () =>
      apiGet<BlastRadiusResponse>(`/v1/runs/${runId}/blast-radius`, {
        params: { framework_code: frameworkCode },
      }),
    enabled: false as const,
    retry: false as const,
  }),
  simSession: (sessionId: string) => ({
    queryKey: queryKeys.simSession(sessionId),
    queryFn: () =>
      apiGet<AdaptiveSessionView>(`/v1/simulations/sessions/${sessionId}`),
  }),
  simSessions: (scenarioId: string) => ({
    queryKey: queryKeys.simSessions(scenarioId),
    queryFn: () =>
      apiGet<AdaptiveSessionView[]>(
        `/v1/simulations/${scenarioId}/sessions`,
      ),
  }),
};

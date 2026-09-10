export const queryKeys = {
  health: ["health"] as const,
  me: ["me"] as const,
  metrics: ["metrics"] as const,
  runs: (limit: number) => ["runs", { limit }] as const,
  run: (runId: string) => ["run", runId] as const,
  runStatus: (runId: string) => ["runStatus", runId] as const,
  cockpit: (runId: string) => ["cockpit", runId] as const,
  events: (runId: string) => ["events", runId] as const,
  timeline: (runId: string) => ["timeline", runId] as const,
  handoffs: (runId: string, latestPerAgent: boolean) =>
    ["handoffs", runId, { latestPerAgent }] as const,
  options: (runId: string) => ["options", runId] as const,
  option: (runId: string, optionKey: string) => ["option", runId, optionKey] as const,
  employees: (runId: string) => ["employees", runId] as const,
  employee: (runId: string, employeeRef: string) =>
    ["employee", runId, employeeRef] as const,
  scenarios: (runId: string) => ["scenarios", runId] as const,
  sessions: (runId: string) => ["sessions", runId] as const,
  assignments: (runId: string) => ["assignments", runId] as const,
  artifacts: (runId: string) => ["artifacts", runId] as const,
  assurance: (runId: string) => ["assurance", runId] as const,
  approval: (runId: string) => ["approval", runId] as const,
  approvals: (runId: string) => ["approvals", runId] as const,
  gates: (runId: string) => ["gates", runId] as const,
  impactBrief: (runId: string, frameworkCode: string) =>
    ["impactBrief", runId, frameworkCode] as const,
  evidenceGraph: (runId: string) => ["evidenceGraph", runId] as const,
  lineage: (nodeId: string) => ["lineage", nodeId] as const,
  blastRadius: (runId: string, frameworkCode: string) =>
    ["blastRadius", runId, frameworkCode] as const,
  simSession: (sessionId: string) => ["simSession", sessionId] as const,
  simSessions: (scenarioId: string) => ["simSessions", scenarioId] as const,
};

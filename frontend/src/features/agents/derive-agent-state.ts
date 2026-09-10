import {
  AGENT_PIPELINE,
  type AgentNodeState,
} from "@/lib/constants/agents";
import type { AgentHandoffView, RunStatus } from "@/lib/api/generated/openapi.types";
import { parseHandoffEnvelope } from "@/lib/schemas/payloads";

export type FailureSignal = {
  agentHint?: string | null;
  eventType: string;
};

export type CompletionSignal = {
  agentHint?: string | null;
  eventType: string;
  at?: string | null;
};

export type DerivedAgentNode = {
  id: string;
  label: string;
  state: AgentNodeState;
  handoffs: AgentHandoffView[];
  handoffCount: number;
  latencyMs?: number | null;
  modelName?: string | null;
  citationCoverage?: number | null;
  requiresReview: boolean;
  timestamp?: string | null;
  schemaVersion?: string | null;
  confidence?: number | null;
  /** How completion was proven — never invented. */
  evidenceSource?: "handoff" | "event" | "status" | null;
};

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function agentNamesForNode(nodeId: string): string[] {
  const node = AGENT_PIPELINE.find((n) => n.id === nodeId);
  if (!node) return [nodeId];
  const names = "agentNames" in node ? [...node.agentNames] : [];
  return [node.id, node.label, ...names];
}

export function matchAgentToPipelineNode(
  agentName: string | null | undefined,
): (typeof AGENT_PIPELINE)[number]["id"] | null {
  if (!agentName) return null;
  const target = normalizeToken(agentName);
  for (const node of AGENT_PIPELINE) {
    const candidates = agentNamesForNode(node.id).map(normalizeToken);
    if (candidates.some((c) => c === target || target.includes(c) || c.includes(target))) {
      return node.id;
    }
  }
  return null;
}

/**
 * Map persisted event_type → pipeline node.
 * Examples:
 *   agent.diagnostic.completed → diagnostic
 *   optimizer.completed → optimizer
 *   approval.gate → hitl
 */
export function matchEventTypeToPipelineNode(
  eventType: string | null | undefined,
): (typeof AGENT_PIPELINE)[number]["id"] | null {
  if (!eventType) return null;
  const t = eventType.toLowerCase();

  // Explicit deterministic / gate events first
  if (t.startsWith("optimizer.") || t === "optimizer" || t.includes("portfolio.optimized")) {
    return "optimizer";
  }
  if (t.startsWith("review.gate") || t.startsWith("approval.") || t.includes("hitl") || t === "approval.gate") {
    return "hitl";
  }
  if (t.includes("workflow.parallel_intake") || t === "run.created" || t.startsWith("intake.")) {
    return "intake";
  }

  // agent.<name>.completed | agent.<name>.failed | …
  const agentMatch = t.match(/^agent\.([a-z0-9_]+)(?:\.|$)/);
  if (agentMatch) {
    return matchAgentToPipelineNode(agentMatch[1]);
  }

  // Fallback: any pipeline token embedded in the event type
  for (const node of AGENT_PIPELINE) {
    for (const name of agentNamesForNode(node.id)) {
      const token = normalizeToken(name);
      if (token.length >= 4 && normalizeToken(t).includes(token)) {
        return node.id;
      }
    }
  }
  return null;
}

function isFailureEventType(eventType: string): boolean {
  const t = eventType.toLowerCase();
  return (
    t.includes("fail") ||
    t.includes("error") ||
    t.includes("exception") ||
    t === "agent_failed" ||
    t === "run_failed"
  );
}

function isCompletionEventType(eventType: string): boolean {
  const t = eventType.toLowerCase();
  if (isFailureEventType(t)) return false;
  return (
    t.endsWith(".completed") ||
    t.endsWith(".done") ||
    t === "approval.gate" ||
    t === "approval.approved" ||
    t === "optimizer.completed" ||
    t.includes("workflow.scheduled")
  );
}

function extractEnvelopeMeta(handoff: AgentHandoffView) {
  const parsed = parseHandoffEnvelope(handoff.output_json ?? {});
  if (!parsed.ok) {
    return {
      requiresReview: false,
      schemaVersion: null as string | null,
      confidence: null as number | null,
    };
  }
  return {
    requiresReview: parsed.data.requires_review === true,
    schemaVersion: parsed.data.schema_version ?? null,
    confidence:
      typeof parsed.data.confidence === "number" ? parsed.data.confidence : null,
  };
}

/**
 * Derive agent node states ONLY from current_node + handoffs + persisted events.
 * Never invent progress from timers or fixed sequences.
 *
 * Completion proof (in order):
 * 1. typed handoff for the node
 * 2. persisted completion event (e.g. optimizer.completed — OR-Tools has no LLM handoff)
 * 3. HITL / intake inferred from run status when appropriate
 */
export function deriveAgentStates(opts: {
  currentNode?: string | null;
  status?: RunStatus | null;
  handoffs: AgentHandoffView[];
  failures?: FailureSignal[];
  completions?: CompletionSignal[];
}): DerivedAgentNode[] {
  const {
    currentNode,
    status,
    handoffs,
    failures = [],
    completions = [],
  } = opts;
  const currentId = matchAgentToPipelineNode(currentNode ?? undefined);

  const handoffsByNode = new Map<string, AgentHandoffView[]>();
  for (const h of handoffs) {
    const nodeId = matchAgentToPipelineNode(h.agent_name);
    if (!nodeId) continue;
    const list = handoffsByNode.get(nodeId) ?? [];
    list.push(h);
    handoffsByNode.set(nodeId, list);
  }

  const completedByEvent = new Map<string, CompletionSignal>();
  for (const c of completions) {
    const fromHint = matchAgentToPipelineNode(c.agentHint ?? undefined);
    const fromType = matchEventTypeToPipelineNode(c.eventType);
    const nodeId = fromHint ?? fromType;
    if (!nodeId) continue;
    const prev = completedByEvent.get(nodeId);
    if (!prev || (c.at && prev.at && c.at > prev.at) || (c.at && !prev.at)) {
      completedByEvent.set(nodeId, c);
    } else if (!prev) {
      completedByEvent.set(nodeId, c);
    }
  }

  const failedNodes = new Set<string>();
  for (const f of failures) {
    if (!isFailureEventType(f.eventType)) continue;
    const hinted =
      matchAgentToPipelineNode(f.agentHint ?? undefined) ??
      matchEventTypeToPipelineNode(f.eventType);
    if (hinted) failedNodes.add(hinted);
    else if (currentId) failedNodes.add(currentId);
  }
  if (status === "failed" && currentId) {
    failedNodes.add(currentId);
  }

  return AGENT_PIPELINE.map((node) => {
    const nodeHandoffs = [...(handoffsByNode.get(node.id) ?? [])].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const latest = nodeHandoffs[0];
    const meta = latest
      ? extractEnvelopeMeta(latest)
      : { requiresReview: false, schemaVersion: null, confidence: null };
    const completionEvt = completedByEvent.get(node.id);

    let state: AgentNodeState = "queued";
    let evidenceSource: DerivedAgentNode["evidenceSource"] = null;

    if (failedNodes.has(node.id)) {
      state = "failed";
      evidenceSource = "event";
    } else if (node.id === "hitl" && status === "awaiting_approval") {
      state = "review";
      evidenceSource = "status";
    } else if (
      node.id === "hitl" &&
      (status === "completed" ||
        status === "rejected" ||
        status === "approved_processing")
    ) {
      state = status === "approved_processing" ? "active" : "completed";
      evidenceSource = completionEvt || latest ? (latest ? "handoff" : "event") : "status";
    } else if (latest && meta.requiresReview) {
      state = "review";
      evidenceSource = "handoff";
    } else if (latest) {
      state = "completed";
      evidenceSource = "handoff";
    } else if (completionEvt) {
      // Deterministic nodes (optimizer) complete via event, not LLM handoff.
      state =
        node.id === "hitl" && status === "awaiting_approval"
          ? "review"
          : "completed";
      evidenceSource = "event";
    } else if (currentId === node.id) {
      state = "active";
      evidenceSource = "status";
    } else if (
      node.id === "intake" &&
      status &&
      status !== "created" &&
      (handoffs.length > 0 || Boolean(currentNode) || completions.length > 0)
    ) {
      state = "completed";
      evidenceSource = "status";
    } else {
      state = "queued";
    }

    return {
      id: node.id,
      label: node.label,
      state,
      handoffs: nodeHandoffs,
      handoffCount: nodeHandoffs.length,
      latencyMs: latest?.latency_ms ?? null,
      modelName: latest?.model_name ?? null,
      citationCoverage: latest?.citation_coverage ?? null,
      requiresReview: Boolean(latest) && meta.requiresReview,
      timestamp: latest?.created_at ?? completionEvt?.at ?? null,
      schemaVersion: meta.schemaVersion,
      confidence: meta.confidence,
      evidenceSource,
    };
  });
}

export function collectFailureSignals(
  events: Array<{
    event_type?: string;
    payload?: Record<string, unknown>;
    kind?: string;
    at?: string;
    created_at?: string;
  }>,
): FailureSignal[] {
  const out: FailureSignal[] = [];
  for (const ev of events) {
    const eventType =
      ev.event_type ||
      (typeof ev.payload?.event_type === "string" ? ev.payload.event_type : "") ||
      "";
    if (!eventType || !isFailureEventType(eventType)) continue;
    const payload = ev.payload ?? {};
    const hint =
      (typeof payload.agent_name === "string" && payload.agent_name) ||
      (typeof payload.agent === "string" && payload.agent) ||
      (typeof payload.node === "string" && payload.node) ||
      (typeof payload.current_node === "string" && payload.current_node) ||
      null;
    out.push({ eventType, agentHint: hint });
  }
  return out;
}

export function collectCompletionSignals(
  events: Array<{
    event_type?: string;
    payload?: Record<string, unknown>;
    kind?: string;
    at?: string;
    created_at?: string;
  }>,
): CompletionSignal[] {
  const out: CompletionSignal[] = [];
  for (const ev of events) {
    const eventType =
      ev.event_type ||
      (typeof ev.payload?.event_type === "string" ? ev.payload.event_type : "") ||
      "";
    if (!eventType || !isCompletionEventType(eventType)) continue;
    const payload = ev.payload ?? {};
    const hint =
      (typeof payload.agent_name === "string" && payload.agent_name) ||
      (typeof payload.agent === "string" && payload.agent) ||
      (typeof payload.node === "string" && payload.node) ||
      null;
    out.push({
      eventType,
      agentHint: hint,
      at: ev.at ?? ev.created_at ?? null,
    });
  }
  return out;
}

export function recommendedNextAction(opts: {
  status?: RunStatus | null;
  currentNode?: string | null;
  awaitingApproval?: boolean;
  currentGate?: string | null;
}): { label: string; href?: string; description: string } {
  const status = opts.status ?? "unknown";
  if (status === "created") {
    return {
      label: "Awaiting execution",
      description: "Run is created. Execute has not completed yet — do not invent agent progress.",
    };
  }
  if (status === "running" || status === "revising" || status === "approved_processing") {
    return {
      label: "Agents in progress",
      description: `Live pipeline at ${opts.currentNode ?? "unknown node"}. Watch persisted timeline events.`,
    };
  }
  if (status === "awaiting_approval" || opts.awaitingApproval) {
    const gate = opts.currentGate || "compliance";
    return {
      label: "Walk department review gates",
      href: `review/${gate}`,
      description:
        "HITL is armed. Compliance → (Procurement) → Learning → Operations → Management COMMIT. Nothing is scheduled until the last gate.",
    };
  }
  if (status === "completed") {
    return {
      label: "Review delivery & assurance",
      href: "delivery",
      description: "Management COMMIT succeeded. Inspect schedules, artifacts, and assurance evidence.",
    };
  }
  if (status === "rejected") {
    return {
      label: "Inspect rejection audit",
      href: "audit",
      description: "Decision was rejected. Review audit trail and handoffs for rationale.",
    };
  }
  if (status === "failed") {
    return {
      label: "Investigate failure",
      href: "audit",
      description: "Run failed. Use audit events and handoffs — do not replay fake progress.",
    };
  }
  if (status === "needs_policy_recompile") {
    return {
      label: "Policy blast radius",
      href: "evidence",
      description: "Policy change requires recompile. Review evidence blast radius before resuming.",
    };
  }
  return {
    label: "Monitor run",
    description: `Status: ${status}`,
  };
}

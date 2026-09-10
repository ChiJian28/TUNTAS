"""Cockpit API response models — mirror these as TypeScript on the frontend."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class RunListItem(BaseModel):
    """TS: RunListItem"""

    id: str
    request_id: str
    thread_id: str
    status: str
    current_node: str | None = None
    trigger_schema_version: str
    selected_option_id: str | None = None
    created_at: datetime
    updated_at: datetime
    error_message: str | None = None
    employee_count: int


class AssignmentItem(BaseModel):
    """TS: AssignmentItem"""

    employee_ref: str
    course_code: str
    course_title: str | None = None
    provider_code: str | None = None
    cost_myr: float
    competency_codes: list[str] = Field(default_factory=list)
    delivery_mode: str | None = None
    class_capacity: int | None = None
    prerequisite_codes: list[str] = Field(default_factory=list)
    hrd_corp_claim_status: str | None = None


class PortfolioOptionDetail(BaseModel):
    """TS: PortfolioOptionDetail — use for comparison cards + what-if."""

    id: str
    option_key: Literal["cost", "balanced", "coverage"] | str
    label: str
    total_cost_myr: float
    cost_per_employee_myr: float
    coverage_score: float
    risk_reduction_score: float
    operational_coverage: float
    hard_constraint_ok: bool
    solver_status: str | None = None
    challenger_flags: list[dict[str, Any]] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)
    assignments: list[dict[str, Any]] = Field(default_factory=list)


class WhatIfResponse(BaseModel):
    """TS: WhatIfResponse"""

    run_id: str
    options: list[PortfolioOptionDetail]
    applied: bool = False
    checkpoint_synced: bool = False
    portfolio_version: str | None = None
    solver_status: str | None = None
    infeasible_reason: str | None = None
    allow_coverage_relax: bool | None = None


class RunRequestSummary(BaseModel):
    """TS: RunRequestSummary — constraint header from trigger_payload (no hardcoded demo numbers)."""

    request_id: str | None = None
    source: str | None = None
    synthetic: bool = False
    max_budget_per_employee_myr: int | None = None
    total_budget_myr: int | None = None
    min_operational_coverage_ratio: float | None = None
    training_window_start: str | None = None
    training_window_end: str | None = None
    frameworks: list[str] = Field(default_factory=list)
    employee_count: int = 0
    portfolio_version: str | None = None


class AgentHandoffView(BaseModel):
    """TS: AgentHandoffView"""

    id: str
    agent_name: str
    input_hash: str
    output_json: dict[str, Any]
    citation_coverage: float | None = None
    latency_ms: int | None = None
    model_name: str | None = None
    created_at: datetime


class TimelineHandoffItem(BaseModel):
    """TS: TimelineHandoffItem"""

    kind: Literal["handoff"] = "handoff"
    id: str
    at: datetime
    agent_name: str
    latency_ms: int | None = None
    model_name: str | None = None
    citation_coverage: float | None = None
    requires_review: bool = False
    summary: str


class TimelineEventItem(BaseModel):
    """TS: TimelineEventItem"""

    kind: Literal["event"] = "event"
    id: str
    at: datetime
    event_type: str
    actor_id: str
    actor_role: str
    payload: dict[str, Any] = Field(default_factory=dict)


class TimelineResponse(BaseModel):
    """TS: TimelineResponse"""

    run_id: str
    items: list[dict[str, Any]]


class EvidenceNodeView(BaseModel):
    """TS: EvidenceNodeView — @xyflow/react node data"""

    id: str
    node_type: str
    external_ref: str
    label: str
    payload: dict[str, Any] = Field(default_factory=dict)
    content_hash: str | None = None
    created_at: datetime | None = None


class EvidenceEdgeView(BaseModel):
    """TS: EvidenceEdgeView — @xyflow/react edge data"""

    id: str
    from_node_id: str
    to_node_id: str
    edge_type: str
    weight: float = 1.0
    payload: dict[str, Any] = Field(default_factory=dict)


class EvidenceGraphResponse(BaseModel):
    """TS: EvidenceGraphResponse"""

    run_id: str
    nodes: list[EvidenceNodeView]
    edges: list[EvidenceEdgeView]


class EvidenceLineageResponse(BaseModel):
    """TS: EvidenceLineageResponse"""

    root_node_id: str
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]


class EmployeeListItem(BaseModel):
    """TS: EmployeeListItem"""

    employee_ref: str
    pseudonym: str
    role_code: str | None = None
    role_title: str | None = None
    unit: str | None = None
    location: str | None = None
    current_level: int | None = None
    target_level: int | None = None
    availability_pct: float | None = None
    competency_gaps: list[dict[str, Any]] = Field(default_factory=list)
    readiness: list[dict[str, Any]] = Field(default_factory=list)


class EmployeeDetail(EmployeeListItem):
    """TS: EmployeeDetail"""

    assessments: list[dict[str, Any]] = Field(default_factory=list)
    schedule: list[dict[str, Any]] = Field(default_factory=list)
    simulation_attempts: list[dict[str, Any]] = Field(default_factory=list)


class ScenarioView(BaseModel):
    """TS: ScenarioView"""

    id: str
    code: str
    title: str
    role_focus: str
    prompt: str | None = None
    rubric: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime | None = None


class ScenarioSummary(BaseModel):
    """TS: ScenarioSummary"""

    id: str
    code: str
    title: str
    role_focus: str


class TrainingSessionView(BaseModel):
    """TS: TrainingSessionView"""

    id: str
    course_code: str
    title: str
    starts_at: datetime
    ends_at: datetime
    delivery_mode: str
    location: str | None = None
    capacity: int
    metadata: dict[str, Any] = Field(default_factory=dict)


class ScheduleAssignmentView(BaseModel):
    """TS: ScheduleAssignmentView"""

    id: str
    employee_ref: str
    course_code: str
    cost_myr: float
    session_id: str
    session_title: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class AssuranceSnapshotView(BaseModel):
    """TS: AssuranceSnapshotView"""

    id: str
    kirkpatrick: dict[str, Any]
    residual_risk: dict[str, Any]
    control_coverage: dict[str, Any]
    created_at: datetime


class ApprovalDecisionView(BaseModel):
    """TS: ApprovalDecisionView"""

    id: str
    decision: str
    conditions: list[Any] = Field(default_factory=list)
    rationale: str
    actor_id: str
    actor_role: str
    input_hash: str
    created_at: datetime
    option_key: str
    option_label: str


class ArtifactView(BaseModel):
    """TS: ArtifactView"""

    id: str
    artifact_type: str
    filename: str
    storage_path: str | None = None
    content_type: str
    sha256: str
    hmac_signature: str
    byte_size: int
    created_at: datetime


class CockpitRunSummary(BaseModel):
    """TS: CockpitRunSummary"""

    id: str
    request_id: str
    thread_id: str
    status: str
    current_node: str | None = None
    trigger_schema_version: str
    employee_count: int
    selected_option_id: str | None = None
    created_at: datetime
    updated_at: datetime
    error_message: str | None = None
    awaiting_approval: bool


class ReviewGateView(BaseModel):
    """TS: ReviewGateView — one department HITL step."""

    id: str | None = None
    gate_key: Literal["compliance", "procurement", "learning", "operations", "management"]
    sequence: int
    label: str
    prompt: str
    status: str
    decision: str | None = None
    rationale: str | None = None
    conditions: list[Any] = Field(default_factory=list)
    actor_id: str | None = None
    actor_role: str | None = None
    input_hash: str | None = None
    return_to_stage: str | None = None
    decided_at: datetime | None = None
    updated_at: datetime | None = None
    skipped: bool = False
    commits: bool = False
    allowed_roles: list[str] = Field(default_factory=list)
    revise_stage: str | None = None
    can_decide: bool = False
    blocked_by: str | None = None
    missing_priors: list[str] = Field(default_factory=list)


class ReviewChainView(BaseModel):
    """TS: ReviewChainView"""

    run_id: str
    path: Literal["capability", "circular"]
    current_gate: str | None = None
    commit_unlocked: bool = False
    commit_blocked_by: list[str] = Field(default_factory=list)
    run_status: str
    gates: list[ReviewGateView] = Field(default_factory=list)
    message: str | None = None
    langgraph_resumed: bool | None = None
    decided_gate: str | None = None
    decision: str | None = None
    input_hash: str | None = None


class WorkbuddyBriefResponse(BaseModel):
    """TS: WorkbuddyBriefResponse — paste-ready MCP/WorkBuddy gate materials."""

    instruction: str = ""
    chat_markdown: str = ""
    run_id: str
    view: str
    path: Literal["capability", "circular"] | None = None
    current_gate: str | None = None
    commit_unlocked: bool = False
    commit_blocked_by: list[str] = Field(default_factory=list)
    run_status: str | None = None
    dispatch_expert_id: str | None = None
    dispatch_expert_name: str | None = None
    dispatch_action: str = "wait_human_gate"
    wait_line: str = ""
    human_commands: list[str] = Field(default_factory=list)
    evidence_url: str | None = None
    review_url: str | None = None
    overview_url: str | None = None
    ok: bool = True
    detail: str | None = None
    model_config = {"extra": "allow"}


class CockpitBundle(BaseModel):
    """TS: CockpitBundle — preferred first-paint endpoint for the decision cockpit."""

    run: CockpitRunSummary
    request: RunRequestSummary | None = None
    options: list[PortfolioOptionDetail]
    handoffs: list[AgentHandoffView]
    latest_events: list[dict[str, Any]] = Field(default_factory=list)
    assurance: AssuranceSnapshotView | None = None
    assurance_history: list[AssuranceSnapshotView] = Field(default_factory=list)
    scenarios: list[ScenarioSummary] = Field(default_factory=list)
    artifacts: list[ArtifactView] = Field(default_factory=list)
    sessions: list[TrainingSessionView] = Field(default_factory=list)
    approval: ApprovalDecisionView | None = None
    review: ReviewChainView | None = None
    employee_count: int
    portfolio_version: str | None = None


class BlastRadiusResponse(BaseModel):
    """TS: BlastRadiusResponse"""

    run_id: str | None = None
    framework_code: str | None = None
    affected_nodes: list[dict[str, Any]] = Field(default_factory=list)
    affected_employees: list[str] = Field(default_factory=list)
    affected_courses: list[str] = Field(default_factory=list)
    expected_vs_found: dict[str, Any] | None = None
    featured_red: dict[str, Any] | None = None
    featured_green: dict[str, Any] | None = None
    walk: str | None = None
    model_config = {"extra": "allow"}


class BlastReopenResponse(BaseModel):
    """TS: BlastReopenResponse"""

    run_id: str
    status: str
    framework_code: str
    recompiled_employee_count: int
    affected_employees: list[str] = Field(default_factory=list)
    langgraph_interrupt_rearmed: bool = False
    options: list[dict[str, Any]] = Field(default_factory=list)
    message: str


class IngestCircularResponse(BaseModel):
    """TS: IngestCircularResponse"""

    run_id: str
    framework_code: str
    circular_id: str
    title: str | None = None
    source: str | None = None
    use_gold_mapping: bool = True
    membership_source: str | None = None
    created: dict[str, Any] = Field(default_factory=dict)
    message: str
    model_config = {"extra": "allow"}


class ImpactBriefResponse(BaseModel):
    """TS: ImpactBriefResponse — short JSON for WorkBuddy chat."""

    chat_markdown: str = ""
    run_id: str
    framework_code: str
    headline: str
    expected_vs_found: dict[str, Any] = Field(default_factory=dict)
    action_brief: list[dict[str, Any]] = Field(default_factory=list)
    wait_state: str = "Nothing has been scheduled yet."
    approval: str = "awaiting_human"
    stale_courses: list[dict[str, Any]] = Field(default_factory=list)
    green_courses: list[dict[str, Any]] = Field(default_factory=list)
    affected_employees: list[dict[str, Any]] = Field(default_factory=list)
    unaffected_employees: list[dict[str, Any]] = Field(default_factory=list)
    featured_red: dict[str, Any] | None = None
    featured_green: dict[str, Any] | None = None
    model_config = {"extra": "allow"}


class EvidenceSpineLinkResponse(BaseModel):
    """TS: EvidenceSpineLinkResponse"""

    run_id: str
    framework_code: str | None = None
    evidence_url: str
    headline: str
    expected_vs_found: dict[str, Any] = Field(default_factory=dict)
    featured_red: dict[str, Any] | None = None
    featured_green: dict[str, Any] | None = None
    model_config = {"extra": "allow"}


class AssessPolicyChangeResponse(BaseModel):
    """TS: AssessPolicyChangeResponse"""

    run_id: str
    framework_code: str
    reopen: bool = False
    langgraph_interrupt_rearmed: bool = False
    radius: dict[str, Any] = Field(default_factory=dict)
    expected_vs_found: dict[str, Any] | None = None
    recompiled: dict[str, Any] | None = None
    model_config = {"extra": "allow"}


class AdaptiveSessionStartResponse(BaseModel):
    """TS: AdaptiveSessionStartResponse"""

    session_id: str
    scenario_id: str
    employee_ref: str
    status: str
    difficulty: str
    turn: dict[str, Any]
    adaptive: bool = True
    scoring: str


class AdaptiveTurnResponse(BaseModel):
    """TS: AdaptiveTurnResponse"""

    session_id: str
    status: str
    difficulty: str
    learner_turn: dict[str, Any]
    turn: dict[str, Any]
    can_finalize: bool
    adaptive: bool = True


class AdaptiveSessionView(BaseModel):
    """TS: AdaptiveSessionView — GET resume after refresh."""

    session_id: str
    scenario_id: str
    run_id: str
    employee_ref: str
    status: str
    difficulty: str
    turns: list[dict[str, Any]] = Field(default_factory=list)
    attempt_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    adaptive: bool = True


class AssuranceRefreshResponse(BaseModel):
    """TS: AssuranceRefreshResponse"""

    run_id: str
    phase: str
    assurance: dict[str, Any]
    node_id: str | None = None

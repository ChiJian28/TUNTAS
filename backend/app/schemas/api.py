from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    app: str
    env: str
    time: datetime


class CreateRunRequest(BaseModel):
    request_id: str | None = None
    trigger_path: str | None = None
    trigger_payload: dict[str, Any] | None = None
    use_synthetic_fallback: bool = True


class CreateRunResponse(BaseModel):
    run_id: str
    thread_id: str
    request_id: str
    status: str
    employee_count: int
    synthetic: bool


class ExecuteRunResponse(BaseModel):
    run_id: str
    status: str
    current_node: str | None = None
    message: str


class DecisionRequest(BaseModel):
    option_key: str
    decision: Literal["approve", "reject", "revise"]
    rationale: str = Field(min_length=8)
    conditions: list[str] = Field(default_factory=list)
    # When called via MCP service token, pass the human manager identity here.
    acting_manager_id: str | None = None
    # For revise — which stage to return to
    return_to_stage: Literal[
        "learning_architect", "challenger", "optimizer", "secretariat"
    ] | None = None
    # Stale-approval guard: reject if DB/checkpoint portfolios changed (e.g. after what-if)
    expected_portfolio_version: str | None = None


class WhatIfRequest(BaseModel):
    max_cost_per_employee_myr: int | None = None
    total_budget_myr: int | None = None
    min_operational_coverage_ratio: float | None = None
    # False = preview only (no DB/checkpoint write). True = apply + sync for approval.
    apply: bool = True


class BlastReopenRequest(BaseModel):
    framework_code: str
    reason: str = "policy_version_change"


class DecisionResponse(BaseModel):
    run_id: str
    status: str
    decision_id: str | None = None
    message: str


class SimulationAttemptRequest(BaseModel):
    employee_ref: str
    responses: dict[str, Any]


class SimulationAttemptResponse(BaseModel):
    attempt_id: str
    score: float
    level_awarded: int
    evidence_hash: str
    feedback: dict[str, Any]
    assurance_phase: str | None = None
    assurance_refreshed: bool | None = None
    assurance_error: str | None = None
    residual_risk: dict[str, Any] | None = None
    session_id: str | None = None
    adaptive: bool | None = None
    status: str | None = None
    learner_turns: int | None = None


class SimulationSessionStartRequest(BaseModel):
    employee_ref: str


class SimulationTurnRequest(BaseModel):
    learner_action: str = Field(min_length=1)
    actions: list[str] = Field(default_factory=list)


class MetricsSummary(BaseModel):
    runs_total: int
    runs_awaiting_approval: int
    runs_completed: int
    hard_constraint_violations: int
    avg_budget_utilization: float | None
    citation_coverage_avg: float | None
    approval_bypass_attempts: int
    # Computable extras (null when no data) — do not invent token/runtime KPIs we don't track
    avg_handoff_latency_ms: float | None = None
    artifact_completeness_avg: float | None = None


class MeResponse(BaseModel):
    subject: str
    role: str
    email: str | None = None
    auth_mode: str
    permissions: list[str] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    detail: str | dict[str, Any] | list[Any]


class RunStatusView(BaseModel):
    """Lightweight polling payload. Prefer SSE GET /events/stream for live updates."""

    run_id: str
    status: str
    current_node: str | None = None
    updated_at: datetime
    awaiting_approval: bool
    portfolio_version: str | None = None
    error_message: str | None = None


class RunRealtimeEventTypes:
    """Documented SSE event names for GET /v1/runs/{run_id}/events/stream."""

    CONNECTED = "connected"
    STATUS = "status"
    AUDIT = "audit"
    HANDOFF = "handoff"
    HEARTBEAT = "heartbeat"


class RunEvent(BaseModel):
    id: str
    event_type: str
    actor_id: str
    actor_role: str
    payload: dict[str, Any]
    created_at: datetime


class PortfolioOptionView(BaseModel):
    """Legacy thin view — prefer PortfolioOptionDetail (includes assignments)."""

    id: str
    option_key: str
    label: str
    total_cost_myr: float
    cost_per_employee_myr: float
    coverage_score: float
    risk_reduction_score: float
    operational_coverage: float
    hard_constraint_ok: bool
    challenger_flags: list[dict[str, Any]] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)
    solver_status: str | None = None
    assignments: list[dict[str, Any]] = Field(default_factory=list)


class RunDetail(BaseModel):
    id: str
    request_id: str
    thread_id: str
    status: str
    current_node: str | None
    trigger_schema_version: str
    employee_count: int
    selected_option_id: str | None
    created_at: datetime
    updated_at: datetime
    # Same shape as GET /options and cockpit.options (assignments included)
    options: list[PortfolioOptionView] = Field(default_factory=list)
    latest_events: list[RunEvent] = Field(default_factory=list)

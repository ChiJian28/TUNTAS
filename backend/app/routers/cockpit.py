"""Decision-cockpit read APIs — frontend can bind directly without extra backend work."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.schemas.cockpit import (
    AgentHandoffView,
    ApprovalDecisionView,
    AssuranceSnapshotView,
    CockpitBundle,
    EmployeeDetail,
    EmployeeListItem,
    EvidenceGraphResponse,
    PortfolioOptionDetail,
    RunListItem,
    ScheduleAssignmentView,
    ScenarioView,
    TimelineResponse,
    TrainingSessionView,
)
from app.security.auth import Principal, require_roles
from app.services import cockpit as cockpit_svc
from app.services import runs as run_store

router = APIRouter(prefix="/v1", tags=["cockpit"])

_READ = Depends(
    require_roles("viewer", "analyst", "manager", "compliance", "admin", "mcp_service")
)


def _require_run(run_id: str) -> dict:
    run = run_store.get_run(run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="run not found")
    return run


@router.get("/runs", response_model=list[RunListItem])
def list_runs(
    limit: int = Query(30, ge=1, le=100),
    principal: Principal = _READ,
) -> list[RunListItem]:
    return [RunListItem(**r) for r in cockpit_svc.list_runs(limit=limit)]


@router.get("/runs/{run_id}/cockpit", response_model=CockpitBundle)
def get_cockpit_bundle(
    run_id: str,
    principal: Principal = _READ,
) -> CockpitBundle:
    """Preferred first-paint payload for the Next.js decision cockpit."""
    data = cockpit_svc.cockpit_bundle(run_id)
    if not data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="run not found")
    return CockpitBundle(**data)


@router.get("/runs/{run_id}/handoffs", response_model=list[AgentHandoffView])
def get_handoffs(
    run_id: str,
    latest_per_agent: bool = Query(True),
    principal: Principal = _READ,
) -> list[AgentHandoffView]:
    _require_run(run_id)
    return [
        AgentHandoffView(**h)
        for h in cockpit_svc.list_handoffs(run_id, latest_per_agent=latest_per_agent)
    ]


@router.get("/runs/{run_id}/timeline", response_model=TimelineResponse)
def get_timeline(
    run_id: str,
    principal: Principal = _READ,
) -> TimelineResponse:
    _require_run(run_id)
    return TimelineResponse(**cockpit_svc.timeline(run_id))


@router.get("/runs/{run_id}/evidence-graph", response_model=EvidenceGraphResponse)
def get_evidence_graph(
    run_id: str,
    principal: Principal = _READ,
) -> EvidenceGraphResponse:
    _require_run(run_id)
    return EvidenceGraphResponse(**cockpit_svc.evidence_graph(run_id))


@router.get("/runs/{run_id}/employees", response_model=list[EmployeeListItem])
def get_employees(
    run_id: str,
    principal: Principal = _READ,
) -> list[EmployeeListItem]:
    _require_run(run_id)
    return [EmployeeListItem(**e) for e in cockpit_svc.list_employees(run_id)]


@router.get("/runs/{run_id}/employees/{employee_ref}", response_model=EmployeeDetail)
def get_employee(
    run_id: str,
    employee_ref: str,
    principal: Principal = _READ,
) -> EmployeeDetail:
    _require_run(run_id)
    detail = cockpit_svc.employee_detail(run_id, employee_ref)
    if not detail:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="employee not found in run")
    return EmployeeDetail(**detail)


@router.get("/runs/{run_id}/scenarios", response_model=list[ScenarioView])
def get_scenarios(
    run_id: str,
    principal: Principal = _READ,
) -> list[ScenarioView]:
    _require_run(run_id)
    return [ScenarioView(**s) for s in cockpit_svc.list_scenarios(run_id)]


@router.get("/runs/{run_id}/sessions", response_model=list[TrainingSessionView])
def get_sessions(
    run_id: str,
    principal: Principal = _READ,
) -> list[TrainingSessionView]:
    _require_run(run_id)
    return [TrainingSessionView(**s) for s in cockpit_svc.list_sessions(run_id)]


@router.get("/runs/{run_id}/assignments", response_model=list[ScheduleAssignmentView])
def get_assignments(
    run_id: str,
    principal: Principal = _READ,
) -> list[ScheduleAssignmentView]:
    _require_run(run_id)
    return [ScheduleAssignmentView(**a) for a in cockpit_svc.list_assignments(run_id)]


@router.get("/runs/{run_id}/assurance", response_model=list[AssuranceSnapshotView])
def get_assurance(
    run_id: str,
    principal: Principal = _READ,
) -> list[AssuranceSnapshotView]:
    _require_run(run_id)
    return [AssuranceSnapshotView(**a) for a in cockpit_svc.list_assurance(run_id)]


@router.get("/runs/{run_id}/approval", response_model=ApprovalDecisionView | None)
def get_approval(
    run_id: str,
    principal: Principal = _READ,
) -> ApprovalDecisionView | None:
    _require_run(run_id)
    row = cockpit_svc.latest_approval(run_id)
    return ApprovalDecisionView(**row) if row else None


@router.get("/runs/{run_id}/approvals", response_model=list[ApprovalDecisionView])
def get_approvals(
    run_id: str,
    limit: int = Query(50, ge=1, le=200),
    principal: Principal = _READ,
) -> list[ApprovalDecisionView]:
    """Full approval history (latest-first), including revise/reject/approve after re-arm."""
    _require_run(run_id)
    return [
        ApprovalDecisionView(**r)
        for r in cockpit_svc.list_approvals(run_id, limit=limit)
    ]


@router.get(
    "/runs/{run_id}/options/{option_key}",
    response_model=PortfolioOptionDetail,
)
def get_option_detail(
    run_id: str,
    option_key: str,
    principal: Principal = _READ,
) -> PortfolioOptionDetail:
    _require_run(run_id)
    row = cockpit_svc.get_option_detail(run_id, option_key)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="option not found")
    return PortfolioOptionDetail(**row)

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.schemas.api import (
    SimulationAttemptRequest,
    SimulationAttemptResponse,
    SimulationSessionStartRequest,
    SimulationTurnRequest,
)
from app.schemas.cockpit import (
    AdaptiveSessionStartResponse,
    AdaptiveSessionView,
    AdaptiveTurnResponse,
)
from app.security.auth import Principal, require_roles
from app.services import adaptive_simulation
from app.services.simulation import submit_attempt

router = APIRouter(prefix="/v1/simulations", tags=["simulations"])

_READ = Depends(
    require_roles("viewer", "analyst", "manager", "compliance", "admin", "mcp_service")
)
_WRITE = Depends(
    require_roles("analyst", "manager", "compliance", "admin", "mcp_service")
)


@router.post("/{scenario_id}/attempts", response_model=SimulationAttemptResponse)
def create_attempt(
    scenario_id: str,
    body: SimulationAttemptRequest,
    principal: Principal = Depends(
        require_roles("analyst", "manager", "compliance", "admin", "mcp_service")
    ),
) -> SimulationAttemptResponse:
    """One-shot attempt (still supported). Prefer adaptive session APIs for multi-turn."""
    try:
        result = submit_attempt(
            scenario_id=scenario_id,
            employee_ref=body.employee_ref,
            responses=body.responses,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return SimulationAttemptResponse(**result)


@router.post("/{scenario_id}/sessions", response_model=AdaptiveSessionStartResponse)
def start_adaptive_session(
    scenario_id: str,
    body: SimulationSessionStartRequest,
    principal: Principal = Depends(
        require_roles("analyst", "manager", "compliance", "admin", "mcp_service")
    ),
) -> AdaptiveSessionStartResponse:
    """Start adaptive multi-turn simulation (LLM dialogue; rubric score at finalize)."""
    try:
        result = adaptive_simulation.start_session(
            scenario_id=scenario_id,
            employee_ref=body.employee_ref,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return AdaptiveSessionStartResponse(**result)


@router.post("/sessions/{session_id}/turns", response_model=AdaptiveTurnResponse)
def adaptive_turn(
    session_id: str,
    body: SimulationTurnRequest,
    principal: Principal = Depends(
        require_roles("analyst", "manager", "compliance", "admin", "mcp_service")
    ),
) -> AdaptiveTurnResponse:
    try:
        result = adaptive_simulation.submit_turn(
            session_id=session_id,
            learner_action=body.learner_action,
            actions=body.actions,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return AdaptiveTurnResponse(**result)


@router.post("/sessions/{session_id}/finalize", response_model=SimulationAttemptResponse)
def finalize_adaptive_session(
    session_id: str,
    principal: Principal = Depends(
        require_roles("analyst", "manager", "compliance", "admin", "mcp_service")
    ),
) -> SimulationAttemptResponse:
    try:
        result = adaptive_simulation.finalize_session(session_id=session_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return SimulationAttemptResponse(**result)


@router.get("/sessions/{session_id}", response_model=AdaptiveSessionView)
def get_adaptive_session(
    session_id: str,
    principal: Principal = _READ,
) -> AdaptiveSessionView:
    """Resume multi-turn transcript after refresh (server source of truth)."""
    row = adaptive_simulation.get_session(session_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="session not found")
    return AdaptiveSessionView(**row)


@router.get(
    "/{scenario_id}/sessions",
    response_model=list[AdaptiveSessionView],
)
def list_scenario_sessions(
    scenario_id: str,
    limit: int = Query(50, ge=1, le=200),
    principal: Principal = _READ,
) -> list[AdaptiveSessionView]:
    return [
        AdaptiveSessionView(**s)
        for s in adaptive_simulation.list_sessions_for_scenario(scenario_id, limit=limit)
    ]


@router.post("/sessions/{session_id}/abandon", response_model=AdaptiveSessionView)
def abandon_adaptive_session(
    session_id: str,
    principal: Principal = _WRITE,
) -> AdaptiveSessionView:
    try:
        row = adaptive_simulation.abandon_session(session_id=session_id)
    except ValueError as exc:
        msg = str(exc)
        code = status.HTTP_404_NOT_FOUND if "not found" in msg else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, detail=msg) from exc
    return AdaptiveSessionView(**row)

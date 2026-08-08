from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.schemas.api import BlastReopenRequest
from app.schemas.cockpit import (
    BlastRadiusResponse,
    BlastReopenResponse,
    EvidenceLineageResponse,
)
from app.security.auth import Principal, require_roles
from app.services import evidence as evidence_svc
from app.services import audit
from app.services import runs as run_store
from app.services.recompile import selective_recompile

router = APIRouter(prefix="/v1", tags=["evidence"])


@router.get("/evidence/{node_id}/lineage", response_model=EvidenceLineageResponse)
def get_lineage(
    node_id: str,
    principal: Principal = Depends(
        require_roles("viewer", "analyst", "manager", "compliance", "admin", "mcp_service")
    ),
) -> EvidenceLineageResponse:
    data = evidence_svc.lineage(node_id)
    if not data["nodes"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="evidence node not found")
    return EvidenceLineageResponse(**data)


@router.get("/runs/{run_id}/blast-radius", response_model=BlastRadiusResponse)
def blast_radius(
    run_id: str,
    framework_code: str = Query(..., examples=["BNM_RMiT"]),
    principal: Principal = Depends(
        require_roles("analyst", "manager", "compliance", "admin", "mcp_service")
    ),
) -> BlastRadiusResponse:
    if not run_store.get_run(run_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="run not found")
    result = evidence_svc.blast_radius(run_id, framework_code)
    audit.append_event(
        run_id=run_id,
        event_type="policy.blast_radius.queried",
        actor_id=principal.subject,
        actor_role=principal.role,
        payload={"framework_code": framework_code, "affected": len(result.get("affected_nodes") or [])},
    )
    return BlastRadiusResponse(**{**result, "run_id": run_id, "framework_code": framework_code})


@router.post("/runs/{run_id}/blast-radius/reopen", response_model=BlastReopenResponse)
def blast_radius_reopen(
    run_id: str,
    body: BlastReopenRequest,
    principal: Principal = Depends(
        require_roles("manager", "compliance", "admin", "mcp_service")
    ),
) -> BlastReopenResponse:
    """Selectively reopen AND recompile affected paths (Challenger+Optimizer), then re-gate approval."""
    if not run_store.get_run(run_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="run not found")
    try:
        result = selective_recompile(
            run_id,
            framework_code=body.framework_code,
            reason=body.reason,
            actor_id=principal.subject,
            actor_role=principal.role,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return BlastReopenResponse(**result)

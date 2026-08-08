from __future__ import annotations

import asyncio
import json
from typing import Annotated, AsyncIterator

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.graph.workflow import (
    execute_run,
    portfolio_version_hash,
    resume_with_decision,
    sync_portfolios_into_checkpoint,
)
from app.schemas.api import (
    CreateRunRequest,
    CreateRunResponse,
    DecisionRequest,
    DecisionResponse,
    ExecuteRunResponse,
    PortfolioOptionView,
    RunDetail,
    RunEvent,
    RunStatusView,
    WhatIfRequest,
)
from app.schemas.cockpit import (
    AssuranceRefreshResponse,
    PortfolioOptionDetail,
    WhatIfResponse,
)
from app.security.crypto import hash_payload
from app.services import cockpit as cockpit_svc
from app.security.auth import Principal, require_roles
from app.services import audit, idempotency, runs as run_store
from app.services.realtime import get_hub, serialize_audit_row
from app.services.trigger import TriggerAdapterError, load_trigger

router = APIRouter(prefix="/v1/runs", tags=["runs"])


@router.post("", response_model=CreateRunResponse)
def create_run(
    body: CreateRunRequest,
    principal: Principal = Depends(require_roles("analyst", "manager", "compliance", "admin", "mcp_service")),
) -> CreateRunResponse:
    try:
        trigger, synthetic = load_trigger(
            trigger_path=body.trigger_path,
            trigger_payload=body.trigger_payload,
            use_synthetic_fallback=body.use_synthetic_fallback,
        )
    except TriggerAdapterError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if body.request_id:
        trigger["request"]["request_id"] = body.request_id

    row = run_store.create_run(
        trigger=trigger,
        actor_id=principal.subject,
        actor_role=principal.role,
    )
    return CreateRunResponse(
        run_id=row["id"],
        thread_id=row["thread_id"],
        request_id=row["request_id"],
        status=row["status"],
        employee_count=row["employee_count"],
        synthetic=row["synthetic"],
    )


@router.post("/{run_id}/execute", response_model=ExecuteRunResponse)
def execute(
    run_id: str,
    principal: Principal = Depends(require_roles("analyst", "manager", "compliance", "admin", "mcp_service")),
) -> ExecuteRunResponse:
    run = run_store.get_run(run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="run not found")
    if run["status"] not in {"created", "failed"}:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"run status {run['status']} cannot execute",
        )
    trigger = run["trigger_payload"]
    # restore hash for agents
    from app.security.crypto import hash_payload

    trigger["_hash"] = hash_payload(
        {
            "request": trigger["request"],
            "employees": trigger["employees"],
            "schema_version": trigger.get("schema_version", "v1"),
        }
    )
    try:
        result = execute_run(run_id, trigger, principal.subject, principal.role)
    except Exception as exc:  # noqa: BLE001
        run_store.update_run_status(run_id, status="failed", current_node="error", error_message=str(exc)[:500])
        audit.append_event(
            run_id=run_id,
            event_type="workflow.failed",
            actor_id=principal.subject,
            actor_role=principal.role,
            payload={"error": str(exc)[:500]},
        )
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"execute failed: {exc}") from exc

    return ExecuteRunResponse(
        run_id=run_id,
        status=result["status"],
        current_node=result.get("current_node"),
        message="Awaiting management approval" if result["status"] == "awaiting_approval" else "Executed",
    )


@router.get("/{run_id}", response_model=RunDetail)
def get_run(
    run_id: str,
    principal: Principal = Depends(require_roles("viewer", "analyst", "manager", "compliance", "admin", "mcp_service")),
) -> RunDetail:
    run = run_store.get_run(run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="run not found")
    # Align with GET /options + cockpit: include assignments / solver_status
    options = cockpit_svc.list_options_with_assignments(run_id)
    return RunDetail(
        id=run["id"],
        request_id=run["request_id"],
        thread_id=run["thread_id"],
        status=run["status"],
        current_node=run.get("current_node"),
        trigger_schema_version=run["trigger_schema_version"],
        employee_count=run["employee_count"],
        selected_option_id=run.get("selected_option_id"),
        created_at=run["created_at"],
        updated_at=run["updated_at"],
        options=[PortfolioOptionView(**o) for o in options],
        latest_events=[RunEvent(**e) for e in run.get("latest_events") or []],
    )


@router.get("/{run_id}/events", response_model=list[RunEvent])
def get_events(
    run_id: str,
    principal: Principal = Depends(require_roles("viewer", "analyst", "manager", "compliance", "admin", "mcp_service")),
) -> list[RunEvent]:
    if not run_store.get_run(run_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="run not found")
    return [RunEvent(**e) for e in audit.list_events(run_id)]


@router.get(
    "/{run_id}/events/stream",
    summary="SSE realtime stream for a run",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": (
                "text/event-stream. Events: connected | status | audit | handoff | heartbeat. "
                "Auth via Authorization / X-Demo-* headers, or EventSource query "
                "`?demo_role=manager&demo_actor=...` / `?access_token=...`."
            ),
            "content": {"text/event-stream": {"schema": {"type": "string"}}},
        }
    },
)
async def stream_run_events(
    run_id: str,
    request: Request,
    principal: Principal = Depends(
        require_roles("viewer", "analyst", "manager", "compliance", "admin", "mcp_service")
    ),
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
    heartbeat_seconds: Annotated[float, Query(ge=5, le=60)] = 15,
) -> StreamingResponse:
    """Push status / audit / handoff updates as Server-Sent Events (true push, not polling).

    Frontend can keep GET /status + /timeline as fallback until EventSource is wired.
    """
    run = run_store.get_run(run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="run not found")

    hub = get_hub()
    queue = hub.subscribe(run_id)

    async def event_generator() -> AsyncIterator[str]:
        try:
            # Snapshot so late subscribers are not empty until next mutation
            options = cockpit_svc.list_options_with_assignments(run_id)
            snapshot = {
                "run_id": run_id,
                "status": run["status"],
                "current_node": run.get("current_node"),
                "updated_at": run["updated_at"].isoformat()
                if hasattr(run.get("updated_at"), "isoformat")
                else run.get("updated_at"),
                "awaiting_approval": run["status"] == "awaiting_approval",
                "portfolio_version": portfolio_version_hash(options) if options else None,
                "error_message": run.get("error_message"),
                "recent_events": [
                    serialize_audit_row(e) for e in (run.get("latest_events") or [])[-20:]
                ],
                "last_event_id_hint": last_event_id,
                "subscriber": principal.subject,
            }
            # Local snapshot only — do not fan-out "connected" to other subscribers
            yield (
                "id: 0\n"
                "event: connected\n"
                f"data: {json.dumps(snapshot, default=str, separators=(',', ':'))}\n\n"
            )

            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=heartbeat_seconds)
                    yield msg.encode()
                except asyncio.TimeoutError:
                    beat = {
                        "run_id": run_id,
                        "ok": True,
                    }
                    yield (
                        "event: heartbeat\n"
                        f"data: {json.dumps(beat, separators=(',', ':'))}\n\n"
                    )
        finally:
            hub.unsubscribe(run_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{run_id}/options", response_model=list[PortfolioOptionDetail])
def get_options(
    run_id: str,
    principal: Principal = Depends(require_roles("viewer", "analyst", "manager", "compliance", "admin", "mcp_service")),
) -> list[PortfolioOptionDetail]:
    if not run_store.get_run(run_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="run not found")
    return [PortfolioOptionDetail(**o) for o in cockpit_svc.list_options_with_assignments(run_id)]


@router.get("/{run_id}/status", response_model=RunStatusView)
def get_run_status(
    run_id: str,
    principal: Principal = Depends(
        require_roles("viewer", "analyst", "manager", "compliance", "admin", "mcp_service")
    ),
) -> RunStatusView:
    """Lightweight status poll — still supported; prefer SSE `/events/stream` for live UI."""
    run = run_store.get_run(run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="run not found")
    options = cockpit_svc.list_options_with_assignments(run_id)
    return RunStatusView(
        run_id=run_id,
        status=run["status"],
        current_node=run.get("current_node"),
        updated_at=run["updated_at"],
        awaiting_approval=run["status"] == "awaiting_approval",
        portfolio_version=portfolio_version_hash(options) if options else None,
        error_message=run.get("error_message"),
    )


@router.post("/{run_id}/decision", response_model=DecisionResponse)
def decide(
    run_id: str,
    body: DecisionRequest,
    principal: Principal = Depends(require_roles("manager", "admin", "mcp_service")),
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> DecisionResponse:
    run = run_store.get_run(run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="run not found")

    actor_id = principal.subject
    actor_role = principal.role
    if principal.role == "mcp_service":
        if not body.acting_manager_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="MCP decisions require acting_manager_id for audit attribution",
            )
        actor_id = body.acting_manager_id
        actor_role = "manager"

    request_fingerprint = {
        "option_key": body.option_key,
        "decision": body.decision,
        "rationale": body.rationale,
        "conditions": body.conditions,
        "return_to_stage": body.return_to_stage,
        "expected_portfolio_version": body.expected_portfolio_version,
        "actor_id": actor_id,
    }
    req_hash = hash_payload(request_fingerprint)
    scope = f"decision:{run_id}"
    if idempotency_key:
        cached = idempotency.get_cached(scope, idempotency_key)
        if cached:
            if cached["request_hash"] != req_hash:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail="Idempotency-Key reused with a different decision payload",
                )
            return DecisionResponse(**cached["response"])

    if run["status"] != "awaiting_approval":
        audit.append_event(
            run_id=run_id,
            event_type="approval.bypass_attempt",
            actor_id=principal.subject,
            actor_role=principal.role,
            payload={"status": run["status"], "attempted_decision": body.decision},
        )
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Decision only allowed when status=awaiting_approval",
        )

    # Re-hydrate checkpoint from DB so what-if apply is the approval source of truth
    try:
        sync = sync_portfolios_into_checkpoint(run_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    current_version = sync["portfolio_version"]
    if (
        body.expected_portfolio_version
        and body.expected_portfolio_version != current_version
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "message": "Stale portfolio version — refresh options (what-if may have changed)",
                "expected": body.expected_portfolio_version,
                "current": current_version,
            },
        )

    option = next(
        (o for o in sync["portfolios"] if o["option_key"] == body.option_key),
        None,
    )
    if not option:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unknown option_key")
    if body.decision == "approve" and not option["hard_constraint_ok"]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Cannot approve option that violates hard constraints",
        )
    # Plan §4.5 — critical Challenger objections block approval entry
    critical_flags = [
        f
        for f in (option.get("challenger_flags") or [])
        if str(f.get("severity", "")).lower() in {"critical", "high"}
        and "veto" in str(f.get("message", "")).lower()
    ]
    # Any explicit critical severity always blocks
    critical_flags += [
        f
        for f in (option.get("challenger_flags") or [])
        if str(f.get("severity", "")).lower() == "critical"
    ]
    # dedupe by message
    seen = set()
    uniq_critical = []
    for f in critical_flags:
        key = str(f.get("message"))
        if key in seen:
            continue
        seen.add(key)
        uniq_critical.append(f)
    if body.decision == "approve" and uniq_critical:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={
                "message": "Cannot approve portfolio with critical Challenger objections",
                "flags": uniq_critical,
            },
        )

    decision_payload = {
        "option_key": body.option_key,
        "decision": body.decision,
        "rationale": body.rationale,
        "conditions": body.conditions,
        "actor_id": actor_id,
        "actor_role": actor_role,
        "return_to_stage": body.return_to_stage,
        "portfolio_version": current_version,
    }
    try:
        result = resume_with_decision(run_id, decision_payload)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    resp = DecisionResponse(
        run_id=run_id,
        status=result.get("status") or "unknown",
        decision_id=(result.get("decision") or {}).get("decision_id"),
        message="Decision applied",
    )
    if idempotency_key:
        idempotency.put_cached(scope, idempotency_key, req_hash, resp.model_dump())
    return resp


@router.post("/{run_id}/resume", response_model=DecisionResponse)
def resume(
    run_id: str,
    body: DecisionRequest,
    principal: Principal = Depends(require_roles("manager", "admin", "mcp_service")),
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> DecisionResponse:
    """Alias of /decision for WorkBuddy/MCP wording."""
    return decide(run_id, body, principal, idempotency_key)


@router.post("/{run_id}/what-if", response_model=WhatIfResponse)
def what_if(
    run_id: str,
    body: WhatIfRequest,
    principal: Principal = Depends(
        require_roles("analyst", "manager", "compliance", "admin", "mcp_service")
    ),
) -> WhatIfResponse:
    from app.graph.workflow import what_if_recalculate

    try:
        result = what_if_recalculate(
            run_id,
            max_cost_per_employee=body.max_cost_per_employee_myr,
            total_budget=body.total_budget_myr,
            min_operational_coverage=body.min_operational_coverage_ratio,
            apply=body.apply,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    portfolios = result["portfolios"]
    ids = result.get("portfolio_ids") or {}
    return WhatIfResponse(
        run_id=run_id,
        applied=bool(result.get("applied")),
        checkpoint_synced=bool(result.get("checkpoint_synced")),
        portfolio_version=result.get("portfolio_version"),
        options=[
            PortfolioOptionDetail(
                id=ids.get(p["option_key"]) or ("whatif-" + p["option_key"]),
                option_key=p["option_key"],
                label=p["label"],
                total_cost_myr=p["total_cost_myr"],
                cost_per_employee_myr=p["cost_per_employee_myr"],
                coverage_score=p["coverage_score"],
                risk_reduction_score=p["risk_reduction_score"],
                operational_coverage=p["operational_coverage"],
                hard_constraint_ok=p["hard_constraint_ok"],
                solver_status=p.get("solver_status"),
                challenger_flags=p.get("challenger_flags") or [],
                metrics=p.get("metrics") or {},
                assignments=p.get("assignments") or [],
            )
            for p in portfolios
        ],
    )


@router.post("/{run_id}/assurance/refresh", response_model=AssuranceRefreshResponse)
def assurance_refresh(
    run_id: str,
    principal: Principal = Depends(
        require_roles("analyst", "manager", "compliance", "admin", "mcp_service")
    ),
) -> AssuranceRefreshResponse:
    """Recompute post-training Assurance Monitor (Kirkpatrick + residual risk)."""
    from app.services.assurance import refresh_assurance

    try:
        result = refresh_assurance(run_id, phase="post_training")
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return AssuranceRefreshResponse(**result)

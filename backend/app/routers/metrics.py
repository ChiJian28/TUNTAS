from __future__ import annotations

from fastapi import APIRouter, Depends

from app.schemas.api import MetricsSummary
from app.security.auth import Principal, require_roles
from app.services.runs import metrics_summary

router = APIRouter(prefix="/v1/metrics", tags=["metrics"])


@router.get("/summary", response_model=MetricsSummary)
def summary(
    principal: Principal = Depends(
        require_roles("viewer", "analyst", "manager", "compliance", "admin", "mcp_service")
    ),
) -> MetricsSummary:
    return MetricsSummary(**metrics_summary())

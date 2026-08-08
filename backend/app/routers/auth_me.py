"""Auth identity endpoint for frontend route gating (authoritative role)."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.schemas.api import MeResponse
from app.security.auth import Principal, get_principal

router = APIRouter(prefix="/v1", tags=["auth"])

# Capability strings frontend can use for UX gating (backend still enforces on each route).
_ROLE_PERMISSIONS: dict[str, list[str]] = {
    "viewer": ["runs:read", "cockpit:read", "artifacts:read", "simulations:read"],
    "analyst": [
        "runs:read",
        "runs:write",
        "cockpit:read",
        "what_if",
        "simulations:write",
        "assurance:refresh",
        "artifacts:read",
        "blast:assess",
    ],
    "manager": [
        "runs:read",
        "runs:write",
        "cockpit:read",
        "what_if",
        "decision",
        "simulations:write",
        "assurance:refresh",
        "artifacts:read",
        "blast:assess",
        "blast:reopen",
    ],
    "compliance": [
        "runs:read",
        "runs:write",
        "cockpit:read",
        "what_if",
        "simulations:write",
        "assurance:refresh",
        "artifacts:read",
        "blast:assess",
        "blast:reopen",
    ],
    "admin": ["*"],
    "mcp_service": [
        "runs:read",
        "runs:write",
        "cockpit:read",
        "what_if",
        "decision",
        "simulations:write",
        "assurance:refresh",
        "artifacts:read",
        "blast:assess",
        "blast:reopen",
    ],
}


@router.get("/me", response_model=MeResponse)
async def me(principal: Principal = Depends(get_principal)) -> MeResponse:
    return MeResponse(
        subject=principal.subject,
        role=principal.role,
        email=principal.email,
        auth_mode=principal.auth_mode,
        permissions=_ROLE_PERMISSIONS.get(principal.role, ["runs:read"]),
    )

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Literal

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, Query, status
from jwt import PyJWKClient

from app.config import Settings, get_settings

Role = Literal[
    "viewer",
    "analyst",
    "manager",
    "compliance",
    "admin",
    "mcp_service",
]


@dataclass(frozen=True)
class Principal:
    subject: str
    role: Role
    email: str | None = None
    auth_mode: str = "jwt"


_jwks_client: PyJWKClient | None = None


def _get_jwks_client(settings: Settings) -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(settings.supabase_jwks_url)
    return _jwks_client


def _role_from_claims(claims: dict) -> Role:
    app_meta = claims.get("app_metadata") or {}
    user_meta = claims.get("user_metadata") or {}
    raw = (
        app_meta.get("tuntas_role")
        or user_meta.get("tuntas_role")
        or app_meta.get("role")
        or "viewer"
    )
    if raw not in {"viewer", "analyst", "manager", "compliance", "admin", "mcp_service"}:
        return "viewer"
    return raw  # type: ignore[return-value]


async def get_principal(
    authorization: Annotated[str | None, Header()] = None,
    x_mcp_token: Annotated[str | None, Header(alias="X-MCP-Token")] = None,
    x_demo_role: Annotated[str | None, Header(alias="X-Demo-Role")] = None,
    x_demo_actor: Annotated[str | None, Header(alias="X-Demo-Actor")] = None,
    # Query fallbacks for native EventSource (cannot set custom headers)
    access_token: Annotated[str | None, Query()] = None,
    demo_role: Annotated[str | None, Query()] = None,
    demo_actor: Annotated[str | None, Query()] = None,
    settings: Settings = Depends(get_settings),
) -> Principal:
    if x_mcp_token:
        if not hmac_compare(x_mcp_token, settings.mcp_service_token):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid MCP token")
        return Principal(subject="mcp-service", role="mcp_service", auth_mode="mcp")

    bearer = None
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization.split(" ", 1)[1].strip()
    elif access_token:
        bearer = access_token.strip()

    if bearer:
        try:
            client = _get_jwks_client(settings)
            key = client.get_signing_key_from_jwt(bearer)
            claims = jwt.decode(
                bearer,
                key.key,
                algorithms=["ES256", "RS256"],
                audience=settings.supabase_jwt_audience,
                options={"require": ["exp", "sub"]},
            )
            return Principal(
                subject=str(claims["sub"]),
                role=_role_from_claims(claims),
                email=claims.get("email"),
                auth_mode="jwt",
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid JWT") from exc

    effective_demo_role = x_demo_role or demo_role
    effective_demo_actor = x_demo_actor or demo_actor
    if settings.app_env == "development" and settings.demo_auth_bypass and effective_demo_role:
        role = effective_demo_role if effective_demo_role in {
            "viewer", "analyst", "manager", "compliance", "admin"
        } else "viewer"
        return Principal(
            subject=effective_demo_actor or "demo-user",
            role=role,  # type: ignore[arg-type]
            auth_mode="demo",
        )

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Authentication required")


def require_roles(*allowed: Role):
    async def _dep(principal: Principal = Depends(get_principal)) -> Principal:
        if principal.role not in allowed and principal.role != "admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return principal

    return _dep


def hmac_compare(a: str, b: str) -> bool:
    import hmac as _hmac

    return _hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


async def probe_jwks(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(settings.supabase_jwks_url)
        return r.status_code == 200

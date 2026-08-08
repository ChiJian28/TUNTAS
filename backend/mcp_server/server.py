"""TUNTAS WorkBuddy MCP gateway — separate process/venv from FastAPI.

Whitelisted tools only. Authenticates to backend with MCP_SERVICE_TOKEN.

Run (stdio, for WorkBuddy's local MCP config):
    python server.py

Run (HTTP):
    python server.py --http
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastmcp import FastMCP

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

BACKEND = os.getenv("MCP_BACKEND_BASE_URL", "http://localhost:8001").rstrip("/")
TOKEN = os.getenv("MCP_SERVICE_TOKEN", "")
HOST = os.getenv("MCP_HOST", "0.0.0.0")
PORT = int(os.getenv("MCP_PORT", "8787"))
PATH = os.getenv("MCP_PATH", "/mcp")

mcp = FastMCP("tuntas-workbuddy")


def _headers() -> dict[str, str]:
    if not TOKEN:
        raise RuntimeError("MCP_SERVICE_TOKEN missing")
    return {"X-MCP-Token": TOKEN, "Content-Type": "application/json"}


def _request(method: str, path: str, **kwargs: Any) -> Any:
    url = f"{BACKEND}{path}"
    with httpx.Client(timeout=180.0) as client:
        r = client.request(method, url, headers=_headers(), **kwargs)
        r.raise_for_status()
        return r.json()


@mcp.tool
def start_capability_run(request_id: str = "MYS-GEN-2026-CAP-102") -> dict[str, Any]:
    """Create and execute a TUNTAS capability planning run (synthetic 10-person cohort by default)."""
    created = _request(
        "POST",
        "/v1/runs",
        json={"request_id": request_id, "use_synthetic_fallback": True},
    )
    executed = _request("POST", f"/v1/runs/{created['run_id']}/execute")
    return {"created": created, "executed": executed}


@mcp.tool
def get_run_status(run_id: str) -> dict[str, Any]:
    """Fetch run status, portfolio options, and recent audit events."""
    return _request("GET", f"/v1/runs/{run_id}")


@mcp.tool
def compare_portfolio_options(run_id: str) -> dict[str, Any]:
    """Compare CP-SAT portfolio options for a run."""
    options = _request("GET", f"/v1/runs/{run_id}/options")
    return {"run_id": run_id, "options": options}


@mcp.tool
def submit_management_decision(
    run_id: str,
    option_key: str,
    decision: str,
    rationale: str,
    conditions_csv: str = "",
    acting_manager_id: str = "workbuddy-manager",
) -> dict[str, Any]:
    """Submit manager approve/reject/revise decision (HITL gate). conditions_csv is comma-separated."""
    conditions = [c.strip() for c in conditions_csv.split(",") if c.strip()]
    return _request(
        "POST",
        f"/v1/runs/{run_id}/decision",
        json={
            "option_key": option_key,
            "decision": decision,
            "rationale": rationale,
            "conditions": conditions,
            "acting_manager_id": acting_manager_id,
        },
    )


@mcp.tool
def explain_readiness(node_id: str) -> dict[str, Any]:
    """Explain evidence lineage for a readiness/evidence node."""
    return _request("GET", f"/v1/evidence/{node_id}/lineage")


@mcp.tool
def export_management_pack(run_id: str) -> dict[str, Any]:
    """List generated management artifacts (DOCX/XLSX/PPTX/PDF/JSON/ICS)."""
    return {"run_id": run_id, "artifacts": _request("GET", f"/v1/runs/{run_id}/artifacts")}


@mcp.tool
def assess_policy_change(
    run_id: str,
    framework_code: str = "BNM_RMiT",
    reopen: bool = True,
    reason: str = "policy_version_change",
) -> dict[str, Any]:
    """Blast-radius query; when reopen=true, selectively recompile affected paths and re-gate approval."""
    radius = _request(
        "GET",
        f"/v1/runs/{run_id}/blast-radius",
        params={"framework_code": framework_code},
    )
    if not reopen:
        return {"radius": radius, "recompiled": None}
    recompiled = _request(
        "POST",
        f"/v1/runs/{run_id}/blast-radius/reopen",
        json={"framework_code": framework_code, "reason": reason},
    )
    return {"radius": radius, "recompiled": recompiled}


@mcp.tool
def what_if_portfolios(
    run_id: str,
    max_cost_per_employee_myr: int = 5000,
    total_budget_myr: int = 50000,
    min_operational_coverage_ratio: float = 0.7,
) -> dict[str, Any]:
    """Instant OR-Tools what-if recalculation without re-running LLM agents."""
    return _request(
        "POST",
        f"/v1/runs/{run_id}/what-if",
        json={
            "max_cost_per_employee_myr": max_cost_per_employee_myr,
            "total_budget_myr": total_budget_myr,
            "min_operational_coverage_ratio": min_operational_coverage_ratio,
        },
    )


@mcp.tool
def refresh_assurance(run_id: str) -> dict[str, Any]:
    """Refresh post-training Assurance Monitor (Kirkpatrick + residual risk) after simulations."""
    return _request("POST", f"/v1/runs/{run_id}/assurance/refresh")


if __name__ == "__main__":
    if "--http" in sys.argv:
        mcp.run(transport="http", host=HOST, port=PORT, path=PATH)
    else:
        mcp.run()  # stdio — what WorkBuddy's local MCP config expects

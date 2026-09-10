"""TUNTAS WorkBuddy MCP gateway — separate process/venv from FastAPI.

Whitelisted tools only. Authenticates to backend with MCP_SERVICE_TOKEN.

Two live playbooks (mutually exclusive):
  Capability Skill: start_capability_run → get_capability_pack → get_review_chain
    → decide_department_gate per human `{Dept} approve` → submit_management_decision
    when commit_unlocked. Never ingest_circular.
  Circular Skill: ingest_circular → assess(reopen=false) → get_impact_brief
    → get_review_chain. Same COMMITted run_id is required. Procurement still
    signs (in-force catalogue vs OR-TC, not an automatic new RFP).
    submit_management_decision only when commit_unlocked. Playbook 2 ends at
    COMMIT. Never assess(reopen=true).

Humans sign gates. Experts paste chat_markdown. MCP never invents 3/7/3.

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

DEFAULT_GATE_RATIONALE = (
    "WorkBuddy human recorded this department gate from TUNTAS materials."
)
DEPT_GATES = frozenset({"compliance", "procurement", "learning", "operations"})

mcp = FastMCP("tuntas-workbuddy")


def _headers() -> dict[str, str]:
    if not TOKEN:
        raise RuntimeError("MCP_SERVICE_TOKEN missing")
    return {"X-MCP-Token": TOKEN, "Content-Type": "application/json"}


def _request(method: str, path: str, *, timeout: float = 180.0, **kwargs: Any) -> Any:
    url = f"{BACKEND}{path}"
    with httpx.Client(timeout=timeout) as client:
        r = client.request(method, url, headers=_headers(), **kwargs)
        try:
            data = r.json()
        except Exception:  # noqa: BLE001
            data = {"detail": r.text}
        if r.is_error:
            return {
                "ok": False,
                "http_status": r.status_code,
                "error": data,
                "instruction": (
                    "Show this error to the human in plain language. Do not invent success. "
                    "If current_gate is present, refresh the review quietly, then continue."
                ),
            }
        return data


def _paste_brief(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {
            "ok": False,
            "instruction": "TUNTAS returned a non-object. Do not invent a brief.",
            "chat_markdown": "TUNTAS did not return a WorkBuddy brief.",
        }
    if raw.get("ok") is False:
        return raw
    return {
        "ok": True,
        "instruction": raw.get("instruction")
        or (
            "Show ONLY chat_markdown to the human. Do not paste instruction, wait_line, "
            "dispatch fields, or tool names. Silently summon dispatch_expert_id when "
            "dispatch_action is summon_once."
        ),
        "chat_markdown": raw.get("chat_markdown") or "",
        "run_id": raw.get("run_id"),
        "view": raw.get("view"),
        "path": raw.get("path"),
        "current_gate": raw.get("current_gate"),
        "commit_unlocked": raw.get("commit_unlocked"),
        "commit_blocked_by": raw.get("commit_blocked_by") or [],
        "run_status": raw.get("run_status"),
        "dispatch_expert_id": raw.get("dispatch_expert_id"),
        "dispatch_expert_name": raw.get("dispatch_expert_name"),
        "dispatch_action": raw.get("dispatch_action"),
        "wait_line": raw.get("wait_line"),
        "human_commands": raw.get("human_commands") or [],
        "evidence_url": raw.get("evidence_url"),
    }


def _slim_options(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict) and raw.get("ok") is False:
        return raw
    options_in = raw
    run_id = None
    extra: dict[str, Any] = {}
    if isinstance(raw, dict) and "options" in raw:
        options_in = raw.get("options")
        run_id = raw.get("run_id")
        extra = {
            "solver_status": raw.get("solver_status"),
            "infeasible_reason": raw.get("infeasible_reason"),
            "applied": raw.get("applied"),
        }
    rows = []
    for opt in options_in or []:
        if not isinstance(opt, dict):
            continue
        rows.append(
            {
                "option_key": opt.get("option_key"),
                "label": opt.get("label"),
                "total_cost_myr": opt.get("total_cost_myr"),
                "cost_per_employee_myr": opt.get("cost_per_employee_myr"),
                "operational_coverage": opt.get("operational_coverage"),
                "hard_constraint_ok": opt.get("hard_constraint_ok"),
                "solver_status": opt.get("solver_status"),
            }
        )
    return {
        "ok": True,
        "instruction": (
            "Quote option_key / solver_status / costs / operational_coverage from this JSON. "
            "Do not invent week-by-week headcount. Assignments are intentionally omitted."
        ),
        "run_id": run_id,
        "options": rows,
        **extra,
    }


@mcp.tool
def start_capability_run(request_id: str = "MYS-GEN-2026-CAP-102") -> dict[str, Any]:
    """ON-STAGE for Skill tuntas-capability-planning only. Create + execute a new TUNTAS capability run (fixture request, 10-person cohort from TUNTAS). FORBIDDEN on circular / OR-TC / Scenario B. After JSON returns, call get_capability_pack then get_review_chain. Do not ingest_circular. Do not invent employee counts."""
    created = _request(
        "POST",
        "/v1/runs",
        json={"request_id": request_id, "use_synthetic_fallback": True},
    )
    if isinstance(created, dict) and created.get("ok") is False:
        return created
    run_id = created.get("run_id")
    executed = _request("POST", f"/v1/runs/{run_id}/execute", timeout=300.0)
    if isinstance(executed, dict) and executed.get("ok") is False:
        return {"ok": False, "created": created, "executed": executed}
    return {
        "ok": True,
        "instruction": (
            "Use run_id from this JSON. Next: get_review_chain. Show ONLY that "
            "chat_markdown to the human. Do not echo this instruction. "
            f"employee_count from TUNTAS is {created.get('employee_count')} — do not replace it."
        ),
        "run_id": run_id,
        "request_id": created.get("request_id"),
        "status": executed.get("status") if isinstance(executed, dict) else None,
        "employee_count": created.get("employee_count"),
        "synthetic": created.get("synthetic"),
    }


@mcp.tool
def get_run_status(run_id: str) -> dict[str, Any]:
    """Lightweight run status. Prefer get_review_chain / get_capability_pack for chat. Do not treat this as a source of 3/7/3 circular counts."""
    raw = _request("GET", f"/v1/runs/{run_id}/status")
    if isinstance(raw, dict) and raw.get("ok") is False:
        return raw
    return {
        "ok": True,
        "instruction": "Quote status from this JSON. Do not invent gates or headcount.",
        "run_id": raw.get("run_id") if isinstance(raw, dict) else run_id,
        "status": raw.get("status") if isinstance(raw, dict) else None,
        "awaiting_approval": raw.get("awaiting_approval") if isinstance(raw, dict) else None,
        "current_node": raw.get("current_node") if isinstance(raw, dict) else None,
        "error_message": raw.get("error_message") if isinstance(raw, dict) else None,
    }


@mcp.tool
def get_capability_pack(run_id: str) -> dict[str, Any]:
    """Backup capability pack. Prefer get_review_chain, which already includes current-gate materials. Show ONLY chat_markdown; never echo instruction/wait_line. FORBIDDEN as a substitute for get_impact_brief on circular demos."""
    return _paste_brief(
        _request("GET", f"/v1/runs/{run_id}/workbuddy-brief", params={"view": "capability"})
    )


@mcp.tool
def compare_portfolio_options(run_id: str) -> dict[str, Any]:
    """Compare CP-SAT portfolio options. Assignments omitted so the model cannot invent week-by-week headcount. Prefer get_capability_pack / get_gate_brief for chat."""
    raw = _request("GET", f"/v1/runs/{run_id}/options")
    if isinstance(raw, dict) and raw.get("ok") is False:
        return raw
    return _slim_options({"run_id": run_id, "options": raw})


@mcp.tool
def get_review_chain(run_id: str) -> dict[str, Any]:
    """Dispatcher brief for Zhong. Show ONLY chat_markdown to the human. Never echo wait_line, instruction, dispatch fields, or tool names. Silently summon dispatch_expert_id when dispatch_action is summon_once. If null, summon nobody. This tool does not write gates."""
    return _paste_brief(
        _request("GET", f"/v1/runs/{run_id}/workbuddy-brief", params={"view": "dispatcher"})
    )


@mcp.tool
def get_gate_brief(run_id: str, gate_key: str) -> dict[str, Any]:
    """Materials for one department gate. If Zhong already showed the table, the specialist adds at most two spoken sentences and must not dump a second copy. Show ONLY chat_markdown. Does not approve the gate. management has no expert — Zhong presents it."""
    key = gate_key.strip().lower()
    allowed = {"compliance", "procurement", "learning", "operations", "management"}
    if key not in allowed:
        return {
            "ok": False,
            "instruction": "Unknown gate_key. Do not invent materials.",
            "chat_markdown": f"Unknown gate_key `{gate_key}`. Allowed: compliance, procurement, learning, operations, management.",
        }
    return _paste_brief(
        _request("GET", f"/v1/runs/{run_id}/workbuddy-brief", params={"view": key})
    )


@mcp.tool
def decide_department_gate(
    run_id: str,
    gate_key: str,
    decision: str,
    rationale: str = DEFAULT_GATE_RATIONALE,
    acting_manager_id: str = "workbuddy-manager",
) -> dict[str, Any]:
    """Record one department gate (compliance | procurement | learning | operations). Call ONLY after the human said `{Dept} approve|reject|revise`. Does NOT write sessions/assignments/artifacts. NEVER use this for Management COMMIT — that is submit_management_decision. After success, paste the returned chat_markdown and summon only the new dispatch_expert_id."""
    key = gate_key.strip().lower()
    if key == "management":
        return {
            "ok": False,
            "instruction": (
                "Management is not a department gate. "
                "Call get_review_chain. If commit_unlocked, wait for "
                "`Management commit Balanced` then submit_management_decision."
            ),
            "chat_markdown": (
                "That is not a department sign-off. If every required department has "
                "already signed, reply **Management commit Balanced**."
            ),
        }
    if key not in DEPT_GATES:
        return {
            "ok": False,
            "instruction": "Unknown gate_key. Do not invent a decision.",
            "chat_markdown": f"Unknown gate_key `{gate_key}`.",
        }
    verb = decision.strip().lower()
    if verb not in {"approve", "reject", "revise"}:
        return {
            "ok": False,
            "instruction": "decision must be approve | reject | revise from the human.",
            "chat_markdown": f"Invalid decision `{decision}`.",
        }
    text = rationale.strip() if rationale.strip() else DEFAULT_GATE_RATIONALE
    if len(text) < 8:
        text = DEFAULT_GATE_RATIONALE
    posted = _request(
        "POST",
        f"/v1/runs/{run_id}/gates/{key}",
        json={
            "decision": verb,
            "rationale": text,
            "acting_manager_id": acting_manager_id,
        },
    )
    if isinstance(posted, dict) and posted.get("ok") is False:
        return posted
    brief = _paste_brief(
        _request("GET", f"/v1/runs/{run_id}/workbuddy-brief", params={"view": "dispatcher"})
    )
    brief["decided_gate"] = key
    brief["decision"] = verb
    return brief


@mcp.tool
def ingest_circular(
    run_id: str,
    framework_code: str = "BNM_ORTC_2026",
    circular_id: str = "BNM-ORTC-2026-1",
    title: str = "Operational Resilience & Fraud-Escalation Training Currency",
    source: str = "lexiang",
    text: str = "",
    use_gold_mapping: bool = True,
) -> dict[str, Any]:
    """Circular Skill only. Ingest OR-TC onto the Evidence Spine of the NAMED existing run_id (including a run whose capability COMMIT already completed). Course and employee membership come from TUNTAS gold mapping, not guessing. Does not mutate in-force sessions. On completed/rejected, re-opens circular department HITL so Compliance approve can proceed. FORBIDDEN on capability-planning demos. Call before assess_policy_change."""
    body: dict[str, Any] = {
        "framework_code": framework_code,
        "circular_id": circular_id,
        "title": title,
        "source": source,
        "use_gold_mapping": use_gold_mapping,
    }
    if text.strip():
        body["text"] = text
    return _request("POST", f"/v1/runs/{run_id}/circulars", json=body)


@mcp.tool
def assess_policy_change(
    run_id: str,
    framework_code: str = "BNM_ORTC_2026",
    reopen: bool = False,
    reason: str = "policy_version_change",
) -> dict[str, Any]:
    """Circular Skill only. Compute circular-scoped blast radius on the NAMED existing run_id (same id as capability COMMIT). Who is affected is decided by the graph. Always reopen=false on this playbook: does not mutate red paths / in-force sessions, but on completed/rejected it DOES re-open department HITL. Never set reopen=true (Playbook 2 has no red-path reopen beat). Never blast BNM_RMiT. Never start_capability_run."""
    return _request(
        "POST",
        f"/v1/runs/{run_id}/policy-change/assess",
        json={
            "framework_code": framework_code,
            "reopen": reopen,
            "reason": reason,
        },
    )


@mcp.tool
def get_impact_brief(
    run_id: str,
    framework_code: str = "BNM_ORTC_2026",
) -> dict[str, Any]:
    """Circular Skill only. Paste chat_markdown verbatim (Expected vs Found). Do not rewrite numbers. Call after assess_policy_change(reopen=false). Do not use on a capability-only run. 3/7/3 is legal only when this JSON's expected vs found match is true."""
    raw = _request(
        "GET",
        f"/v1/runs/{run_id}/impact-brief",
        params={"framework_code": framework_code},
    )
    if isinstance(raw, dict) and raw.get("ok") is False:
        return raw
    return {
        "ok": True,
        "instruction": (
            "Show ONLY chat_markdown to the human. Do not rewrite the Expected vs Found table. "
            "Do not echo instruction or wait_state. Prefer get_review_chain if Zhong already "
            "showed this pack, so the human sees it once."
        ),
        "chat_markdown": raw.get("chat_markdown") or "",
        "headline": raw.get("headline"),
        "expected_vs_found": raw.get("expected_vs_found"),
        "action_brief": raw.get("action_brief"),
        "wait_state": raw.get("wait_state"),
        "approval": raw.get("approval"),
        "run_id": raw.get("run_id"),
        "framework_code": raw.get("framework_code"),
        "featured_red": raw.get("featured_red"),
        "featured_green": raw.get("featured_green"),
    }


@mcp.tool
def open_evidence_spine(
    run_id: str,
    framework_code: str = "BNM_ORTC_2026",
) -> dict[str, Any]:
    """Optional evidence-board URL for inspectors. Do not treat it as the approval UI — humans sign in chat. Do not tell the human they must click it. Circular demos should keep framework BNM_ORTC_2026."""
    return _request(
        "GET",
        f"/v1/runs/{run_id}/evidence-spine",
        params={"framework_code": framework_code},
    )


@mcp.tool
def submit_management_decision(
    run_id: str,
    option_key: str,
    decision: str,
    rationale: str,
    conditions_csv: str = "",
    acting_manager_id: str = "workbuddy-manager",
) -> dict[str, Any]:
    """Management COMMIT (writes schedule). Call ONLY after get_review_chain.commit_unlocked is true AND the human said `Management commit …` / reject / revise. This tool refuses when prior department gates are incomplete. Playbook 2 ends here — do not call assess_policy_change(reopen=true) after COMMIT."""
    chain = _paste_brief(
        _request("GET", f"/v1/runs/{run_id}/workbuddy-brief", params={"view": "dispatcher"})
    )
    if chain.get("ok") is False:
        return chain
    if not chain.get("commit_unlocked"):
        return {
            "ok": False,
            "instruction": (
                "COMMIT blocked. Show ONLY chat_markdown. Silently summon dispatch_expert_id "
                "if present. Do not claim training was scheduled. Do not echo this instruction."
            ),
            "chat_markdown": chain.get("chat_markdown") or "",
            "commit_unlocked": False,
            "current_gate": chain.get("current_gate"),
            "commit_blocked_by": chain.get("commit_blocked_by") or [],
            "wait_line": chain.get("wait_line"),
        }
    verb = decision.strip().lower()
    if verb not in {"approve", "reject", "revise"}:
        return {
            "ok": False,
            "instruction": "decision must be approve | reject | revise from the human.",
            "chat_markdown": f"Invalid management decision `{decision}`.",
        }
    text = rationale.strip()
    if len(text) < 8:
        text = "WorkBuddy human recorded Management COMMIT from TUNTAS pack."
    conditions = [c.strip() for c in conditions_csv.split(",") if c.strip()]
    result = _request(
        "POST",
        f"/v1/runs/{run_id}/decision",
        json={
            "option_key": option_key,
            "decision": verb,
            "rationale": text,
            "conditions": conditions,
            "acting_manager_id": acting_manager_id,
        },
    )
    if isinstance(result, dict) and result.get("ok") is False:
        return result
    return {
        "ok": True,
        "instruction": (
            "COMMIT recorded by TUNTAS. Playbook 2 ends here. Do not call "
            "assess_policy_change(reopen=true). Do not invent session counts."
        ),
        "decision": result,
    }


@mcp.tool
def explain_readiness(node_id: str) -> dict[str, Any]:
    """BACKUP. Explain evidence lineage for one node. Prefer open_evidence_spine / get_impact_brief."""
    return _request("GET", f"/v1/evidence/{node_id}/lineage")


@mcp.tool
def export_management_pack(run_id: str) -> dict[str, Any]:
    """FORBIDDEN on live demos. Do not call from either Skill."""
    return {
        "ok": False,
        "instruction": "export_management_pack is forbidden on the live demo. Do not mention it.",
        "run_id": run_id,
    }


@mcp.tool
def what_if_portfolios(
    run_id: str,
    max_cost_per_employee_myr: int = 5000,
    total_budget_myr: int = 50000,
    min_operational_coverage_ratio: float = 0.7,
    apply: bool = False,
) -> dict[str, Any]:
    """Operations specialist (Hakim) only. OR-Tools what-if. WorkBuddy never silently relaxes coverage. Live conflict beat: first min_operational_coverage_ratio=0.99 (expect INFEASIBLE from JSON), then 0.70. Quote solver_status. Do not invent week-by-week headcount. Assignments omitted. Maximum two calls per demo."""
    raw = _request(
        "POST",
        f"/v1/runs/{run_id}/what-if",
        json={
            "max_cost_per_employee_myr": max_cost_per_employee_myr,
            "total_budget_myr": total_budget_myr,
            "min_operational_coverage_ratio": min_operational_coverage_ratio,
            "apply": apply,
            "allow_coverage_relax": False,
        },
    )
    return _slim_options(raw)


@mcp.tool
def refresh_assurance(run_id: str) -> dict[str, Any]:
    """FORBIDDEN on live demos."""
    return {
        "ok": False,
        "instruction": "refresh_assurance is forbidden on the live demo.",
        "run_id": run_id,
    }


if __name__ == "__main__":
    if "--http" in sys.argv:
        mcp.run(transport="http", host=HOST, port=PORT, path=PATH)
    else:
        mcp.run()  # stdio — what WorkBuddy's local MCP config expects

"""Read models for the Next.js decision cockpit — no LLM, pure DB."""
from __future__ import annotations

import json
from typing import Any

from app.db.session import db_conn
from app.services import audit
from app.services import runs as run_store


def list_runs(*, limit: int = 30) -> list[dict[str, Any]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, request_id, thread_id, status, current_node,
                       trigger_schema_version, selected_option_id::text,
                       created_at, updated_at, error_message,
                       jsonb_array_length(COALESCE(trigger_payload->'employees', '[]'::jsonb)) AS employee_count
                FROM tuntas.workflow_runs
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            return [dict(r) for r in cur.fetchall()]


def list_handoffs(run_id: str, *, latest_per_agent: bool = True) -> list[dict[str, Any]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            if latest_per_agent:
                cur.execute(
                    """
                    SELECT DISTINCT ON (agent_name)
                      id::text, agent_name, input_hash, output_json,
                      citation_coverage::float, latency_ms, model_name, created_at
                    FROM tuntas.agent_handoffs
                    WHERE run_id = %s::uuid
                    ORDER BY agent_name, created_at DESC
                    """,
                    (run_id,),
                )
            else:
                cur.execute(
                    """
                    SELECT id::text, agent_name, input_hash, output_json,
                           citation_coverage::float, latency_ms, model_name, created_at
                    FROM tuntas.agent_handoffs
                    WHERE run_id = %s::uuid
                    ORDER BY created_at ASC
                    """,
                    (run_id,),
                )
            rows = [dict(r) for r in cur.fetchall()]
    # Sort latest-per-agent into demo timeline order
    order = [
        "diagnostic",
        "policy_compiler",
        "vendor_intelligence",
        "learning_architect",
        "challenger",
        "management_secretariat",
        "assurance_monitor",
    ]
    rank = {n: i for i, n in enumerate(order)}
    rows.sort(key=lambda r: (rank.get(r["agent_name"], 99), str(r["created_at"])))
    return rows


def timeline(run_id: str) -> dict[str, Any]:
    """Unified agent + audit timeline for the cockpit."""
    handoffs = list_handoffs(run_id, latest_per_agent=False)
    events = audit.list_events(run_id, limit=200)
    items: list[dict[str, Any]] = []
    for h in handoffs:
        items.append(
            {
                "kind": "handoff",
                "id": h["id"],
                "at": h["created_at"],
                "agent_name": h["agent_name"],
                "latency_ms": h.get("latency_ms"),
                "model_name": h.get("model_name"),
                "citation_coverage": h.get("citation_coverage"),
                "requires_review": bool((h.get("output_json") or {}).get("requires_review")),
                "summary": _handoff_summary(h),
            }
        )
    for e in events:
        items.append(
            {
                "kind": "event",
                "id": e["id"],
                "at": e["created_at"],
                "event_type": e["event_type"],
                "actor_id": e["actor_id"],
                "actor_role": e["actor_role"],
                "payload": e.get("payload") or {},
            }
        )
    items.sort(key=lambda x: str(x.get("at") or ""))
    return {"run_id": run_id, "items": items}


def _handoff_summary(h: dict[str, Any]) -> str:
    out = h.get("output_json") or {}
    payload = out.get("payload") if isinstance(out, dict) else {}
    if not isinstance(payload, dict):
        payload = {}
    for key in ("summary", "decision_brief", "overall_recommendation", "shortlist_notes"):
        if payload.get(key):
            return str(payload[key])[:280]
    return f"{h.get('agent_name')} handoff"


def evidence_graph(run_id: str) -> dict[str, Any]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, node_type, external_ref, label, payload, content_hash, created_at
                FROM tuntas.evidence_nodes
                WHERE run_id = %s::uuid
                ORDER BY created_at
                """,
                (run_id,),
            )
            nodes = [dict(r) for r in cur.fetchall()]
            cur.execute(
                """
                SELECT id::text, from_node_id::text, to_node_id::text, edge_type, weight::float, payload
                FROM tuntas.evidence_edges
                WHERE run_id = %s::uuid
                """,
                (run_id,),
            )
            edges = [dict(r) for r in cur.fetchall()]
    return {"run_id": run_id, "nodes": nodes, "edges": edges}


def list_employees(run_id: str) -> list[dict[str, Any]]:
    run = run_store.get_run(run_id)
    if not run:
        return []
    trigger_emps = list((run.get("trigger_payload") or {}).get("employees") or [])
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT employee_ref, scenario_code, level_awarded, score::float, method, created_at
                FROM tuntas.readiness_evidence
                WHERE run_id = %s::uuid
                ORDER BY created_at DESC
                """,
                (run_id,),
            )
            readiness = [dict(r) for r in cur.fetchall()]
    by_ref: dict[str, list[dict[str, Any]]] = {}
    for r in readiness:
        by_ref.setdefault(r["employee_ref"], []).append(r)
    out = []
    for emp in trigger_emps:
        ref = emp["employee_ref"]
        out.append(
            {
                "employee_ref": ref,
                "pseudonym": emp.get("pseudonym") or ref,
                "role_code": emp.get("role_code"),
                "role_title": emp.get("role_title"),
                "unit": emp.get("unit"),
                "location": emp.get("location"),
                "current_level": emp.get("current_level"),
                "target_level": emp.get("target_level"),
                "availability_pct": emp.get("availability_pct"),
                "competency_gaps": emp.get("competency_gaps") or [],
                "readiness": by_ref.get(ref) or [],
            }
        )
    return out


def employee_detail(run_id: str, employee_ref: str) -> dict[str, Any] | None:
    emps = list_employees(run_id)
    emp = next((e for e in emps if e["employee_ref"] == employee_ref), None)
    if not emp:
        return None
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, assessment_type, competency_code, level_before, level_after,
                       source, evidence_ref, payload, created_at, role_code
                FROM tuntas.assessments
                WHERE run_id = %s::uuid AND employee_ref = %s
                ORDER BY created_at
                """,
                (run_id, employee_ref),
            )
            assessments = [dict(r) for r in cur.fetchall()]
            cur.execute(
                """
                SELECT a.id::text, a.course_code, a.cost_myr::float, s.title, s.starts_at, s.ends_at,
                       s.delivery_mode, s.location, s.capacity
                FROM tuntas.assignments a
                JOIN tuntas.sessions s ON s.id = a.session_id
                WHERE a.run_id = %s::uuid AND a.employee_ref = %s
                ORDER BY s.starts_at
                """,
                (run_id, employee_ref),
            )
            schedule = [dict(r) for r in cur.fetchall()]
            cur.execute(
                """
                SELECT sa.id::text, sa.score::float, sa.level_awarded, sa.feedback, sa.created_at,
                       sc.code AS scenario_code, sc.title AS scenario_title
                FROM tuntas.simulation_attempts sa
                JOIN tuntas.scenarios sc ON sc.id = sa.scenario_id
                WHERE sc.run_id = %s::uuid AND sa.employee_ref = %s
                ORDER BY sa.created_at DESC
                """,
                (run_id, employee_ref),
            )
            attempts = [dict(r) for r in cur.fetchall()]
    return {
        **emp,
        "assessments": assessments,
        "schedule": schedule,
        "simulation_attempts": attempts,
    }


def list_scenarios(run_id: str) -> list[dict[str, Any]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, code, title, role_focus, prompt, rubric
                FROM tuntas.scenarios
                WHERE run_id = %s::uuid
                ORDER BY code
                """,
                (run_id,),
            )
            rows = []
            for r in cur.fetchall():
                d = dict(r)
                if isinstance(d.get("rubric"), str):
                    d["rubric"] = json.loads(d["rubric"])
                d.setdefault("created_at", None)
                rows.append(d)
            return rows


def list_sessions(run_id: str) -> list[dict[str, Any]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, course_code, title, starts_at, ends_at, delivery_mode,
                       location, capacity, metadata
                FROM tuntas.sessions
                WHERE run_id = %s::uuid
                ORDER BY starts_at
                """,
                (run_id,),
            )
            return [dict(r) for r in cur.fetchall()]


def list_assignments(run_id: str) -> list[dict[str, Any]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.id::text, a.employee_ref, a.course_code, a.cost_myr::float,
                       a.session_id::text, s.title AS session_title, s.starts_at, s.ends_at
                FROM tuntas.assignments a
                JOIN tuntas.sessions s ON s.id = a.session_id
                WHERE a.run_id = %s::uuid
                ORDER BY s.starts_at, a.employee_ref
                """,
                (run_id,),
            )
            return [dict(r) for r in cur.fetchall()]


def list_assurance(run_id: str) -> list[dict[str, Any]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, kirkpatrick, residual_risk, control_coverage, created_at
                FROM tuntas.assurance_snapshots
                WHERE run_id = %s::uuid
                ORDER BY created_at DESC
                """,
                (run_id,),
            )
            return [dict(r) for r in cur.fetchall()]


def _normalize_approval_row(row: dict[str, Any]) -> dict[str, Any]:
    d = dict(row)
    cond = d.get("conditions")
    if isinstance(cond, str):
        d["conditions"] = json.loads(cond)
    d["conditions"] = d.get("conditions") or []
    return d


def latest_approval(run_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.id::text, d.decision, d.conditions, d.rationale, d.actor_id, d.actor_role,
                       d.input_hash, d.created_at, o.option_key, o.label AS option_label
                FROM tuntas.approval_decisions d
                JOIN tuntas.portfolio_options o ON o.id = d.option_id
                WHERE d.run_id = %s::uuid
                ORDER BY d.created_at DESC
                LIMIT 1
                """,
                (run_id,),
            )
            row = cur.fetchone()
            return _normalize_approval_row(dict(row)) if row else None


def list_approvals(run_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.id::text, d.decision, d.conditions, d.rationale, d.actor_id, d.actor_role,
                       d.input_hash, d.created_at, o.option_key, o.label AS option_label
                FROM tuntas.approval_decisions d
                JOIN tuntas.portfolio_options o ON o.id = d.option_id
                WHERE d.run_id = %s::uuid
                ORDER BY d.created_at DESC
                LIMIT %s
                """,
                (run_id, limit),
            )
            return [_normalize_approval_row(dict(r)) for r in cur.fetchall()]


def request_summary(run: dict[str, Any], *, portfolio_version: str | None = None) -> dict[str, Any]:
    """Typed constraint/source summary from trigger_payload for cockpit header."""
    trigger = run.get("trigger_payload") or {}
    req = trigger.get("request") or {}
    tw = req.get("training_window") or {}
    source = trigger.get("source")
    employees = trigger.get("employees") or []
    frameworks = (
        req.get("frameworks")
        or req.get("policy_frameworks")
        or req.get("regulatory_frameworks")
        or []
    )
    if isinstance(frameworks, str):
        frameworks = [frameworks]
    return {
        "request_id": run.get("request_id") or req.get("request_id"),
        "source": source,
        "synthetic": source == "synthetic_fallback" or bool(trigger.get("synthetic")),
        "max_budget_per_employee_myr": req.get("max_budget_per_employee_myr"),
        "total_budget_myr": req.get("total_budget_myr"),
        "min_operational_coverage_ratio": req.get("min_operational_coverage_ratio"),
        "training_window_start": tw.get("start") or req.get("training_window_start"),
        "training_window_end": tw.get("end") or req.get("training_window_end"),
        "frameworks": list(frameworks),
        "employee_count": len(employees) if employees else int(run.get("employee_count") or 0),
        "portfolio_version": portfolio_version,
    }


def get_option_detail(run_id: str, option_key: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, option_key, label, total_cost_myr::float,
                       cost_per_employee_myr::float, coverage_score::float,
                       risk_reduction_score::float, operational_coverage::float,
                       hard_constraint_ok, solver_status, assignments, metrics, challenger_flags
                FROM tuntas.portfolio_options
                WHERE run_id = %s::uuid AND option_key = %s
                """,
                (run_id, option_key),
            )
            row = cur.fetchone()
            if not row:
                return None
            d = dict(row)
            if isinstance(d.get("assignments"), str):
                d["assignments"] = json.loads(d["assignments"])
            return d


def list_options_with_assignments(run_id: str) -> list[dict[str, Any]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, option_key, label, total_cost_myr::float,
                       cost_per_employee_myr::float, coverage_score::float,
                       risk_reduction_score::float, operational_coverage::float,
                       hard_constraint_ok, solver_status, assignments, metrics, challenger_flags
                FROM tuntas.portfolio_options
                WHERE run_id = %s::uuid
                ORDER BY option_key
                """,
                (run_id,),
            )
            out = []
            for r in cur.fetchall():
                d = dict(r)
                if isinstance(d.get("assignments"), str):
                    d["assignments"] = json.loads(d["assignments"])
                d["assignments"] = d.get("assignments") or []
                d["challenger_flags"] = d.get("challenger_flags") or []
                d["metrics"] = d.get("metrics") or {}
                out.append(d)
            return out


def cockpit_bundle(run_id: str) -> dict[str, Any] | None:
    """Single first-paint payload for the decision cockpit."""
    run = run_store.get_run(run_id)
    if not run:
        return None
    options = list_options_with_assignments(run_id)
    handoffs = list_handoffs(run_id, latest_per_agent=True)
    assurance = list_assurance(run_id)
    scenarios = list_scenarios(run_id)
    from app.graph.workflow import portfolio_version_hash
    from app.services.artifacts import list_artifacts

    artifacts = list_artifacts(run_id)
    version = portfolio_version_hash(options) if options else None
    return {
        "run": {
            "id": run["id"],
            "request_id": run["request_id"],
            "thread_id": run["thread_id"],
            "status": run["status"],
            "current_node": run.get("current_node"),
            "trigger_schema_version": run["trigger_schema_version"],
            "employee_count": run["employee_count"],
            "selected_option_id": run.get("selected_option_id"),
            "created_at": run["created_at"],
            "updated_at": run["updated_at"],
            "error_message": run.get("error_message"),
            "awaiting_approval": run["status"] == "awaiting_approval",
        },
        "request": request_summary(run, portfolio_version=version),
        "options": options,
        "handoffs": handoffs,
        "latest_events": run.get("latest_events") or [],
        "assurance": assurance[0] if assurance else None,
        "assurance_history": assurance,
        "scenarios": [
            {
                "id": s["id"],
                "code": s["code"],
                "title": s["title"],
                "role_focus": s["role_focus"],
            }
            for s in scenarios
        ],
        "artifacts": artifacts,
        "sessions": list_sessions(run_id),
        "approval": latest_approval(run_id),
        "review": _safe_review(run_id),
        "employee_count": run["employee_count"],
        "portfolio_version": version,
    }


def _safe_review(run_id: str) -> dict[str, Any] | None:
    try:
        from app.services.review_gates import get_chain

        return get_chain(run_id)
    except Exception:  # noqa: BLE001 — cockpit first-paint must not die on gate init
        return None

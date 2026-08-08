from __future__ import annotations

import json
import uuid
from typing import Any

from app.db.session import db_conn
from app.security.crypto import dumps_json
from app.services import audit


def create_run(
    *,
    trigger: dict[str, Any],
    actor_id: str,
    actor_role: str,
) -> dict[str, Any]:
    run_id = str(uuid.uuid4())
    thread_id = f"tuntas-{run_id}"
    request_id = trigger["request"]["request_id"]
    trigger_hash = trigger["_hash"]
    payload = {k: v for k, v in trigger.items() if k != "_hash"}
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tuntas.workflow_runs
                  (id, request_id, thread_id, status, trigger_schema_version,
                   trigger_payload, trigger_hash, current_node, created_by)
                VALUES
                  (%s::uuid, %s, %s, 'created', %s, %s::jsonb, %s, 'intake', %s)
                RETURNING id::text, request_id, thread_id, status, current_node,
                          created_at, updated_at, trigger_schema_version
                """,
                (
                    run_id,
                    request_id,
                    thread_id,
                    trigger.get("schema_version", "v1"),
                    json.dumps(payload),
                    trigger_hash,
                    actor_id,
                ),
            )
            row = dict(cur.fetchone())
        conn.commit()
    audit.append_event(
        run_id=run_id,
        event_type="run.created",
        actor_id=actor_id,
        actor_role=actor_role,
        payload={
            "request_id": request_id,
            "employee_count": len(trigger["employees"]),
            "synthetic": trigger.get("source") == "synthetic_fallback",
        },
    )
    row["employee_count"] = len(trigger["employees"])
    row["synthetic"] = trigger.get("source") == "synthetic_fallback"
    return row


def update_run_status(
    run_id: str,
    *,
    status: str,
    current_node: str | None = None,
    error_message: str | None = None,
    selected_option_id: str | None = None,
) -> None:
    updated_at = None
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE tuntas.workflow_runs
                SET status = %s,
                    current_node = COALESCE(%s, current_node),
                    error_message = %s,
                    selected_option_id = COALESCE(%s::uuid, selected_option_id),
                    updated_at = now()
                WHERE id = %s::uuid
                RETURNING updated_at, current_node
                """,
                (status, current_node, error_message, selected_option_id, run_id),
            )
            row = cur.fetchone()
            if row:
                updated_at = row["updated_at"]
                current_node = row["current_node"]
        conn.commit()
    try:
        from app.services.realtime import publish_run_event

        publish_run_event(
            run_id,
            "status",
            {
                "status": status,
                "current_node": current_node,
                "error_message": error_message,
                "selected_option_id": selected_option_id,
                "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") else updated_at,
                "awaiting_approval": status == "awaiting_approval",
            },
        )
    except Exception:  # noqa: BLE001
        pass


def get_run(run_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, request_id, thread_id, status, current_node,
                       trigger_schema_version, trigger_payload, selected_option_id::text,
                       created_at, updated_at, error_message
                FROM tuntas.workflow_runs WHERE id = %s::uuid
                """,
                (run_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            data = dict(row)
            payload = data.pop("trigger_payload") or {}
            data["employee_count"] = len(payload.get("employees") or [])
            data["trigger_payload"] = payload
            cur.execute(
                """
                SELECT id::text, option_key, label, total_cost_myr::float,
                       cost_per_employee_myr::float, coverage_score::float,
                       risk_reduction_score::float, operational_coverage::float,
                       hard_constraint_ok, challenger_flags, metrics
                FROM tuntas.portfolio_options
                WHERE run_id = %s::uuid
                ORDER BY option_key
                """,
                (run_id,),
            )
            data["options"] = [dict(r) for r in cur.fetchall()]
    data["latest_events"] = audit.list_events(run_id, limit=50)
    return data


def save_handoff(
    run_id: str,
    *,
    agent_name: str,
    input_hash: str,
    output_json: dict[str, Any],
    citation_coverage: float | None,
    latency_ms: int | None,
    model_name: str | None,
) -> None:
    handoff_id = None
    created_at = None
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tuntas.agent_handoffs
                  (run_id, agent_name, input_hash, output_json, citation_coverage, latency_ms, model_name)
                VALUES (%s::uuid, %s, %s, %s::jsonb, %s, %s, %s)
                RETURNING id::text, created_at
                """,
                (
                    run_id,
                    agent_name,
                    input_hash,
                    dumps_json(output_json),
                    citation_coverage,
                    latency_ms,
                    model_name,
                ),
            )
            row = cur.fetchone()
            if row:
                handoff_id = row["id"]
                created_at = row["created_at"]
        conn.commit()
    try:
        from app.services.realtime import publish_run_event

        publish_run_event(
            run_id,
            "handoff",
            {
                "id": handoff_id,
                "agent_name": agent_name,
                "input_hash": input_hash,
                "citation_coverage": citation_coverage,
                "latency_ms": latency_ms,
                "model_name": model_name,
                "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else created_at,
                # Full output stays on GET /handoffs; stream carries pointer + metadata
                "requires_refetch": True,
            },
        )
    except Exception:  # noqa: BLE001
        pass


def save_portfolios(run_id: str, portfolios: list[dict[str, Any]]) -> dict[str, str]:
    """Returns map option_key -> id. ON CONFLICT refreshes all metric columns (what-if)."""
    ids: dict[str, str] = {}
    with db_conn() as conn:
        with conn.cursor() as cur:
            for p in portfolios:
                cur.execute(
                    """
                    INSERT INTO tuntas.portfolio_options
                      (run_id, option_key, label, total_cost_myr, cost_per_employee_myr,
                       coverage_score, risk_reduction_score, operational_coverage,
                       hard_constraint_ok, solver_status, assignments, metrics, challenger_flags)
                    VALUES
                      (%s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)
                    ON CONFLICT (run_id, option_key) DO UPDATE SET
                      label = EXCLUDED.label,
                      total_cost_myr = EXCLUDED.total_cost_myr,
                      cost_per_employee_myr = EXCLUDED.cost_per_employee_myr,
                      coverage_score = EXCLUDED.coverage_score,
                      risk_reduction_score = EXCLUDED.risk_reduction_score,
                      operational_coverage = EXCLUDED.operational_coverage,
                      hard_constraint_ok = EXCLUDED.hard_constraint_ok,
                      solver_status = EXCLUDED.solver_status,
                      assignments = EXCLUDED.assignments,
                      metrics = EXCLUDED.metrics,
                      challenger_flags = EXCLUDED.challenger_flags
                    RETURNING id::text, option_key
                    """,
                    (
                        run_id,
                        p["option_key"],
                        p["label"],
                        p["total_cost_myr"],
                        p["cost_per_employee_myr"],
                        p["coverage_score"],
                        p["risk_reduction_score"],
                        p["operational_coverage"],
                        p["hard_constraint_ok"],
                        p["solver_status"],
                        json.dumps(p.get("assignments") or []),
                        json.dumps(p.get("metrics") or {}),
                        json.dumps(p.get("challenger_flags") or []),
                    ),
                )
                row = cur.fetchone()
                ids[row["option_key"]] = row["id"]
        conn.commit()
    return ids


def save_decision(
    *,
    run_id: str,
    option_id: str,
    decision: str,
    rationale: str,
    conditions: list[str],
    actor_id: str,
    actor_role: str,
    input_hash: str,
) -> str:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tuntas.approval_decisions
                  (run_id, option_id, decision, conditions, rationale, actor_id, actor_role, input_hash)
                VALUES (%s::uuid, %s::uuid, %s, %s::jsonb, %s, %s, %s, %s)
                RETURNING id::text
                """,
                (
                    run_id,
                    option_id,
                    decision,
                    json.dumps(conditions),
                    rationale,
                    actor_id,
                    actor_role,
                    input_hash,
                ),
            )
            decision_id = cur.fetchone()["id"]
        conn.commit()
    return decision_id


def save_sessions(run_id: str, sessions: list[dict[str, Any]], assignments: list[dict[str, Any]]) -> None:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM tuntas.assignments WHERE run_id = %s::uuid", (run_id,))
            cur.execute("DELETE FROM tuntas.sessions WHERE run_id = %s::uuid", (run_id,))
            session_ids: dict[str, str] = {}
            for s in sessions:
                cur.execute(
                    """
                    INSERT INTO tuntas.sessions
                      (run_id, course_code, title, starts_at, ends_at, delivery_mode, location, capacity, metadata)
                    VALUES (%s::uuid, %s, %s, %s::timestamptz, %s::timestamptz, %s, %s, %s, %s::jsonb)
                    RETURNING id::text
                    """,
                    (
                        run_id,
                        s["course_code"],
                        s["title"],
                        s["starts_at"],
                        s["ends_at"],
                        s["delivery_mode"],
                        s.get("location"),
                        s.get("capacity", 30),
                        json.dumps({"employee_refs": s.get("employee_refs") or []}),
                    ),
                )
                session_ids[s["course_code"]] = cur.fetchone()["id"]
            for a in assignments:
                sid = session_ids.get(a["course_code"])
                if not sid:
                    continue
                cur.execute(
                    """
                    INSERT INTO tuntas.assignments
                      (run_id, session_id, employee_ref, course_code, cost_myr)
                    VALUES (%s::uuid, %s::uuid, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (run_id, sid, a["employee_ref"], a["course_code"], a["cost_myr"]),
                )
        conn.commit()


def save_scenarios(run_id: str, scenarios: list[dict[str, Any]]) -> dict[str, str]:
    ids: dict[str, str] = {}
    with db_conn() as conn:
        with conn.cursor() as cur:
            for s in scenarios:
                cur.execute(
                    """
                    INSERT INTO tuntas.scenarios
                      (run_id, code, title, role_focus, rubric, prompt)
                    VALUES (%s::uuid, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (run_id, code) DO UPDATE
                      SET title = EXCLUDED.title, rubric = EXCLUDED.rubric, prompt = EXCLUDED.prompt
                    RETURNING id::text, code
                    """,
                    (
                        run_id,
                        s["code"],
                        s["title"],
                        s["role_focus"],
                        json.dumps(s.get("rubric") or []),
                        s["prompt"],
                    ),
                )
                row = cur.fetchone()
                ids[row["code"]] = row["id"]
        conn.commit()
    return ids


def metrics_summary() -> dict[str, Any]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*)::int AS n FROM tuntas.workflow_runs")
            total = cur.fetchone()["n"]
            cur.execute(
                "SELECT count(*)::int AS n FROM tuntas.workflow_runs WHERE status = 'awaiting_approval'"
            )
            awaiting = cur.fetchone()["n"]
            cur.execute(
                "SELECT count(*)::int AS n FROM tuntas.workflow_runs WHERE status = 'completed'"
            )
            completed = cur.fetchone()["n"]
            cur.execute(
                "SELECT count(*)::int AS n FROM tuntas.portfolio_options WHERE hard_constraint_ok = false"
            )
            violations = cur.fetchone()["n"]
            cur.execute(
                """
                SELECT avg(total_cost_myr / NULLIF(%s,0))::float AS util
                FROM tuntas.portfolio_options
                """,
                (1_250_000,),
            )
            util = cur.fetchone()["util"]
            cur.execute(
                "SELECT avg(citation_coverage)::float AS c FROM tuntas.agent_handoffs WHERE citation_coverage IS NOT NULL"
            )
            cite = cur.fetchone()["c"]
            cur.execute(
                "SELECT count(*)::int AS n FROM tuntas.audit_events WHERE event_type = 'approval.bypass_attempt'"
            )
            bypass = cur.fetchone()["n"]
            cur.execute(
                "SELECT avg(latency_ms)::float AS ms FROM tuntas.agent_handoffs WHERE latency_ms IS NOT NULL"
            )
            avg_latency = cur.fetchone()["ms"]
            # Fraction of expected native artifact types present on completed runs
            cur.execute(
                """
                WITH expected AS (
                  SELECT unnest(ARRAY['docx','xlsx','pptx','pdf','json','ics']) AS t
                ),
                per_run AS (
                  SELECT r.id,
                         (SELECT count(DISTINCT a.artifact_type)::float
                          FROM tuntas.artifacts a
                          JOIN expected e ON e.t = a.artifact_type
                          WHERE a.run_id = r.id)
                         / 6.0 AS completeness
                  FROM tuntas.workflow_runs r
                  WHERE r.status = 'completed'
                )
                SELECT avg(completeness)::float AS c FROM per_run
                """
            )
            art_complete = cur.fetchone()["c"]
    return {
        "runs_total": total,
        "runs_awaiting_approval": awaiting,
        "runs_completed": completed,
        "hard_constraint_violations": violations,
        "avg_budget_utilization": util,
        "citation_coverage_avg": cite,
        "approval_bypass_attempts": bypass,
        "avg_handoff_latency_ms": avg_latency,
        "artifact_completeness_avg": art_complete,
    }

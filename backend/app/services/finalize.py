"""Atomic approval commit + outbox-driven artifact side effects."""
from __future__ import annotations

import json
from typing import Any

from app.db.session import db_conn
from app.security.crypto import hash_payload
from app.services.outbox import enqueue_outbox
from app.services.scheduler import schedule_assignments


def commit_approval_atomically(
    *,
    run_id: str,
    option_id: str,
    option_key: str,
    decision: str,
    rationale: str,
    conditions: list[str],
    actor_id: str,
    actor_role: str,
    assignments: list[dict[str, Any]],
    employees: list[dict[str, Any]],
    training_window: dict[str, Any],
    min_operational_coverage: float,
    portfolios_snapshot: list[dict[str, Any]],
    secretariat_output: dict[str, Any] | None,
    trigger: dict[str, Any],
) -> dict[str, Any]:
    """Single Postgres transaction: decision + sessions + assignments + audit + outbox.

    Artifacts are NOT written here — outbox worker/processor does that after commit.
    """
    input_hash = hash_payload(
        {
            "option_key": option_key,
            "decision": decision,
            "conditions": conditions,
            "assignments": assignments,
        }
    )
    sessions = schedule_assignments(
        assignments,
        window_start=training_window.get("start", "2026-07-01"),
        window_end=training_window.get("end", "2026-09-30"),
        min_operational_coverage=min_operational_coverage,
        employees=employees,
    )

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

            # append-only audit inside same tx
            cur.execute(
                """
                SELECT event_hash FROM tuntas.audit_events
                WHERE run_id = %s::uuid ORDER BY created_at DESC LIMIT 1
                """,
                (run_id,),
            )
            prev = cur.fetchone()
            prev_hash = prev["event_hash"] if prev else None
            event_payload = {
                "decision_id": decision_id,
                "option_key": option_key,
                "input_hash": input_hash,
                "session_count": len(sessions),
            }
            event_hash = hash_payload(
                {
                    "run_id": run_id,
                    "event_type": "approval.approved",
                    "actor_id": actor_id,
                    "actor_role": actor_role,
                    "payload": event_payload,
                    "prev_hash": prev_hash,
                }
            )
            cur.execute(
                """
                INSERT INTO tuntas.audit_events
                  (run_id, event_type, actor_id, actor_role, payload, prev_hash, event_hash)
                VALUES (%s::uuid, 'approval.approved', %s, %s, %s::jsonb, %s, %s)
                """,
                (
                    run_id,
                    actor_id,
                    actor_role,
                    json.dumps(event_payload),
                    prev_hash,
                    event_hash,
                ),
            )

            cur.execute(
                """
                UPDATE tuntas.workflow_runs
                SET status = 'approved_processing',
                    current_node = 'finalize',
                    selected_option_id = %s::uuid,
                    updated_at = now()
                WHERE id = %s::uuid
                """,
                (option_id, run_id),
            )

            enqueue_outbox(
                cur,
                run_id=run_id,
                event_type="export_management_pack",
                payload={
                    "option_key": option_key,
                    "sessions": sessions,
                    "portfolios": portfolios_snapshot,
                    "secretariat": secretariat_output or {},
                    "trigger": {
                        "request": trigger.get("request"),
                        "schema_version": trigger.get("schema_version"),
                        "employees": trigger.get("employees"),
                    },
                },
                idempotency_key=f"{run_id}:export_management_pack:{decision_id}",
            )
        conn.commit()

    return {
        "decision_id": decision_id,
        "input_hash": input_hash,
        "sessions": sessions,
    }


def process_export_outbox(run_id: str) -> list[dict[str, Any]]:
    """Drain pending export_management_pack outbox rows for a run (post-commit side effect)."""
    from app.services.artifacts import export_management_pack
    from app.services.outbox import mark_failed, mark_processed

    artifacts: list[dict[str, Any]] = []
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, payload
                FROM tuntas.outbox
                WHERE run_id = %s::uuid AND event_type = 'export_management_pack' AND status = 'pending'
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                """,
                (run_id,),
            )
            rows = [dict(r) for r in cur.fetchall()]
        conn.commit()

    for row in rows:
        try:
            payload = row["payload"]
            selected = next(
                (
                    p
                    for p in payload.get("portfolios") or []
                    if p.get("option_key") == payload.get("option_key")
                ),
                None,
            )
            arts = export_management_pack(
                run_id,
                trigger=payload.get("trigger") or {},
                portfolios=payload.get("portfolios") or [],
                selected=selected,
                sessions=payload.get("sessions") or [],
                secretariat=payload.get("secretariat"),
            )
            artifacts.extend(arts)
            with db_conn() as conn:
                mark_processed(conn, row["id"])
        except Exception as exc:  # noqa: BLE001
            with db_conn() as conn:
                mark_failed(conn, row["id"], str(exc))
            raise
    return artifacts

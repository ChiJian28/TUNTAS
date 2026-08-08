from __future__ import annotations

from typing import Any

from app.db.session import db_conn
from app.security.crypto import hash_payload


def append_event(
    *,
    run_id: str | None,
    event_type: str,
    actor_id: str,
    actor_role: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = payload or {}
    with db_conn() as conn:
        with conn.cursor() as cur:
            prev_hash = None
            if run_id:
                cur.execute(
                    """
                    SELECT event_hash FROM tuntas.audit_events
                    WHERE run_id = %s::uuid
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (run_id,),
                )
                row = cur.fetchone()
                if row:
                    prev_hash = row["event_hash"]
            event_hash = hash_payload(
                {
                    "run_id": run_id,
                    "event_type": event_type,
                    "actor_id": actor_id,
                    "actor_role": actor_role,
                    "payload": payload,
                    "prev_hash": prev_hash,
                }
            )
            cur.execute(
                """
                INSERT INTO tuntas.audit_events
                  (run_id, event_type, actor_id, actor_role, payload, prev_hash, event_hash)
                VALUES (%s::uuid, %s, %s, %s, %s::jsonb, %s, %s)
                RETURNING id::text, event_type, actor_id, actor_role, payload, created_at, event_hash
                """,
                (
                    run_id,
                    event_type,
                    actor_id,
                    actor_role,
                    __import__("json").dumps(payload),
                    prev_hash,
                    event_hash,
                ),
            )
            row = cur.fetchone()
        conn.commit()
    out = dict(row)
    if run_id:
        try:
            from app.services.realtime import publish_run_event, serialize_audit_row

            publish_run_event(run_id, "audit", {"audit": serialize_audit_row(out)})
        except Exception:  # noqa: BLE001 — realtime must never break audit durability
            pass
    return out


def list_events(run_id: str, limit: int = 100) -> list[dict[str, Any]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, event_type, actor_id, actor_role, payload, created_at
                FROM tuntas.audit_events
                WHERE run_id = %s::uuid
                ORDER BY created_at ASC
                LIMIT %s
                """,
                (run_id, limit),
            )
            return [dict(r) for r in cur.fetchall()]

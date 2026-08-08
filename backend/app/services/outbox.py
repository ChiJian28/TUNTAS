"""Transactional outbox helpers."""
from __future__ import annotations

import json
from typing import Any

from psycopg import Connection


def enqueue_outbox(
    cur,
    *,
    run_id: str,
    event_type: str,
    payload: dict[str, Any],
    idempotency_key: str,
) -> None:
    cur.execute(
        """
        INSERT INTO tuntas.outbox (run_id, event_type, payload, idempotency_key, status)
        VALUES (%s::uuid, %s, %s::jsonb, %s, 'pending')
        ON CONFLICT (idempotency_key) DO NOTHING
        """,
        (run_id, event_type, json.dumps(payload), idempotency_key),
    )


def claim_pending(conn: Connection, limit: int = 10) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, run_id::text, event_type, payload, idempotency_key
            FROM tuntas.outbox
            WHERE status = 'pending'
            ORDER BY created_at
            LIMIT %s
            FOR UPDATE SKIP LOCKED
            """,
            (limit,),
        )
        rows = [dict(r) for r in cur.fetchall()]
    return rows


def mark_processed(conn: Connection, outbox_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tuntas.outbox
            SET status = 'processed', processed_at = now()
            WHERE id = %s::uuid
            """,
            (outbox_id,),
        )
    conn.commit()


def mark_failed(conn: Connection, outbox_id: str, error: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tuntas.outbox
            SET status = 'failed',
                payload = payload || %s::jsonb
            WHERE id = %s::uuid
            """,
            (json.dumps({"last_error": error[:500]}), outbox_id),
        )
    conn.commit()

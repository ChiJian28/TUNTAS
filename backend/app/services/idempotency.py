"""Client Idempotency-Key storage for mutation endpoints (decision retries)."""
from __future__ import annotations

import json
from typing import Any

from app.db.session import db_conn


def get_cached(scope: str, idempotency_key: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT request_hash, response_json
                FROM tuntas.mutation_idempotency
                WHERE scope = %s AND idempotency_key = %s
                """,
                (scope, idempotency_key),
            )
            row = cur.fetchone()
            if not row:
                return None
            resp = row["response_json"]
            if isinstance(resp, str):
                resp = json.loads(resp)
            return {"request_hash": row["request_hash"], "response": resp}


def put_cached(
    scope: str,
    idempotency_key: str,
    request_hash: str,
    response: dict[str, Any],
) -> None:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tuntas.mutation_idempotency
                  (scope, idempotency_key, request_hash, response_json)
                VALUES (%s, %s, %s, %s::jsonb)
                ON CONFLICT (scope, idempotency_key) DO NOTHING
                """,
                (scope, idempotency_key, request_hash, json.dumps(response)),
            )
        conn.commit()

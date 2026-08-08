"""Normalize Supabase / Postgres DSNs for durable psycopg connections."""
from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


def normalize_database_url(url: str) -> str:
    """Ensure sslmode=require + connect_timeout for Supabase pooler DSNs.

    Missing sslmode often works until pooler/idle drops the socket; then writers
    raise ``the connection is closed`` mid-execute (DEF-01).
    """
    raw = (url or "").strip()
    if not raw:
        return raw
    parsed = urlparse(raw)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    # Prefer require; do not downgrade if caller set verify-full / etc.
    mode = (query.get("sslmode") or "").lower()
    if mode in {"", "prefer", "allow", "disable"}:
        query["sslmode"] = "require"
    if "connect_timeout" not in query:
        query["connect_timeout"] = "15"
    # TCP keepalives help long LangGraph runs against Supabase poolers
    query.setdefault("keepalives", "1")
    query.setdefault("keepalives_idle", "30")
    query.setdefault("keepalives_interval", "10")
    query.setdefault("keepalives_count", "5")
    return urlunparse(parsed._replace(query=urlencode(query)))

from __future__ import annotations

import logging
import re

from langgraph.checkpoint.postgres import PostgresSaver
from psycopg import Connection
from psycopg.rows import dict_row

from app.config import get_settings

logger = logging.getLogger(__name__)

_SCHEMA_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_conn: Connection | None = None
_saver: PostgresSaver | None = None


def _connection_alive(conn: Connection | None) -> bool:
    if conn is None:
        return False
    try:
        if conn.closed:
            return False
        conn.execute("SELECT 1")
        return True
    except Exception:  # noqa: BLE001
        return False


def get_checkpointer() -> PostgresSaver:
    """Durable LangGraph checkpointer on Supabase Postgres (not MemorySaver).

    Reconnects when the long-lived socket was closed by the pooler (common
    cause of POST /execute → 500 ``the connection is closed``).
    """
    global _conn, _saver
    if _saver is not None and _connection_alive(_conn):
        return _saver

    # Stale saver — dispose before opening a fresh socket
    if _conn is not None:
        try:
            _conn.close()
        except Exception:  # noqa: BLE001
            pass
    _conn = None
    _saver = None

    settings = get_settings()
    dsn = settings.database_dsn
    schema = settings.langgraph_checkpoint_schema
    if not _SCHEMA_RE.match(schema):
        raise ValueError(f"Invalid LANGGRAPH_CHECKPOINT_SCHEMA: {schema}")

    with Connection.connect(dsn, autocommit=True, row_factory=dict_row) as admin:
        admin.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")

    _conn = Connection.connect(
        dsn,
        autocommit=True,
        prepare_threshold=0,
        options=f"-c search_path={schema},public",
    )
    _saver = PostgresSaver(_conn)
    _saver.setup()
    logger.info("LangGraph PostgresSaver ready schema=%s", schema)
    return _saver


def close_checkpointer() -> None:
    global _conn, _saver
    if _conn is not None:
        try:
            _conn.close()
        except Exception:  # noqa: BLE001
            pass
    _conn = None
    _saver = None

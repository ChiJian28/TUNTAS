from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import get_settings


@lru_cache
def get_pool() -> ConnectionPool:
    settings = get_settings()
    conninfo = settings.database_dsn
    return ConnectionPool(
        conninfo=conninfo,
        min_size=1,
        max_size=8,
        # Drop idle sockets before Supabase pooler kills them silently
        max_idle=120.0,
        # Validate before checkout — avoids "the connection is closed" mid-request
        check=ConnectionPool.check_connection,
        kwargs={
            "row_factory": dict_row,
            "autocommit": False,
        },
        open=True,
    )


@contextmanager
def db_conn() -> Iterator[psycopg.Connection]:
    pool = get_pool()
    with pool.connection() as conn:
        yield conn


def apply_schema() -> None:
    schema_path = Path(__file__).with_name("schema.sql")
    sql = schema_path.read_text(encoding="utf-8")
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def close_pool() -> None:
    pool = get_pool()
    pool.close()
    get_pool.cache_clear()

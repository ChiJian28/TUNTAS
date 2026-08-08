#!/usr/bin/env python3
"""Apply TUNTAS schema to Supabase Postgres."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.db.session import apply_schema, close_pool  # noqa: E402


def main() -> int:
    apply_schema()
    print("schema_applied=OK")
    close_pool()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

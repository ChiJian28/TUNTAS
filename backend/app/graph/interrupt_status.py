"""LangGraph interrupt pending checks — no checkpointer / Postgres import."""
from __future__ import annotations

from typing import Any


class InterruptRearmError(RuntimeError):
    """LangGraph thread is not paused at an approval interrupt after rearm."""


def interrupt_pending(snap: Any) -> bool:
    """True iff LangGraph thread is paused and can accept Command(resume=...)."""
    if snap is None:
        return False
    if getattr(snap, "next", None):
        return True
    if getattr(snap, "tasks", None):
        return True
    if getattr(snap, "interrupts", None):
        return True
    return False


def rearm_result_from_snapshot(
    *,
    run_id: str,
    snap: Any,
    secretariat: dict[str, Any],
    interrupt_pending: bool,
) -> dict[str, Any]:
    """Build the rearm payload from the live snapshot flag — never a literal True."""
    pending = bool(interrupt_pending)
    next_nodes = list(getattr(snap, "next", None) or ())
    return {
        "run_id": run_id,
        "status": "awaiting_approval" if pending else "unknown",
        "interrupted": pending,
        "interrupt_pending": pending,
        "current_node": "await_approval" if pending else None,
        "next": next_nodes,
        "secretariat": secretariat,
    }

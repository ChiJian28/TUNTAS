"""In-process run realtime hub — publish from sync writers, subscribe via SSE.

Single-process demo suitable. Multi-worker deploys need Postgres NOTIFY / Redis later;
document that honestly. Frontend can keep polling as fallback until it wires EventSource.
"""
from __future__ import annotations

import asyncio
import json
import threading
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class RealtimeMessage:
    id: str
    event: str
    data: dict[str, Any]

    def encode(self) -> str:
        payload = json.dumps(self.data, default=str, separators=(",", ":"))
        return f"id: {self.id}\nevent: {self.event}\ndata: {payload}\n\n"


class RunRealtimeHub:
    """Thread-safe fan-out of per-run SSE messages."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._seq = 0
        # run_id -> set of (queue, loop)
        self._subs: dict[str, set[tuple[asyncio.Queue[RealtimeMessage], asyncio.AbstractEventLoop]]] = (
            defaultdict(set)
        )

    def subscribe(self, run_id: str) -> asyncio.Queue[RealtimeMessage]:
        loop = asyncio.get_running_loop()
        q: asyncio.Queue[RealtimeMessage] = asyncio.Queue(maxsize=512)
        with self._lock:
            self._subs[run_id].add((q, loop))
        return q

    def unsubscribe(self, run_id: str, q: asyncio.Queue[RealtimeMessage]) -> None:
        with self._lock:
            bucket = self._subs.get(run_id)
            if not bucket:
                return
            for item in list(bucket):
                if item[0] is q:
                    bucket.discard(item)
            if not bucket:
                self._subs.pop(run_id, None)

    def publish(self, run_id: str, event: str, data: dict[str, Any]) -> str:
        """Publish from sync or async callers. Returns SSE event id."""
        if not run_id:
            return ""
        with self._lock:
            self._seq += 1
            event_id = str(self._seq)
            subscribers = list(self._subs.get(run_id, ()))
        msg = RealtimeMessage(
            id=event_id,
            event=event,
            data={
                **data,
                "run_id": run_id,
                "published_at": _utc_now_iso(),
            },
        )

        def _put(queue: asyncio.Queue[RealtimeMessage]) -> None:
            try:
                queue.put_nowait(msg)
            except asyncio.QueueFull:
                # Drop oldest then retry once — prefer freshness over backlog
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    queue.put_nowait(msg)
                except asyncio.QueueFull:
                    pass

        for queue, loop in subscribers:
            try:
                if loop.is_closed():
                    continue
                loop.call_soon_threadsafe(_put, queue)
            except RuntimeError:
                continue
        return event_id


_hub = RunRealtimeHub()


def get_hub() -> RunRealtimeHub:
    return _hub


def publish_run_event(run_id: str, event: str, data: dict[str, Any] | None = None) -> str:
    return get_hub().publish(run_id, event, data or {})


def serialize_audit_row(row: dict[str, Any]) -> dict[str, Any]:
    created = row.get("created_at")
    if hasattr(created, "isoformat"):
        created = created.isoformat()
    return {
        "id": row.get("id"),
        "event_type": row.get("event_type"),
        "actor_id": row.get("actor_id"),
        "actor_role": row.get("actor_role"),
        "payload": row.get("payload") or {},
        "created_at": created,
        "event_hash": row.get("event_hash"),
    }

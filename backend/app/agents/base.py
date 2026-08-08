from __future__ import annotations

import time
from typing import Any

from app.services.llm import GeminiClient


class AgentResult(dict):
    """Thin dict subclass for agent outputs."""


def timed_llm_json(
    client: GeminiClient,
    *,
    prompt: str,
    schema: dict[str, Any],
    system: str,
    temperature: float = 0.2,
    use_fallback: bool = False,
) -> tuple[dict[str, Any], str, int]:
    t0 = time.perf_counter()
    data, model = client.generate_json(
        prompt=prompt,
        schema=schema,
        system=system,
        temperature=temperature,
        use_fallback=use_fallback,
    )
    ms = int((time.perf_counter() - t0) * 1000)
    return data, model, ms

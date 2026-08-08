from __future__ import annotations

import json
import logging
import time
from typing import Any

from google import genai
from google.genai import types

from app.config import get_settings

logger = logging.getLogger(__name__)


class GeminiClient:
    def __init__(self) -> None:
        settings = get_settings()
        self._client = genai.Client(api_key=settings.gemini_api_key)
        self.model = settings.gemini_model
        self.fallback = settings.gemini_fallback_model
        self.embed_model = settings.gemini_embedding_model
        self.embed_dim = settings.gemini_embedding_dimensions

    def generate_json(
        self,
        *,
        prompt: str,
        schema: dict[str, Any],
        system: str | None = None,
        temperature: float = 0.2,
        use_fallback: bool = False,
        max_attempts: int = 4,
    ) -> tuple[dict[str, Any], str]:
        models = (
            [self.fallback, self.model]
            if use_fallback
            else [self.model, self.fallback]
        )
        # Deduplicate while preserving order
        seen: set[str] = set()
        model_order = []
        for m in models:
            if m not in seen:
                seen.add(m)
                model_order.append(m)

        contents = prompt if not system else f"{system}\n\n{prompt}"
        last_exc: Exception | None = None
        for model in model_order:
            for attempt in range(1, max_attempts + 1):
                try:
                    resp = self._client.models.generate_content(
                        model=model,
                        contents=contents,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=schema,
                            temperature=temperature,
                        ),
                    )
                    data = json.loads(resp.text or "{}")
                    return data, model
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    msg = str(exc)
                    retryable = any(
                        token in msg
                        for token in ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "high demand")
                    )
                    logger.warning(
                        "gemini generate_json failed model=%s attempt=%s/%s retryable=%s err=%s",
                        model,
                        attempt,
                        max_attempts,
                        retryable,
                        msg[:200],
                    )
                    if retryable and attempt < max_attempts:
                        time.sleep(min(2 ** attempt, 12))
                        continue
                    break  # try next model
        assert last_exc is not None
        raise last_exc

    def embed(self, text: str) -> list[float]:
        resp = self._client.models.embed_content(
            model=self.embed_model,
            contents=text,
            config=types.EmbedContentConfig(output_dimensionality=self.embed_dim),
        )
        return list(resp.embeddings[0].values)

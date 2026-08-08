from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.config import get_settings
from app.db.session import db_conn
from app.security.crypto import sha256_hex
from app.services.hrd_claimability import enrich_from_live_evidence, normalize_hrd_fields

logger = logging.getLogger(__name__)


def load_fixture_catalog() -> list[dict[str, Any]]:
    settings = get_settings()
    path = settings.resolve_path(settings.vendor_fixture_path)
    data = json.loads(path.read_text(encoding="utf-8"))
    courses: list[dict[str, Any]] = []
    for provider in data.get("providers", []):
        for course in provider.get("courses", []):
            row = {
                    **course,
                    "provider_code": provider["code"],
                    "provider_name": provider["name"],
                    "provider_country": provider.get("country", "MY"),
                    "provider_website": provider.get("website"),
                    "source": "fixture",
                    # Unknown live quote unless Tavily corroborates a number later
                    "price_status": "FIXTURE_CATALOG",
                "class_capacity": int(course.get("class_capacity") or 30),
                "prerequisite_codes": list(course.get("prerequisite_codes") or []),
                }
            courses.append(normalize_hrd_fields(row))
    return courses


def search_live_vendors(query: str) -> list[dict[str, Any]]:
    """Authenticated Tavily search — raises if key missing when called."""
    settings = get_settings()
    if not settings.tavily_api_key:
        raise RuntimeError("TAVILY_API_KEY is required for live vendor search")

    from tavily import TavilyClient

    client = TavilyClient(api_key=settings.tavily_api_key)
    result = client.search(
        query=query,
        max_results=settings.tavily_max_results,
        search_depth=settings.tavily_search_depth,
        include_answer=False,
    )
    out: list[dict[str, Any]] = []
    for item in result.get("results") or []:
        url = item.get("url") or ""
        title = item.get("title") or ""
        content = item.get("content") or ""
        if not url:
            continue
        out.append(
            {
                "title": title,
                "url": url,
                "snippet": content[:1200],
                "score": item.get("score"),
                "query": query,
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
                "content_hash": sha256_hex(f"{url}|{title}|{content[:800]}"),
                "source": "tavily",
            }
        )
    return out


def persist_vendor_evidence(items: list[dict[str, Any]]) -> int:
    if not items:
        return 0
    n = 0
    with db_conn() as conn:
        with conn.cursor() as cur:
            for item in items:
                cur.execute(
                    """
                    INSERT INTO tuntas.vendor_evidence
                      (source_url, title, snippet, content_hash, fixture, raw, retrieved_at)
                    VALUES (%s, %s, %s, %s, false, %s::jsonb, %s::timestamptz)
                    ON CONFLICT (content_hash) DO UPDATE SET
                      title = EXCLUDED.title,
                      snippet = EXCLUDED.snippet,
                      raw = EXCLUDED.raw,
                      retrieved_at = EXCLUDED.retrieved_at
                    """,
                    (
                        item["url"],
                        item.get("title") or "",
                        item.get("snippet") or "",
                        item["content_hash"],
                        json.dumps(item),
                        item.get("retrieved_at"),
                    ),
                )
                n += 1
        conn.commit()
    return n


def research_vendors(capability_domain: str, frameworks: list[str]) -> dict[str, Any]:
    """Hybrid vendor research: fixture catalog prices + mandatory live Tavily evidence."""
    settings = get_settings()
    fixture_courses = load_fixture_catalog()
    mode = settings.vendor_research_mode
    live: list[dict[str, Any]] = []
    queries_used: list[str] = []

    if mode in {"live", "hybrid"}:
        if not settings.tavily_api_key:
            if mode == "live":
                raise RuntimeError(
                    "VENDOR_RESEARCH_MODE=live requires TAVILY_API_KEY"
                )
            logger.warning("No TAVILY_API_KEY — hybrid degraded to fixture-only")
            mode = "fixture"
        else:
            queries = [
                f"Malaysia banking training course {capability_domain} 2026 price",
                f"AICB AML CFT workshop Malaysia {' '.join(frameworks[:2])} 2026",
                "Asian Banking School fraud detection RegTech training Malaysia 2026",
                "HRD Corp claimable PDPA AI governance banking course Malaysia",
                "EC-Council ECIH Malaysia training price 2026",
            ]
            errors: list[str] = []
            for q in queries:
                queries_used.append(q)
                try:
                    live.extend(search_live_vendors(q))
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{q[:48]}: {exc}")
                    logger.exception("Tavily query failed")
            # Dedupe by URL
            dedup: dict[str, dict[str, Any]] = {}
            for item in live:
                dedup[item["url"]] = item
            live = list(dedup.values())
            if not live:
                raise RuntimeError(
                    "Tavily authenticated but returned zero usable results. "
                    f"errors={errors[:3]}"
                )
            persist_vendor_evidence(live)
            mode = "hybrid" if mode == "hybrid" else "live"

    # Mark fixture prices that still need live quotation corroboration
    for course in fixture_courses:
        if float(course.get("cost_myr") or 0) <= 0:
            course["price_status"] = "QUOTE_REQUIRED"
        elif not live:
            course["price_status"] = "FIXTURE_ONLY"
        else:
            course["price_status"] = "FIXTURE_WITH_LIVE_EVIDENCE"

    courses = enrich_from_live_evidence(fixture_courses, live)

    return {
        "mode_used": mode,
        "courses": courses,
        "live_evidence": live,
        "queries_used": queries_used,
        "live_evidence_count": len(live),
        "tavily_authenticated": bool(settings.tavily_api_key),
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "hrd_claimability_structured": True,
    }

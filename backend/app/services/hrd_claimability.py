"""Structured HRD Corp claimability — not just a Tavily query string."""
from __future__ import annotations

import re
from typing import Any

_CLAIMABLE_RE = re.compile(
    r"(?i)\b(hrd\s*corp|hrdf|claimable|claim\s*able|skm|sbl\s*khas|hrdcorp)\b"
)
_NOT_CLAIMABLE_RE = re.compile(
    r"(?i)\b(not\s+claimable|non[- ]claimable|no\s+hrd|hrd\s+not\s+applicable)\b"
)

ClaimStatus = str  # CLAIMABLE | NOT_CLAIMABLE | UNKNOWN | PARTIAL


def normalize_hrd_fields(course: dict[str, Any]) -> dict[str, Any]:
    """Ensure every course carries structured HRD Corp claim fields."""
    existing = course.get("hrd_corp") if isinstance(course.get("hrd_corp"), dict) else {}
    status = (
        course.get("hrd_corp_claim_status")
        or existing.get("status")
        or ("CLAIMABLE" if course.get("hrd_corp_claimable") is True else None)
        or ("NOT_CLAIMABLE" if course.get("hrd_corp_claimable") is False else None)
        or existing.get("claim_status")
        or "UNKNOWN"
    )
    status = str(status).upper()
    if status not in {"CLAIMABLE", "NOT_CLAIMABLE", "UNKNOWN", "PARTIAL"}:
        status = "UNKNOWN"
    claimable = status == "CLAIMABLE"
    if status == "PARTIAL":
        claimable = None  # partial / conditional
    out = {
        **course,
        "hrd_corp_claimable": claimable if status != "UNKNOWN" else None,
        "hrd_corp_claim_status": status,
        "hrd_corp_scheme": course.get("hrd_corp_scheme")
        or existing.get("scheme")
        or ("HRD Corp" if status in {"CLAIMABLE", "PARTIAL"} else None),
        "hrd_corp_evidence_urls": list(
            course.get("hrd_corp_evidence_urls")
            or existing.get("evidence_urls")
            or (
                [course["evidence_url"]]
                if course.get("evidence_url") and status != "UNKNOWN"
                else []
            )
        ),
        "hrd_corp": {
            "claimable": claimable,
            "status": status,
            "scheme": course.get("hrd_corp_scheme") or existing.get("scheme"),
            "evidence_urls": list(
                course.get("hrd_corp_evidence_urls") or existing.get("evidence_urls") or []
            ),
            "evidence_basis": course.get("hrd_corp_evidence_basis")
            or existing.get("evidence_basis")
            or "fixture",
            "notes": course.get("hrd_corp_notes") or existing.get("notes") or "",
        },
    }
    return out


def enrich_from_live_evidence(
    courses: list[dict[str, Any]],
    live_evidence: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Upgrade UNKNOWN claim status when Tavily snippets mention HRD Corp."""
    blob = " ".join(
        f"{e.get('title','')} {e.get('snippet','')} {e.get('query','')}"
        for e in live_evidence or []
    )
    hrd_urls = [
        e.get("url")
        for e in (live_evidence or [])
        if e.get("url") and _CLAIMABLE_RE.search(f"{e.get('title','')} {e.get('snippet','')}")
    ]
    out = []
    for course in courses:
        c = normalize_hrd_fields(course)
        if c["hrd_corp_claim_status"] != "UNKNOWN":
            out.append(c)
            continue
        provider = f"{c.get('provider_name','')} {c.get('title','')} {c.get('code','')}"
        local = c.get("provider_country") == "MY" and c.get("data_residency") == "MY"
        if _NOT_CLAIMABLE_RE.search(blob) and local:
            c["hrd_corp_claim_status"] = "UNKNOWN"  # conflicting signals stay unknown
        elif _CLAIMABLE_RE.search(blob) and local:
            c["hrd_corp_claim_status"] = "PARTIAL"
            c["hrd_corp_claimable"] = None
            c["hrd_corp_scheme"] = "HRD Corp (live-corroborated, verify claim code)"
            c["hrd_corp_evidence_urls"] = list(
                dict.fromkeys((c.get("hrd_corp_evidence_urls") or []) + hrd_urls)
            )[:5]
            c["hrd_corp_evidence_basis"] = "tavily_live"
            c = normalize_hrd_fields(c)
            c["hrd_corp"]["evidence_basis"] = "tavily_live"
            c["hrd_corp"]["notes"] = "Live web mentions HRD/claimable; status PARTIAL pending claim code."
        elif local and c.get("source") == "fixture":
            # Local MY fixture without explicit flag stays UNKNOWN (honest)
            pass
        out.append(c)
    return out

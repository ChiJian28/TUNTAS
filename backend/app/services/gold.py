"""Grand Final gold contract — `backend/data/grand_final/gold_expected.json`.

Who is affected is not chosen by the LLM. Gold is the answer key.
If gold JSON and running code disagree, code is wrong.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Any

from app.config import BACKEND_ROOT

GOLD_PATH = BACKEND_ROOT / "data" / "grand_final" / "gold_expected.json"
CIRCULAR_PATH = BACKEND_ROOT / "data" / "grand_final" / "circular_bnm_ortc_2026.md"

ACTION_BRIEF: list[dict[str, Any]] = [
    {
        "department": "Compliance",
        "action": "Confirm OR-TC-3.1/3.2/3.3 vs catalogue (Expected vs Found)",
        "blocked_by": "human_gate:compliance",
        "evidence": "Evidence Spine",
    },
    {
        "department": "Procurement",
        "action": "Confirm in-force vendors can cover OR-TC; no new RFP unless the catalogue fails. Challenger vetoes still apply.",
        "blocked_by": "human_gate:procurement",
        "evidence": "Challenger + in-force catalogue",
    },
    {
        "department": "L&D",
        "action": "Replace only the stale programmes returned by TUNTAS",
        "blocked_by": "human_gate:learning",
        "evidence": "Learning gate",
    },
    {
        "department": "Operations",
        "action": "Keep operational coverage ≥ target while retraining affected staff",
        "blocked_by": "human_gate:operations",
        "evidence": "OR-Tools",
    },
    {
        "department": "Management",
        "action": "Confirm which plan to schedule after the other departments have signed",
        "blocked_by": "human_gate:management",
        "evidence": "HITL COMMIT",
    },
]


@lru_cache(maxsize=1)
def load_gold() -> dict[str, Any]:
    return json.loads(GOLD_PATH.read_text(encoding="utf-8"))


def load_circular_markdown() -> str:
    return CIRCULAR_PATH.read_text(encoding="utf-8")


def gold_for_framework(framework_code: str) -> dict[str, Any] | None:
    gold = load_gold()
    if gold.get("framework_code") == framework_code:
        return gold
    return None


def extract_clause_text(text: str) -> dict[str, dict[str, str]]:
    """Pull OR-TC-3.x headings and bodies from circular markdown. No LLM."""
    pattern = re.compile(r"^### (OR-TC-3\.\d)\s+(.+)$", re.MULTILINE)
    matches = list(pattern.finditer(text or ""))
    out: dict[str, dict[str, str]] = {}
    for i, m in enumerate(matches):
        ref = m.group(1)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text or "")
        out[ref] = {
            "title": m.group(2).strip(),
            "body": (text or "")[start:end].strip(),
        }
    return out


def _count_match(expected: int, found: int) -> dict[str, Any]:
    return {"expected": expected, "found": found, "match": expected == found}


def compare_to_gold(
    *,
    found_stale_course_codes: list[str] | set[str],
    found_affected_employee_refs: list[str] | set[str],
    gold: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Expected vs Found. Does not rewrite membership — gold wins as the scoreboard."""
    gold = gold or load_gold()
    acceptance = gold.get("acceptance") or {}
    expected_stale = set(acceptance.get("found_stale_course_codes_must_equal") or [])
    expected_emp = set(acceptance.get("found_affected_employee_refs_must_equal") or [])
    must_not = set(acceptance.get("must_not_mark_stale") or [])
    counts = gold.get("expected_counts") or {}

    found_stale = set(found_stale_course_codes)
    found_emp = set(found_affected_employee_refs)

    course_fp = sorted(found_stale - expected_stale)
    course_fn = sorted(expected_stale - found_stale)
    emp_fp = sorted(found_emp - expected_emp)
    emp_fn = sorted(expected_emp - found_emp)
    illegal_stale = sorted(found_stale & must_not)

    false_positives = sorted(set(course_fp + emp_fp + illegal_stale))
    false_negatives = sorted(set(course_fn + emp_fn))

    stale_n = len(found_stale)
    emp_n = len(found_emp)
    comparison = {
        "stale_programs": _count_match(int(counts.get("stale_programs", 3)), stale_n),
        "affected_employees": _count_match(
            int(counts.get("affected_employees", 7)), emp_n
        ),
        "false_positives": false_positives,
        "false_negatives": false_negatives,
        "course_false_positives": course_fp,
        "course_false_negatives": course_fn,
        "employee_false_positives": emp_fp,
        "employee_false_negatives": emp_fn,
        "illegal_stale_codes": illegal_stale,
        "set_equal_stale": found_stale == expected_stale,
        "set_equal_employees": found_emp == expected_emp,
    }
    comparison["match"] = (
        comparison["stale_programs"]["match"]
        and comparison["affected_employees"]["match"]
        and comparison["set_equal_stale"]
        and comparison["set_equal_employees"]
        and not false_positives
        and not false_negatives
    )
    return comparison


def featured_red(gold: dict[str, Any] | None = None) -> dict[str, str]:
    gold = gold or load_gold()
    emp = next(
        (e for e in gold.get("affected_employees") or [] if e.get("featured_demo_click")),
        None,
    )
    return {
        "employee_ref": (emp or {}).get("employee_ref") or "EMP-SYN-005",
        "course_code": "ECIH-2026",
    }


def featured_green(gold: dict[str, Any] | None = None) -> dict[str, str]:
    gold = gold or load_gold()
    course = next(
        (c for c in gold.get("green_courses") or [] if c.get("featured_demo_click")),
        None,
    )
    emp = next(
        (e for e in gold.get("unaffected_employees") or [] if e.get("featured_demo_click")),
        None,
    )
    return {
        "course_code": (course or {}).get("code") or "ABS-PDPA-OPS-2026",
        "employee_ref": (emp or {}).get("employee_ref") or "EMP-SYN-009",
    }


def excluded_active_codes(gold: dict[str, Any] | None = None) -> set[str]:
    gold = gold or load_gold()
    codes = {c["code"] for c in gold.get("excluded_from_active_portfolio") or []}
    codes |= set((gold.get("acceptance") or {}).get("must_not_mark_stale") or [])
    return codes


def mapping_triples(gold: dict[str, Any] | None = None) -> list[dict[str, str]]:
    """Locked clause → control → competency → course edges. Not embeddings."""
    gold = gold or load_gold()
    return [
        {
            "clause_ref": c["clause_ref"],
            "title": c.get("title") or c["clause_ref"],
            "control_code": c["maps_to_control"],
            "competency_code": c["maps_to_competency"],
            "course_code": c["stale_course_code"],
        }
        for c in gold.get("clauses") or []
    ]

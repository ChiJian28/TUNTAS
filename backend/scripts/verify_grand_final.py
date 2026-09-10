#!/usr/bin/env python3
"""Grand Final Scenario B checks that ship in the public repo.

`backend/tests/` is gitignored. Run this instead:

    python scripts/verify_grand_final.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.graph.interrupt_status import rearm_result_from_snapshot  # noqa: E402
from app.services.circular import (  # noqa: E402
    circular_employee_course_links,
    format_impact_headline,
    simulate_scoped_blast,
)
from app.services.gold import load_gold  # noqa: E402
from app.services.recompile import (  # noqa: E402
    interrupt_rearmed_from_rearm,
    reopen_employee_subset,
)
from app.services.trigger import load_trigger  # noqa: E402
from app.services.vendors import load_fixture_catalog  # noqa: E402


def _catalog() -> list[dict]:
    courses = load_fixture_catalog()
    for course in courses:
        if (
            "missing_dpa" in (course.get("privacy_flags") or [])
            or course["code"] == "GCX-REGTECH-ULTRA"
        ):
            course["challenger_veto"] = True
    return courses


def main() -> int:
    gold = load_gold()
    acc = gold["acceptance"]
    trigger, _ = load_trigger(use_synthetic_fallback=True)
    catalog = _catalog()
    failures: list[str] = []

    walked = simulate_scoped_blast(
        gold,
        trigger_employees=trigger["employees"],
        catalog_courses=catalog,
    )
    if set(walked["affected_courses"]) != set(acc["found_stale_course_codes_must_equal"]):
        failures.append(f"stale courses {walked['affected_courses']!r}")
    if set(walked["affected_employees"]) != set(acc["found_affected_employee_refs_must_equal"]):
        failures.append(f"affected employees {walked['affected_employees']!r}")
    if "ABS-PDPA-OPS-2026" in walked["affected_courses"]:
        failures.append("PDPA marked stale")
    if "GCX-REGTECH-ULTRA" in walked["affected_courses"]:
        failures.append("GCX marked stale")
    if {"EMP-SYN-007", "EMP-SYN-008", "EMP-SYN-009"} & set(walked["affected_employees"]):
        failures.append("unaffected employees pulled into scoped blast")
    if not walked["expected_vs_found"]["match"]:
        failures.append("expected_vs_found.match is false")

    links = circular_employee_course_links(gold)
    if "EMP-SYN-007" in links or "EMP-SYN-008" in links:
        failures.append("CS employees in gold membership map")

    circular_subset = reopen_employee_subset(
        framework_code="BNM_ORTC_2026",
        blast_employees=acc["found_affected_employee_refs_must_equal"],
        blast_courses=acc["found_stale_course_codes_must_equal"],
        all_employees=trigger["employees"],
        courses=catalog,
    )
    if set(circular_subset) != set(acc["found_affected_employee_refs_must_equal"]):
        failures.append(f"circular reopen subset {circular_subset!r}")
    if "EMP-SYN-007" in circular_subset or "EMP-SYN-008" in circular_subset:
        failures.append("CS employees in circular reopen subset")

    empty = reopen_employee_subset(
        framework_code="BNM_ORTC_2026",
        blast_employees=[],
        blast_courses=acc["found_stale_course_codes_must_equal"],
        all_employees=trigger["employees"],
        courses=catalog,
    )
    if empty:
        failures.append("empty circular blast fell back to a cohort")

    mismatch = format_impact_headline(stale_n=0, affected_n=0, green_n=3, match=False)
    if not mismatch.startswith("0 programmes stale"):
        failures.append(f"headline still hardcoded: {mismatch!r}")
    if "mismatch" not in mismatch:
        failures.append("mismatch headline missing mismatch marker")

    if interrupt_rearmed_from_rearm({"interrupted": False}):
        failures.append("interrupt flag treats interrupted=False as armed")
    if interrupt_rearmed_from_rearm({}):
        failures.append("interrupt flag treats empty rearm as armed")
    if not interrupt_rearmed_from_rearm({"interrupted": True}):
        failures.append("interrupt flag ignores interrupted=True")
    dropped = rearm_result_from_snapshot(
        run_id="verify",
        snap=type("Snap", (), {"next": ()})(),
        secretariat={},
        interrupt_pending=False,
    )
    if dropped["interrupted"] or dropped["interrupt_pending"]:
        failures.append("rearm snapshot helper hardcodes interrupted True")

    if failures:
        print("FAIL")
        for item in failures:
            print(" -", item)
        return 1
    print(
        "OK  scoped blast 3/7 · PDPA/GCX/CS green · reopen red-only · "
        "headline uses found · interrupt flag reads pending"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

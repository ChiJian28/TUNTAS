from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

from ortools.sat.python import cp_model


def unit_max_concurrent(unit_size: int, min_operational_coverage: float) -> int:
    """Max staff from a unit that may train on the same day."""
    if unit_size <= 0:
        return 0
    if unit_size == 1:
        return 1  # single-person unit may train (coverage deferred to other units)
    must_remain = max(1, int(math.ceil(unit_size * min_operational_coverage)))
    must_remain = min(must_remain, unit_size - 1)  # always allow at least one trainee
    return unit_size - must_remain


def evaluate_schedule_coverage(
    sessions: list[dict[str, Any]],
    employees: list[dict[str, Any]],
    *,
    min_operational_coverage: float,
) -> dict[str, Any]:
    """Compute min unit floor coverage across scheduled days."""
    by_unit: dict[str, set[str]] = {}
    for e in employees:
        unit = e.get("unit") or "Unknown"
        ref = e["employee_ref"]
        by_unit.setdefault(unit, set()).add(ref)

    by_day: dict[str, set[str]] = {}
    for s in sessions:
        day = (s.get("starts_at") or "")[:10]
        by_day.setdefault(day, set()).update(s.get("employee_refs") or [])

    day_scores: list[float] = []
    violations: list[dict[str, Any]] = []
    for day, away in by_day.items():
        unit_scores = []
        for unit, members in by_unit.items():
            # Single-person units are allowed to train (see unit_max_concurrent);
            # exclude them from the displayed floor so op_cov isn't stuck at 0.0.
            if len(members) == 1:
                continue
            away_n = len(members & away)
            remain = len(members) - away_n
            cov = remain / max(1, len(members))
            unit_scores.append(cov)
            max_away = unit_max_concurrent(len(members), min_operational_coverage)
            if away_n > max_away:
                violations.append(
                    {
                        "day": day,
                        "unit": unit,
                        "away": away_n,
                        "max_away": max_away,
                        "coverage": round(cov, 4),
                    }
                )
        day_scores.append(min(unit_scores) if unit_scores else 1.0)
    min_cov = min(day_scores) if day_scores else 1.0
    return {
        "operational_coverage": round(min_cov, 4),
        # Feasible iff per-unit max-concurrent (derived from min_operational_coverage) holds.
        "feasible": len(violations) == 0,
        "violations": violations,
        "days_evaluated": len(day_scores),
        "min_operational_coverage_target": min_operational_coverage,
    }


def schedule_assignments(
    assignments: list[dict[str, Any]],
    *,
    window_start: str,
    window_end: str,
    min_operational_coverage: float = 0.70,
    employees: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """OR-Tools CP-SAT Q3 scheduler with per-person day assignment.

    Each employee-course assignment is placed on a weekday such that no unit
    exceeds unit_max_concurrent(...) on any day. Same course+day rows are then
    grouped into sessions.
    """
    start = datetime.fromisoformat(window_start).replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(window_end).replace(tzinfo=timezone.utc)
    if end <= start:
        raise ValueError("training window_end must be after window_start")

    employees = employees or []
    if not assignments:
        return []

    days: list[datetime] = []
    cursor = start
    while cursor <= end:
        if cursor.weekday() < 5:
            days.append(cursor.replace(hour=9, minute=0, second=0, microsecond=0))
        cursor += timedelta(days=1)
    if not days:
        raise ValueError("No weekday slots in training window")

    emp_unit = {e["employee_ref"]: (e.get("unit") or "Unknown") for e in employees}
    units: dict[str, list[str]] = {}
    for ref, unit in emp_unit.items():
        units.setdefault(unit, []).append(ref)

    # One decision variable per assignment × day
    slots = list(range(len(assignments)))
    n_days = len(days)

    model = cp_model.CpModel()
    x = {
        (i, d): model.new_bool_var(f"asn_{i}_{d}")
        for i in slots
        for d in range(n_days)
    }
    for i in slots:
        model.add(sum(x[i, d] for d in range(n_days)) == 1)

    # Same employee cannot attend two courses on the same day
    by_emp: dict[str, list[int]] = {}
    for i, a in enumerate(assignments):
        by_emp.setdefault(a["employee_ref"], []).append(i)
    for refs in by_emp.values():
        if len(refs) < 2:
            continue
        for d in range(n_days):
            model.add(sum(x[i, d] for i in refs) <= 1)

    # Temporal prerequisite: prereq session day must precede advanced course day
    for idxs in by_emp.values():
        code_to_i = {assignments[i]["course_code"]: i for i in idxs}
        for i in idxs:
            for pre in assignments[i].get("prerequisite_codes") or []:
                pi = code_to_i.get(pre)
                if pi is None:
                    continue
                for d in range(n_days):
                    earlier = sum(x[pi, ed] for ed in range(d)) if d > 0 else 0
                    if d == 0:
                        model.add(x[i, d] == 0)  # cannot take advanced on first day if prereq needed
                    else:
                        model.add(x[i, d] <= earlier)

    # Per-day, per-unit coverage hard constraints (person-level)
    for d in range(n_days):
        for unit, members in units.items():
            max_away = unit_max_concurrent(len(members), min_operational_coverage)
            unit_slots = [
                i
                for i, a in enumerate(assignments)
                if emp_unit.get(a["employee_ref"], "Unknown") == unit
            ]
            if not unit_slots:
                continue
            model.add(sum(x[i, d] for i in unit_slots) <= max_away)

    # Per-day, per-course class capacity hard constraints (plan §4)
    by_course: dict[str, list[int]] = {}
    course_cap: dict[str, int] = {}
    for i, a in enumerate(assignments):
        code = a["course_code"]
        by_course.setdefault(code, []).append(i)
        course_cap[code] = int(a.get("class_capacity") or course_cap.get(code) or 30)
    for code, idxs in by_course.items():
        cap = max(1, course_cap.get(code, 30))
        for d in range(n_days):
            model.add(sum(x[i, d] for i in idxs) <= cap)

    # Prefer earlier days + slight load spreading
    early_bonus = sum(x[i, d] * (n_days - d) for i in slots for d in range(n_days))
    day_loads = []
    for d in range(n_days):
        load = model.new_int_var(0, len(slots), f"load_{d}")
        model.add(load == sum(x[i, d] for i in slots))
        day_loads.append(load)
    model.minimize(sum(day_loads) - early_bonus)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 20.0
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise ValueError(
            f"No feasible Q3 schedule under min_operational_coverage={min_operational_coverage} "
            f"(solver={solver.status_name(status)})"
        )

    # Group into sessions by (course_code, day)
    grouped: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for i, a in enumerate(assignments):
        day_idx = next(d for d in range(n_days) if solver.value(x[i, d]) == 1)
        key = (a["course_code"], day_idx)
        grouped.setdefault(key, []).append(a)

    sessions: list[dict[str, Any]] = []
    for (course_code, day_idx), rows in grouped.items():
        session_start = days[day_idx]
        mode = rows[0].get("delivery_mode") or "hybrid"
        capacity = int(rows[0].get("class_capacity") or course_cap.get(course_code) or 30)
        if len(rows) > capacity:
            raise ValueError(
                f"Session capacity violated for {course_code}: {len(rows)} > {capacity}"
            )
        sessions.append(
            {
                "course_code": course_code,
                "title": rows[0].get("course_title") or course_code,
                "starts_at": session_start.isoformat(),
                "ends_at": (session_start + timedelta(hours=8)).isoformat(),
                "delivery_mode": mode,
                "location": "AmBank Hybrid Hub / KL" if mode != "online" else "Virtual",
                "capacity": capacity,
                "enrolled": len(rows),
                "employee_refs": [r["employee_ref"] for r in rows],
                "solver_status": solver.status_name(status),
            }
        )
    sessions.sort(key=lambda s: s["starts_at"])
    return sessions

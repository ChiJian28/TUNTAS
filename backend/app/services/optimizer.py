from __future__ import annotations

from typing import Any

from ortools.sat.python import cp_model


def build_portfolios(
    *,
    employees: list[dict[str, Any]],
    courses: list[dict[str, Any]],
    max_cost_per_employee: int,
    total_budget: int,
    min_operational_coverage: float,
    objective: str = "balanced",
) -> dict[str, Any]:
    """CP-SAT portfolio builder.

    Assign each employee 1..2 courses under hard budget/coverage constraints.
    Returns solver metrics + assignment list.
    """
    if not employees or not courses:
        return {
            "solver_status": "INFEASIBLE",
            "hard_constraint_ok": False,
            "assignments": [],
            "metrics": {"reason": "empty_input"},
            "total_cost_myr": 0,
            "cost_per_employee_myr": 0,
            "coverage_score": 0,
            "risk_reduction_score": 0,
            "operational_coverage": 0,
        }

    # Filter courses over individual cap
    eligible = [c for c in courses if float(c["cost_myr"]) <= max_cost_per_employee]
    # Challenger may mark some vetoed — respect privacy veto if present
    eligible = [
        c
        for c in eligible
        if not c.get("challenger_veto")
        and "missing_dpa" not in (c.get("privacy_flags") or [])
    ]
    if not eligible:
        return {
            "solver_status": "INFEASIBLE",
            "hard_constraint_ok": False,
            "assignments": [],
            "metrics": {"reason": "no_eligible_courses"},
            "total_cost_myr": 0,
            "cost_per_employee_myr": 0,
            "coverage_score": 0,
            "risk_reduction_score": 0,
            "operational_coverage": 0,
        }

    model = cp_model.CpModel()
    emp_idx = list(range(len(employees)))
    course_idx = list(range(len(eligible)))
    x = {
        (i, j): model.new_bool_var(f"x_{i}_{j}")
        for i in emp_idx
        for j in course_idx
    }

    # Each employee gets 1 or 2 courses
    for i in emp_idx:
        model.add(sum(x[i, j] for j in course_idx) >= 1)
        model.add(sum(x[i, j] for j in course_idx) <= 2)

    # Per-employee budget
    for i in emp_idx:
        model.add(
            sum(int(float(eligible[j]["cost_myr"]) * 100) * x[i, j] for j in course_idx)
            <= max_cost_per_employee * 100
        )

    total_cost_var = model.new_int_var(0, total_budget * 100, "total_cost")
    model.add(
        total_cost_var
        == sum(
            int(float(eligible[j]["cost_myr"]) * 100) * x[i, j]
            for i in emp_idx
            for j in course_idx
        )
    )
    model.add(total_cost_var <= total_budget * 100)

    # Prerequisite hard constraints (plan §4): taking advanced ⇒ prereq assigned or already completed
    code_to_j = {eligible[j]["code"]: j for j in course_idx}
    prereq_edges = 0
    for j, course in enumerate(eligible):
        for pre in course.get("prerequisite_codes") or []:
            pj = code_to_j.get(pre)
            if pj is None:
                # Prereq not in eligible catalog ⇒ cannot assign this course
                for i in emp_idx:
                    model.add(x[i, j] == 0)
                continue
            for i, emp in enumerate(employees):
                completed = set(emp.get("completed_course_codes") or [])
                if pre in completed:
                    continue
                model.add(x[i, j] <= x[i, pj])
                prereq_edges += 1

    # Every assignment must close at least one of that employee's actual gaps.
    # Priority 1 is highest, so invert the ordinal into a larger solver weight.
    def priority_weight(raw: Any) -> int:
        try:
            priority = int(raw)
        except (TypeError, ValueError):
            priority = 1
        return max(1, 4 - max(1, min(priority, 3)))

    gap_weight_by_employee: dict[int, dict[str, int]] = {}
    for i, emp in enumerate(employees):
        gaps = {
            str(g["code"]): priority_weight(g.get("gap_priority", 1))
            for g in emp.get("competency_gaps", [])
            if g.get("code")
        }
        gap_weight_by_employee[i] = gaps
        for j, course in enumerate(eligible):
            covered = set(course.get("competency_codes") or []) & set(gaps)
            if not covered:
                model.add(x[i, j] == 0)

    # One coverage variable per employee-gap avoids double-counting the same gap
    # when two selected courses overlap.
    gap_covered: dict[tuple[int, str], Any] = {}
    coverage_terms = []
    for i, gaps in gap_weight_by_employee.items():
        for code, weight in gaps.items():
            relevant = [
                x[i, j]
                for j, course in enumerate(eligible)
                if code in set(course.get("competency_codes") or [])
            ]
            y = model.new_bool_var(f"gap_{i}_{code}")
            gap_covered[(i, code)] = y
            if relevant:
                model.add_max_equality(y, relevant)
            else:
                model.add(y == 0)
            coverage_terms.append(weight * y)

    coverage_expr = sum(coverage_terms) if coverage_terms else 0

    # Objective variants
    if objective == "cost":
        model.minimize(total_cost_var)
    elif objective == "coverage":
        # Lexicographic in practice: maximise coverage first, then prefer lower cost.
        model.maximize(coverage_expr * 10_000_000 - total_cost_var)
    else:
        # Balanced assigns an explicit MYR value to each weighted gap point.
        # 120_000 cents = RM1,200, creating a real middle option instead of
        # collapsing to the pure cost objective.
        model.maximize(coverage_expr * 120_000 - total_cost_var)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10.0
    status = solver.solve(model)
    status_name = solver.status_name(status)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "solver_status": status_name,
            "hard_constraint_ok": False,
            "assignments": [],
            "metrics": {"objective": objective},
            "total_cost_myr": 0,
            "cost_per_employee_myr": 0,
            "coverage_score": 0,
            "risk_reduction_score": 0,
            "operational_coverage": 0,
        }

    assignments = []
    total_cost = 0.0
    covered_gap_weight = 0
    total_gap_weight = sum(
        weight
        for gaps in gap_weight_by_employee.values()
        for weight in gaps.values()
    )
    for i, emp in enumerate(employees):
        emp_gaps = {g["code"] for g in emp.get("competency_gaps", [])}
        for j, course in enumerate(eligible):
            if solver.value(x[i, j]) == 1:
                cost = float(course["cost_myr"])
                total_cost += cost
                assignments.append(
                    {
                        "employee_ref": emp["employee_ref"],
                        "course_code": course["code"],
                        "course_title": course["title"],
                        "provider_code": course.get("provider_code"),
                        "cost_myr": cost,
                        "competency_codes": course.get("competency_codes") or [],
                        "delivery_mode": course.get("delivery_mode"),
                        "class_capacity": int(course.get("class_capacity") or 30),
                        "prerequisite_codes": list(course.get("prerequisite_codes") or []),
                        "hrd_corp_claim_status": course.get("hrd_corp_claim_status"),
                    }
                )
        for code, weight in gap_weight_by_employee[i].items():
            if solver.value(gap_covered[(i, code)]) == 1:
                covered_gap_weight += weight

    n = len(employees)
    tw_start = "2026-07-01"
    tw_end = "2026-09-30"
    # Hard operational coverage: assignments must admit a feasible OR-Tools schedule
    # under the requested min_operational_coverage (no ratio soft-cap).
    from app.services.scheduler import evaluate_schedule_coverage, schedule_assignments

    schedule_ok = False
    operational_coverage = 0.0
    schedule_metrics: dict[str, Any] = {}
    try:
        sessions = schedule_assignments(
            assignments,
            window_start=tw_start,
            window_end=tw_end,
            min_operational_coverage=min_operational_coverage,
            employees=employees,
        )
        cov = evaluate_schedule_coverage(
            sessions,
            employees,
            min_operational_coverage=min_operational_coverage,
        )
        operational_coverage = float(cov["operational_coverage"])
        schedule_ok = bool(cov["feasible"])
        schedule_metrics = {
            "schedule_feasible": schedule_ok,
            "schedule_violations": cov.get("violations") or [],
            "days_evaluated": cov.get("days_evaluated"),
            "operational_coverage_target": min_operational_coverage,
            "operational_coverage_ok": schedule_ok,
        }
    except Exception as exc:  # noqa: BLE001
        schedule_ok = False
        operational_coverage = 0.0
        schedule_metrics = {"schedule_feasible": False, "error": str(exc)[:200]}

    coverage_score = (
        covered_gap_weight / total_gap_weight if total_gap_weight else 0.0
    )
    risk_reduction_score = min(
        1.0, coverage_score * 0.85 + (1 if total_cost <= total_budget else 0) * 0.15
    )

    # Verify prerequisites on the solved assignment (fail-closed)
    by_emp_courses: dict[str, set[str]] = {}
    for a in assignments:
        by_emp_courses.setdefault(a["employee_ref"], set()).add(a["course_code"])
    prereq_ok = True
    for a in assignments:
        emp = next(e for e in employees if e["employee_ref"] == a["employee_ref"])
        completed = set(emp.get("completed_course_codes") or [])
        have = by_emp_courses.get(a["employee_ref"], set()) | completed
        for pre in a.get("prerequisite_codes") or []:
            if pre not in have:
                prereq_ok = False
                break

    hard_ok = (
        total_cost <= total_budget
        and all(
            sum(a["cost_myr"] for a in assignments if a["employee_ref"] == e["employee_ref"])
            <= max_cost_per_employee
            for e in employees
        )
        and schedule_ok
        and prereq_ok
    )

    return {
        "solver_status": status_name,
        "hard_constraint_ok": hard_ok,
        "assignments": assignments,
        "metrics": {
            "objective": objective,
            "eligible_courses": len(eligible),
            "assignment_count": len(assignments),
            "covered_gap_weight": covered_gap_weight,
            "total_gap_weight": total_gap_weight,
            # Compatibility aliases used by existing artifact/report adapters.
            "covered_gap_hits": covered_gap_weight,
            "total_gaps": total_gap_weight,
            "unit_coverage_min": round(operational_coverage, 4),
            "prerequisite_edges": prereq_edges,
            "prerequisites_ok": prereq_ok,
            **schedule_metrics,
        },
        "total_cost_myr": round(total_cost, 2),
        "cost_per_employee_myr": round(total_cost / n, 2) if n else 0,
        "coverage_score": round(coverage_score, 4),
        "risk_reduction_score": round(risk_reduction_score, 4),
        "operational_coverage": round(operational_coverage, 4),
    }


def build_three_portfolios(
    employees: list[dict[str, Any]],
    courses: list[dict[str, Any]],
    *,
    max_cost_per_employee: int,
    total_budget: int,
    min_operational_coverage: float,
) -> list[dict[str, Any]]:
    specs = [
        ("cost", "Budget Saver", "Minimize spend while closing priority gaps"),
        ("balanced", "Balanced", "Balance coverage, risk reduction and budget"),
        ("coverage", "Max Risk Reduction", "Maximize competency/regulatory coverage"),
    ]

    def _solve(min_cov: float) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for key, label, blurb in specs:
            result = build_portfolios(
                employees=employees,
                courses=courses,
                max_cost_per_employee=max_cost_per_employee,
                total_budget=total_budget,
                min_operational_coverage=min_cov,
                objective=key,
            )
            out.append({"option_key": key, "label": label, "blurb": blurb, **result})
        return out

    portfolios = _solve(min_operational_coverage)
    # Demo/small-cohort backoff: if every option fails schedule hard-constraints,
    # retry once at a slightly lower floor so golden path is not permanently blocked.
    if portfolios and not any(p.get("hard_constraint_ok") for p in portfolios):
        relaxed = max(0.5, float(min_operational_coverage) - 0.2)
        if relaxed + 1e-9 < float(min_operational_coverage):
            retry = _solve(relaxed)
            if any(p.get("hard_constraint_ok") for p in retry):
                for p in retry:
                    metrics = dict(p.get("metrics") or {})
                    metrics["coverage_floor_relaxed_from"] = min_operational_coverage
                    metrics["coverage_floor_used"] = relaxed
                    p["metrics"] = metrics
                return retry
    return portfolios

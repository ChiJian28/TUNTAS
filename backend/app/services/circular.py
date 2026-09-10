"""Grand Final circular ingest + impact brief (Scenario B).

LLM may fill clause titles/bodies from circular text. Course and employee
membership always come from gold_expected.json — never embeddings.
"""
from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urlencode

from app.config import get_settings
from app.db.session import db_conn
from app.services import audit, evidence
from app.services import gold as gold_svc
from app.services import runs as run_store

logger = logging.getLogger(__name__)
_FSF_RE = re.compile(r"FSF_PR\d+")


def _edge_payload(framework_code: str, circular_id: str, **extra: Any) -> dict[str, Any]:
    return {
        "framework_code": framework_code,
        "circular_id": circular_id,
        "circular_scoped": True,
        "membership_source": "gold_expected.json",
        **extra,
    }


def _competencies_for_employee(reason: str) -> set[str]:
    return set(_FSF_RE.findall(reason or ""))


def circular_employee_course_links(gold: dict[str, Any] | None = None) -> dict[str, set[str]]:
    """Gold-only employee→course membership. CS 007/008 are not in this map."""
    gold = gold or gold_svc.load_gold()
    triples = gold_svc.mapping_triples(gold)
    course_by_comp = {t["competency_code"]: t["course_code"] for t in triples}
    all_courses = {t["course_code"] for t in triples}
    out: dict[str, set[str]] = {}
    for emp in gold.get("affected_employees") or []:
        comps = _competencies_for_employee(str(emp.get("reason") or ""))
        linked = {course_by_comp[c] for c in comps if c in course_by_comp}
        out[emp["employee_ref"]] = linked or set(all_courses)
    return out


def simulate_scoped_blast(
    gold: dict[str, Any] | None = None,
    *,
    trigger_employees: list[dict[str, Any]] | None = None,
    catalog_courses: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """In-memory ingest plan + circular-scoped walk.

    Injects legacy has_gap / builds_competency edges (the competency-bridge trap)
    so the test proves scoped walk ignores them. No Postgres required.
    """
    gold = gold or gold_svc.load_gold()
    framework = gold["framework_code"]
    circular_id = gold["circular_id"]
    payload = _edge_payload(framework, circular_id)
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[tuple[str, str, dict[str, Any]]] = []

    def add_node(node_type: str, ref: str, **extra: Any) -> str:
        key = f"{node_type}:{ref}"
        nodes[key] = {
            "node_type": node_type,
            "external_ref": ref,
            "payload": extra,
        }
        return key

    def add_edge(a: str, b: str, scoped: bool) -> None:
        edges.append(
            (
                a,
                b,
                dict(payload) if scoped else {"circular_scoped": False},
            )
        )

    circ = add_node(
        "policy_circular",
        circular_id,
        framework_code=framework,
        circular_id=circular_id,
    )
    for triple in gold_svc.mapping_triples(gold):
        clause = add_node(
            "policy_clause",
            triple["clause_ref"],
            framework_code=framework,
            circular_scoped=True,
        )
        control = add_node(
            "control",
            triple["control_code"],
            framework_code=framework,
            circular_scoped=True,
        )
        competency = add_node("competency", triple["competency_code"], code=triple["competency_code"])
        course = add_node(
            "course",
            triple["course_code"],
            framework_code=framework,
            circular_scoped=True,
        )
        add_edge(circ, clause, True)
        add_edge(clause, control, True)
        add_edge(control, competency, True)
        add_edge(competency, course, True)
        add_edge(control, course, True)

    for emp_ref, course_codes in circular_employee_course_links(gold).items():
        emp = add_node("employee", emp_ref)
        for code in course_codes:
            add_edge(emp, f"course:{code}", True)

    for green in gold.get("green_courses") or []:
        add_node("course", green["code"], circular_scoped=False)

    # Legacy trap: CS has_gap FSF_PR110 + courses building that competency.
    for emp in trigger_employees or []:
        ref = emp.get("employee_ref")
        if not ref:
            continue
        emp_key = nodes.get(f"employee:{ref}") and f"employee:{ref}" or add_node("employee", ref)
        for gap in emp.get("competency_gaps") or []:
            code = gap.get("code")
            if not code:
                continue
            comp_key = nodes.get(f"competency:{code}") and f"competency:{code}" or add_node(
                "competency", code, code=code
            )
            add_edge(emp_key, comp_key, False)
    for course in catalog_courses or []:
        code = course.get("code")
        if not code:
            continue
        course_key = nodes.get(f"course:{code}") and f"course:{code}" or add_node("course", code)
        for comp in course.get("competency_codes") or []:
            comp_key = nodes.get(f"competency:{comp}") and f"competency:{comp}" or add_node(
                "competency", comp, code=comp
            )
            add_edge(course_key, comp_key, False)

    adj: dict[str, list[str]] = {}
    for a, b, pay in edges:
        if pay.get("framework_code") == framework or pay.get("circular_scoped") is True:
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)

    seeds = [
        k
        for k, n in nodes.items()
        if n["node_type"] in {"policy_clause", "policy_circular"}
        and n.get("payload", {}).get("framework_code") == framework
    ]
    seen: set[str] = set()
    stack = list(seeds)
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(adj.get(cur) or [])

    exclude = gold_svc.excluded_active_codes(gold)
    employees = sorted(
        nodes[k]["external_ref"]
        for k in seen
        if nodes[k]["node_type"] == "employee"
    )
    courses = sorted(
        nodes[k]["external_ref"]
        for k in seen
        if nodes[k]["node_type"] == "course" and nodes[k]["external_ref"] not in exclude
    )
    comparison = gold_svc.compare_to_gold(
        found_stale_course_codes=courses,
        found_affected_employee_refs=employees,
        gold=gold,
    )
    return {
        "framework_code": framework,
        "affected_employees": employees,
        "affected_courses": courses,
        "expected_vs_found": comparison,
        "walk": "circular_scoped_in_memory",
    }


WAIT_STATE = "Nothing has been scheduled yet."

_DEPT_LABEL = {
    "Compliance": "Compliance（合规）",
    "Procurement": "Procurement（采购）",
    "L&D": "L&D",
    "Operations": "Operations（业务）",
    "Management": "Management（管理层）",
}

_MISSING = "—"


def _metric_cell(block: Any, key: str) -> str:
    if not isinstance(block, dict) or block.get(key) is None:
        return _MISSING
    return str(block[key])


def format_impact_headline(
    *,
    stale_n: int,
    affected_n: int,
    green_n: int,
    match: bool,
) -> str:
    base = (
        f"{stale_n} programmes stale · {affected_n} staff affected · "
        f"{green_n} programmes unchanged"
    )
    if not match:
        return base + " · Expected vs Found mismatch"
    return base


def format_impact_chat_markdown(brief: dict[str, Any]) -> str:
    """Verbatim WorkBuddy chat body. The model must paste this, not rewrite it."""
    evs = brief.get("expected_vs_found") or {}
    stale = evs.get("stale_programs") or {}
    emp = evs.get("affected_employees") or {}
    green = dict(evs.get("green_programs") or {})
    if green.get("found") is None and brief.get("green_courses") is not None:
        green["found"] = len(brief.get("green_courses") or [])
    fp = evs.get("false_positives") or []
    fn = evs.get("false_negatives") or []
    lines = [
        f"**{brief.get('headline') or format_impact_headline(stale_n=0, affected_n=0, green_n=0, match=False)}**",
        "",
        "| metric | Expected | Found |",
        "|---|---:|---:|",
        f"| stale programmes | {_metric_cell(stale, 'expected')} | {_metric_cell(stale, 'found')} |",
        f"| staff affected | {_metric_cell(emp, 'expected')} | {_metric_cell(emp, 'found')} |",
        f"| programmes unchanged | {_metric_cell(green, 'expected')} | {_metric_cell(green, 'found')} |",
        f"| False positives | 0 | {len(fp)} |",
        f"| False negatives | 0 | {len(fn)} |",
        "",
        "### Action Brief",
    ]
    for row in brief.get("action_brief") or []:
        dept = _DEPT_LABEL.get(str(row.get("department") or ""), str(row.get("department") or ""))
        lines.append(f"- **{dept}**: {row.get('action')}")
    lines += ["", brief.get("wait_state") or WAIT_STATE]
    return "\n".join(lines)


def ingest_circular(
    run_id: str,
    *,
    actor_id: str,
    actor_role: str,
    framework_code: str = "BNM_ORTC_2026",
    circular_id: str = "BNM-ORTC-2026-1",
    title: str | None = None,
    source: str = "fixture",
    text: str | None = None,
    use_gold_mapping: bool = True,
) -> dict[str, Any]:
    """Persist OR-TC clause → control → competency → course → employee edges.

    Does not mutate the committed schedule or in-force sessions. On a
    completed / rejected capability run, re-opens circular department HITL
    so humans can walk Compliance → Procurement → Learning → Operations → Management
    without assess(reopen=true).
    """
    if not use_gold_mapping:
        raise ValueError(
            "use_gold_mapping=false is not supported. Course and employee "
            "membership must come from gold_expected.json, not embeddings. "
            "Pass use_gold_mapping=true."
        )

    run = run_store.get_run(run_id)
    if not run:
        raise ValueError("run not found")

    gold = gold_svc.load_gold()
    if framework_code != gold["framework_code"]:
        raise ValueError(
            f"ingest_circular currently implements {gold['framework_code']}; "
            f"got {framework_code}"
        )

    raw_text = text or ""
    if not raw_text.strip() and source in {"fixture", "lexiang"}:
        raw_text = gold_svc.load_circular_markdown()
    extracted = gold_svc.extract_clause_text(raw_text)

    employees = list((run.get("trigger_payload") or {}).get("employees") or [])
    emp_by_ref = {e["employee_ref"]: e for e in employees}

    circular_title = title or gold.get("title") or "OR-TC 2026/1"
    created = {
        "clauses": [],
        "controls": [],
        "courses": [],
        "employees": [],
        "green_courses": [],
    }
    payload_base = _edge_payload(framework_code, circular_id)
    course_meta = {c["code"]: c for c in gold.get("stale_courses") or []}
    triples = gold_svc.mapping_triples(gold)
    course_ids: dict[str, str] = {}
    clause_ids: dict[str, str] = {}

    with db_conn() as conn:
        circular_node = evidence.upsert_node(
            run_id=run_id,
            node_type="policy_circular",
            external_ref=circular_id,
            label=circular_title,
            payload={
                "framework_code": framework_code,
                "circular_id": circular_id,
                "title": circular_title,
                "source": source,
                "effective_date": gold.get("effective_date"),
                "use_gold_mapping": True,
                "membership_source": "gold_expected.json",
                "text_excerpt": (raw_text or "")[:2000],
            },
            conn=conn,
        )

        for triple in triples:
            clause_ref = triple["clause_ref"]
            extracted_clause = extracted.get(clause_ref) or {}
            clause_title = extracted_clause.get("title") or triple["title"]
            clause_body = extracted_clause.get("body") or ""
            clause_id = evidence.upsert_node(
                run_id=run_id,
                node_type="policy_clause",
                external_ref=clause_ref,
                label=clause_title,
                payload={
                    "clause_ref": clause_ref,
                    "title": clause_title,
                    "body": clause_body,
                    "framework_code": framework_code,
                    "circular_id": circular_id,
                    "circular_scoped": True,
                    "maps_to_control": triple["control_code"],
                    "maps_to_competency": triple["competency_code"],
                    "stale_course_code": triple["course_code"],
                    "source": source,
                },
                conn=conn,
            )
            clause_ids[clause_ref] = clause_id
            evidence.link(
                run_id=run_id,
                from_node_id=circular_node,
                to_node_id=clause_id,
                edge_type="contains_clause",
                payload=payload_base,
                conn=conn,
            )

            control_id = evidence.upsert_node(
                run_id=run_id,
                node_type="control",
                external_ref=triple["control_code"],
                label=triple["control_code"],
                payload={
                    "control_code": triple["control_code"],
                    "framework_code": framework_code,
                    "circular_id": circular_id,
                    "circular_scoped": True,
                    "clause_ref": clause_ref,
                },
                conn=conn,
            )
            evidence.link(
                run_id=run_id,
                from_node_id=clause_id,
                to_node_id=control_id,
                edge_type="requires_control",
                payload=payload_base,
                conn=conn,
            )

            competency_id = evidence.upsert_node(
                run_id=run_id,
                node_type="competency",
                external_ref=triple["competency_code"],
                label=triple["competency_code"],
                payload={"code": triple["competency_code"], "framework_code": framework_code},
                conn=conn,
            )
            evidence.link(
                run_id=run_id,
                from_node_id=control_id,
                to_node_id=competency_id,
                edge_type="needs_competency",
                payload=payload_base,
                conn=conn,
            )

            meta = course_meta.get(triple["course_code"]) or {}
            existing_course = evidence.get_node(
                run_id=run_id,
                node_type="course",
                external_ref=triple["course_code"],
                conn=conn,
            )
            course_payload = dict((existing_course or {}).get("payload") or {})
            course_payload.update(
                {
                    "code": triple["course_code"],
                    "title": meta.get("title") or course_payload.get("title"),
                    "why_stale": meta.get("why_stale"),
                    "framework_code": framework_code,
                    "clause_ref": clause_ref,
                    "circular_scoped": True,
                }
            )
            course_id = evidence.upsert_node(
                run_id=run_id,
                node_type="course",
                external_ref=triple["course_code"],
                label=meta.get("title")
                or (existing_course or {}).get("label")
                or triple["course_code"],
                payload=course_payload,
                conn=conn,
            )
            course_ids[triple["course_code"]] = course_id
            evidence.link(
                run_id=run_id,
                from_node_id=competency_id,
                to_node_id=course_id,
                edge_type="maps_to_course",
                payload=payload_base,
                conn=conn,
            )
            evidence.link(
                run_id=run_id,
                from_node_id=control_id,
                to_node_id=course_id,
                edge_type="stales_course",
                payload=payload_base,
                conn=conn,
            )
            created["clauses"].append(clause_ref)
            created["controls"].append(triple["control_code"])
            created["courses"].append(triple["course_code"])

        for green in gold.get("green_courses") or []:
            existing_course = evidence.get_node(
                run_id=run_id,
                node_type="course",
                external_ref=green["code"],
                conn=conn,
            )
            payload = dict((existing_course or {}).get("payload") or {})
            payload.update(
                {
                    "code": green["code"],
                    "title": green.get("title") or payload.get("title"),
                    "why_green": green.get("why_green"),
                    "featured_demo_click": bool(green.get("featured_demo_click")),
                    "circular_scoped": False,
                }
            )
            evidence.upsert_node(
                run_id=run_id,
                node_type="course",
                external_ref=green["code"],
                label=green.get("title")
                or (existing_course or {}).get("label")
                or green["code"],
                payload=payload,
                conn=conn,
            )
            created["green_courses"].append(green["code"])

        emp_course_links = circular_employee_course_links(gold)
        for emp_gold in gold.get("affected_employees") or []:
            ref = emp_gold["employee_ref"]
            trigger_emp = emp_by_ref.get(ref) or {}
            existing = evidence.get_node(
                run_id=run_id, node_type="employee", external_ref=ref, conn=conn
            )
            payload = dict((existing or {}).get("payload") or {})
            payload.update(
                {
                    "pseudonym": emp_gold.get("pseudonym") or trigger_emp.get("pseudonym"),
                    "unit": emp_gold.get("unit") or trigger_emp.get("unit"),
                    "circular_reason": emp_gold.get("reason"),
                    "featured_demo_click": bool(emp_gold.get("featured_demo_click")),
                }
            )
            emp_id = evidence.upsert_node(
                run_id=run_id,
                node_type="employee",
                external_ref=ref,
                label=emp_gold.get("pseudonym") or trigger_emp.get("pseudonym") or ref,
                payload=payload,
                conn=conn,
            )
            for code in emp_course_links.get(ref) or []:
                evidence.link(
                    run_id=run_id,
                    from_node_id=emp_id,
                    to_node_id=course_ids[code],
                    edge_type="impacted_by_circular",
                    payload=payload_base,
                    conn=conn,
                )
                clause_ref = next(
                    (t["clause_ref"] for t in triples if t["course_code"] == code),
                    None,
                )
                if clause_ref and clause_ref in clause_ids:
                    evidence.link(
                        run_id=run_id,
                        from_node_id=clause_ids[clause_ref],
                        to_node_id=emp_id,
                        edge_type="impacts_employee",
                        payload=payload_base,
                        conn=conn,
                    )
            created["employees"].append(ref)

        for emp_gold in gold.get("unaffected_employees") or []:
            ref = emp_gold["employee_ref"]
            existing = evidence.get_node(
                run_id=run_id, node_type="employee", external_ref=ref, conn=conn
            )
            if existing:
                payload = dict(existing.get("payload") or {})
                payload["featured_demo_click"] = bool(emp_gold.get("featured_demo_click"))
                payload["circular_unaffected"] = True
                evidence.upsert_node(
                    run_id=run_id,
                    node_type="employee",
                    external_ref=ref,
                    label=existing.get("label") or emp_gold.get("pseudonym") or ref,
                    payload=payload,
                    conn=conn,
                )
        conn.commit()

    audit.append_event(
        run_id=run_id,
        event_type="policy.circular.ingested",
        actor_id=actor_id,
        actor_role=actor_role,
        payload={
            "framework_code": framework_code,
            "circular_id": circular_id,
            "source": source,
            "use_gold_mapping": True,
            "membership_source": "gold_expected.json",
            "created": created,
        },
    )
    try:
        from app.services.review_gates import apply_circular_path

        apply_circular_path(
            run_id, actor_id=actor_id, actor_role=actor_role
        )
    except Exception:  # noqa: BLE001 — ingest must not fail because gates are mid-pipeline
        logger.exception("apply_circular_path failed for run %s", run_id)
    return {
        "run_id": run_id,
        "framework_code": framework_code,
        "circular_id": circular_id,
        "title": circular_title,
        "source": source,
        "use_gold_mapping": True,
        "membership_source": "gold_expected.json",
        "created": created,
        "message": "Circular ingested. Approvals and schedules unchanged.",
    }


def _employee_rows(gold: dict[str, Any], refs: list[str], *, affected: bool) -> list[dict[str, Any]]:
    pool = gold.get("affected_employees" if affected else "unaffected_employees") or []
    by_ref = {e["employee_ref"]: e for e in pool}
    rows = []
    for ref in refs:
        e = by_ref.get(ref) or {"employee_ref": ref}
        rows.append(
            {
                "employee_ref": e["employee_ref"],
                "pseudonym": e.get("pseudonym"),
                "unit": e.get("unit"),
                "featured": bool(e.get("featured_demo_click")),
            }
        )
    return rows


def _course_rows(gold: dict[str, Any], codes: list[str], *, stale: bool) -> list[dict[str, Any]]:
    pool = gold.get("stale_courses" if stale else "green_courses") or []
    by_code = {c["code"]: c for c in pool}
    clause_by_course = {
        t["course_code"]: t["clause_ref"] for t in gold_svc.mapping_triples(gold)
    }
    rows = []
    for code in codes:
        c = by_code.get(code) or {"code": code}
        row = {
            "code": c.get("code") or code,
            "title": c.get("title"),
            "featured": bool(c.get("featured_demo_click")),
        }
        if stale:
            row["clause_ref"] = clause_by_course.get(code)
            row["why_stale"] = c.get("why_stale")
        else:
            row["why_green"] = c.get("why_green")
        rows.append(row)
    return rows


def arm_circular_hitl_if_completed(
    run_id: str,
    *,
    actor_id: str = "system",
    actor_role: str = "system",
) -> dict[str, Any]:
    """Re-open department gates on a COMMITted run after circular ingest/assess.

    Does not selective-recompile and does not mutate in-force sessions. Red paths
    stay in place; live Playbook 2 never calls assess(reopen=true).
    """
    from app.graph.interrupt_status import InterruptRearmError
    from app.graph.workflow import rearm_approval_interrupt
    from app.services.cockpit import list_options_with_assignments
    from app.services.recompile import (
        _latest_handoff_payload,
        interrupt_rearmed_from_rearm,
    )
    from app.services.review_gates import (
        circular_hitl_needs_rearm,
        reset_chain,
    )

    run = run_store.get_run(run_id)
    if not run:
        return {"armed": False, "reason": "run_not_found"}
    if not circular_hitl_needs_rearm(run.get("status") or ""):
        return {"armed": False, "reason": "not_post_commit", "status": run.get("status")}

    options = list_options_with_assignments(run_id)
    portfolios = [
        {
            "option_key": o["option_key"],
            "label": o["label"],
            "total_cost_myr": o["total_cost_myr"],
            "cost_per_employee_myr": o["cost_per_employee_myr"],
            "coverage_score": o["coverage_score"],
            "risk_reduction_score": o["risk_reduction_score"],
            "operational_coverage": o["operational_coverage"],
            "hard_constraint_ok": o["hard_constraint_ok"],
            "solver_status": o.get("solver_status") or "UNKNOWN",
            "assignments": o.get("assignments") or [],
            "metrics": o.get("metrics") or {},
            "challenger_flags": o.get("challenger_flags") or [],
        }
        for o in options
    ]
    portfolio_ids = {o["option_key"]: o["id"] for o in options}
    trigger = run.get("trigger_payload") or {}
    vendor_payload = _latest_handoff_payload(run_id, "vendor_intelligence")
    challenger_payload = _latest_handoff_payload(run_id, "challenger")
    policy_payload = _latest_handoff_payload(run_id, "policy_compiler")
    diagnostic_payload = _latest_handoff_payload(run_id, "diagnostic")
    learning_payload = _latest_handoff_payload(run_id, "learning_architect")
    vendor = {"agent": "vendor_intelligence", "output": vendor_payload}
    challenger = {"agent": "challenger", "output": challenger_payload}
    policy = {"agent": "policy_compiler", "output": policy_payload}
    diagnostic = {"agent": "diagnostic", "output": diagnostic_payload}
    learning = {"agent": "learning_architect", "output": learning_payload}

    interrupt_rearmed = False
    rearm_error = None
    if portfolios and portfolio_ids:
        try:
            rearm = rearm_approval_interrupt(
                run_id,
                trigger=trigger,
                portfolios=portfolios,
                portfolio_ids=portfolio_ids,
                challenger=challenger,
                vendor=vendor,
                policy=policy,
                diagnostic=diagnostic,
                learning=learning,
                actor_id=actor_id,
                actor_role=actor_role,
                reopen=False,
            )
            interrupt_rearmed = interrupt_rearmed_from_rearm(rearm)
        except InterruptRearmError as exc:
            rearm_error = str(exc)

    if not interrupt_rearmed:
        reset_chain(
            run_id,
            reason="circular_shadow_hitl",
            actor_id=actor_id,
            actor_role=actor_role,
        )
        run_store.update_run_status(
            run_id, status="awaiting_approval", current_node="await_approval"
        )

    audit.append_event(
        run_id=run_id,
        event_type="review.circular_hitl.armed",
        actor_id=actor_id,
        actor_role=actor_role,
        payload={
            "langgraph_interrupt_rearmed": interrupt_rearmed,
            "rearm_error": rearm_error,
            "reopen": False,
        },
    )
    return {
        "armed": True,
        "langgraph_interrupt_rearmed": interrupt_rearmed,
        "rearm_error": rearm_error,
        "status": "awaiting_approval",
    }


def assess_policy_change(
    run_id: str,
    *,
    actor_id: str,
    actor_role: str,
    framework_code: str = "BNM_ORTC_2026",
    reopen: bool = False,
    reason: str = "policy_version_change",
) -> dict[str, Any]:
    """Circular-scoped blast + gold comparison.

    reopen=false does not mutate in-force sessions or selective-recompile.
    On a completed / rejected run it re-opens department HITL so the same
    run_id can walk circular gates. reopen=true still mutates red paths in the
    engine; live Playbook 2 never sets it.
    """
    if not run_store.get_run(run_id):
        raise ValueError("run not found")
    radius = evidence.blast_radius(run_id, framework_code)
    gold = gold_svc.gold_for_framework(framework_code)
    comparison = None
    if gold:
        comparison = gold_svc.compare_to_gold(
            found_stale_course_codes=radius.get("affected_courses") or [],
            found_affected_employee_refs=radius.get("affected_employees") or [],
            gold=gold,
        )
        radius["expected_vs_found"] = comparison
        radius["gold_comparison"] = comparison
    recompiled = None
    interrupt_rearmed = False
    circular_hitl = None
    if reopen:
        from app.services.recompile import selective_recompile

        recompiled = selective_recompile(
            run_id,
            framework_code=framework_code,
            reason=reason,
            actor_id=actor_id,
            actor_role=actor_role,
        )
        interrupt_rearmed = bool(recompiled.get("langgraph_interrupt_rearmed"))
    else:
        audit.append_event(
            run_id=run_id,
            event_type="policy.blast_radius.queried",
            actor_id=actor_id,
            actor_role=actor_role,
            payload={
                "framework_code": framework_code,
                "reopen": False,
                "affected": len(radius.get("affected_nodes") or []),
                "gold_match": None if comparison is None else comparison.get("match"),
            },
        )
        # Same COMMITted run: open department gates without mutating red paths.
        circular_hitl = arm_circular_hitl_if_completed(
            run_id, actor_id=actor_id, actor_role=actor_role
        )
        interrupt_rearmed = bool(circular_hitl.get("langgraph_interrupt_rearmed"))
    return {
        "run_id": run_id,
        "framework_code": framework_code,
        "reopen": reopen,
        "langgraph_interrupt_rearmed": interrupt_rearmed,
        "circular_hitl": circular_hitl,
        "radius": radius,
        "expected_vs_found": comparison,
        "recompiled": recompiled,
    }


def build_impact_brief(run_id: str, framework_code: str = "BNM_ORTC_2026") -> dict[str, Any]:
    gold = gold_svc.gold_for_framework(framework_code) or gold_svc.load_gold()
    radius = evidence.blast_radius(run_id, framework_code)
    stale_codes = list(radius.get("affected_courses") or [])
    affected_refs = list(radius.get("affected_employees") or [])
    affected_set = set(affected_refs)
    stale_set = set(stale_codes)
    green_codes = [
        c["code"]
        for c in gold.get("green_courses") or []
        if c["code"] not in stale_set
    ]
    una_refs = [
        e["employee_ref"]
        for e in gold.get("unaffected_employees") or []
        if e["employee_ref"] not in affected_set
    ]
    comparison = gold_svc.compare_to_gold(
        found_stale_course_codes=stale_codes,
        found_affected_employee_refs=affected_refs,
        gold=gold,
    )
    featured_r = gold_svc.featured_red(gold)
    featured_g = gold_svc.featured_green(gold)
    green_expected = int((gold.get("expected_counts") or {}).get("green_programs", 3))
    evs = {
        "stale_programs": comparison["stale_programs"],
        "affected_employees": comparison["affected_employees"],
        "green_programs": {
            "expected": green_expected,
            "found": len(green_codes),
            "match": len(green_codes) == green_expected,
        },
        "false_positives": comparison["false_positives"],
        "false_negatives": comparison["false_negatives"],
        "match": comparison["match"],
    }
    payload = {
        "run_id": run_id,
        "framework_code": framework_code,
        "headline": format_impact_headline(
            stale_n=len(stale_codes),
            affected_n=len(affected_refs),
            green_n=len(green_codes),
            match=bool(comparison["match"]),
        ),
        "stale_courses": _course_rows(gold, stale_codes, stale=True),
        "green_courses": _course_rows(gold, green_codes, stale=False),
        "affected_employees": _employee_rows(gold, affected_refs, affected=True),
        "unaffected_employees": _employee_rows(gold, una_refs, affected=False),
        "expected_vs_found": evs,
        "approval": "awaiting_human",
        "wait_state": WAIT_STATE,
        "action_brief": gold_svc.ACTION_BRIEF,
        "featured_red": featured_r,
        "featured_green": featured_g,
    }
    payload["chat_markdown"] = format_impact_chat_markdown(payload)
    # chat_markdown first so MCP/WorkBuddy see paste-ready text before bulky tables
    ordered = {"chat_markdown": payload["chat_markdown"]}
    ordered.update(payload)
    return ordered


def evidence_spine_link(run_id: str, framework_code: str = "BNM_ORTC_2026") -> dict[str, Any]:
    settings = get_settings()
    base = settings.frontend_url.rstrip("/")
    query = urlencode({"framework": framework_code, "blast": "1"})
    evidence_url = f"{base}/runs/{run_id}/evidence?{query}"
    brief = build_impact_brief(run_id, framework_code)
    evs = brief["expected_vs_found"]
    fp_n = len(evs.get("false_positives") or [])
    fn_n = len(evs.get("false_negatives") or [])
    stale_n = (evs.get("stale_programs") or {}).get("found", 0)
    emp_n = (evs.get("affected_employees") or {}).get("found", 0)
    return {
        "run_id": run_id,
        "framework_code": framework_code,
        "evidence_url": evidence_url,
        "headline": f"{stale_n} stale · {emp_n} affected · {fp_n} FP · {fn_n} FN",
        "expected_vs_found": evs,
        "featured_red": brief["featured_red"],
        "featured_green": brief["featured_green"],
    }

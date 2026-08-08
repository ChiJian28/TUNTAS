"""Selective policy-change recompile for blast-radius affected paths."""
from __future__ import annotations

from typing import Any

from app.agents import pipeline as agents
from app.db.session import db_conn
from app.security.crypto import hash_payload
from app.services import audit, evidence
from app.services.llm import GeminiClient
from app.services.optimizer import build_three_portfolios
from app.services import runs as run_store
from app.services.trigger import strip_for_llm


def _latest_handoff_payload(run_id: str, agent_name: str) -> dict[str, Any]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT output_json FROM tuntas.agent_handoffs
                WHERE run_id = %s::uuid AND agent_name = %s
                ORDER BY created_at DESC LIMIT 1
                """,
                (run_id, agent_name),
            )
            row = cur.fetchone()
    if not row:
        return {}
    raw = row["output_json"] or {}
    return raw.get("payload") or raw


def selective_recompile(
    run_id: str,
    *,
    framework_code: str,
    reason: str,
    actor_id: str,
    actor_role: str,
) -> dict[str, Any]:
    """Mark stale paths, then re-run Challenger+Optimizer for affected employees.

    Reopens the approval gate with revised portfolios (subset-aware).
    """
    run = run_store.get_run(run_id)
    if not run:
        raise ValueError("run not found")

    radius = evidence.blast_radius(run_id, framework_code)
    # First mark stale
    evidence.reopen_affected_paths(
        run_id,
        framework_code=framework_code,
        reason=reason,
        actor_id=actor_id,
        actor_role=actor_role,
    )

    trigger = run["trigger_payload"]
    all_employees = list(trigger.get("employees") or [])
    affected_refs = set(radius.get("affected_employees") or [])
    affected_courses = set(radius.get("affected_courses") or [])
    # Also include employees whose competency gaps intersect affected course competencies
    vendor_payload = _latest_handoff_payload(run_id, "vendor_intelligence")
    courses = list(vendor_payload.get("courses") or [])
    if affected_courses:
        affected_comps = set()
        for c in courses:
            if c.get("code") in affected_courses:
                affected_comps.update(c.get("competency_codes") or [])
        for emp in all_employees:
            gaps = {g.get("code") for g in emp.get("competency_gaps") or []}
            if gaps & affected_comps:
                affected_refs.add(emp["employee_ref"])
    # If blast query found no employees, recompile full cohort (safe fallback)
    subset = [e for e in all_employees if e["employee_ref"] in affected_refs] or all_employees

    from app.services.handoff_contract import validate_handoff_envelope

    client = GeminiClient()
    # Re-run policy compiler on full trigger (versioned clauses), then challenger+optimizer on subset
    policy = agents.run_policy_compiler(strip_for_llm(trigger), client)
    reopen_hash = hash_payload({"reopen": framework_code, "run_id": run_id})
    policy_envelope = validate_handoff_envelope(
        agent_name="policy_compiler",
        input_hash=reopen_hash,
        output=policy.get("output") or {},
        confidence=policy.get("citation_coverage") or 0.7,
        latency_ms=policy.get("latency_ms"),
        model_name=policy.get("model_name"),
        citation_coverage=policy.get("citation_coverage"),
    )
    policy_envelope["reopen"] = True
    policy_envelope["framework_code"] = framework_code
    run_store.save_handoff(
        run_id,
        agent_name="policy_compiler",
        input_hash=reopen_hash,
        output_json=policy_envelope,
        citation_coverage=policy.get("citation_coverage"),
        latency_ms=policy.get("latency_ms"),
        model_name=policy.get("model_name"),
    )

    challenger = agents.run_challenger(None, vendor_payload, client)
    challenger_envelope = validate_handoff_envelope(
        agent_name="challenger",
        input_hash=reopen_hash,
        output=challenger.get("output") or {},
        confidence=0.85,
        requires_review=True,
        latency_ms=challenger.get("latency_ms"),
        model_name=challenger.get("model_name"),
    )
    challenger_envelope["reopen"] = True
    run_store.save_handoff(
        run_id,
        agent_name="challenger",
        input_hash=reopen_hash,
        output_json=challenger_envelope,
        citation_coverage=None,
        latency_ms=challenger.get("latency_ms"),
        model_name=challenger.get("model_name"),
    )
    vetoes = {
        v["course_code"]
        for v in (challenger.get("output") or {}).get("vetoes", [])
        if str(v.get("severity", "")).lower() == "critical"
    }
    for c in courses:
        if c.get("code") in vetoes:
            c["challenger_veto"] = True

    req = trigger.get("request") or {}
    n = len(subset)
    max_per = int(req.get("max_budget_per_employee_myr") or 5000)
    scaled_budget = min(int(req.get("total_budget_myr") or max_per * n), max_per * n)
    portfolios = build_three_portfolios(
        subset,
        courses,
        max_cost_per_employee=max_per,
        total_budget=scaled_budget,
        min_operational_coverage=float(req.get("min_operational_coverage_ratio") or 0.7),
    )
    for p in portfolios:
        p["metrics"] = {
            **(p.get("metrics") or {}),
            "reopen_framework": framework_code,
            "subset_employee_count": n,
            "affected_refs": sorted(affected_refs) if affected_refs else "full_cohort",
        }
    ids = run_store.save_portfolios(run_id, portfolios)

    vendor_state = {
        "agent": "vendor_intelligence",
        "output": {**vendor_payload, "courses": courses},
    }
    # CRITICAL: re-seat LangGraph at interrupt() — DB status alone is not enough.
    # After END, Command(resume=...) is a silent no-op.
    from app.graph.workflow import rearm_approval_interrupt

    rearm = rearm_approval_interrupt(
        run_id,
        trigger=trigger,
        portfolios=portfolios,
        portfolio_ids=ids,
        challenger=challenger,
        vendor=vendor_state,
        policy=policy,
        actor_id=actor_id,
        actor_role=actor_role,
    )

    audit.append_event(
        run_id=run_id,
        event_type="policy.blast_radius.recompiled",
        actor_id=actor_id,
        actor_role=actor_role,
        payload={
            "framework_code": framework_code,
            "reason": reason,
            "subset_size": n,
            "portfolio_ids": ids,
            "vetoes": sorted(vetoes),
            "langgraph_rearmed": True,
            "interrupt_pending": rearm.get("interrupted"),
        },
    )
    return {
        "run_id": run_id,
        "status": "awaiting_approval",
        "framework_code": framework_code,
        "recompiled_employee_count": n,
        "affected_employees": sorted(affected_refs),
        "langgraph_interrupt_rearmed": True,
        "options": [
            {
                "option_key": p["option_key"],
                "label": p["label"],
                "total_cost_myr": p["total_cost_myr"],
                "hard_constraint_ok": p["hard_constraint_ok"],
                "operational_coverage": p["operational_coverage"],
            }
            for p in portfolios
        ],
        "message": (
            "Affected paths recompiled; LangGraph re-armed at approval interrupt; "
            "management re-approval required."
        ),
    }

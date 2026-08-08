from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from app.agents import pipeline as agents
from app.graph.checkpoint import get_checkpointer
from app.security.crypto import hash_payload
from app.services import audit, evidence
from app.services.domain_seed import seed_run_domain
from app.services.finalize import commit_approval_atomically, process_export_outbox
from app.services.llm import GeminiClient
from app.services.optimizer import build_three_portfolios
from app.services import runs as run_store
from app.services.trigger import strip_for_llm

logger = logging.getLogger(__name__)


class WorkflowState(TypedDict, total=False):
    run_id: str
    trigger: dict[str, Any]
    actor_id: str
    actor_role: str
    diagnostic: dict[str, Any]
    policy: dict[str, Any]
    vendor: dict[str, Any]
    learning: dict[str, Any]
    portfolios: list[dict[str, Any]]
    portfolio_ids: dict[str, str]
    portfolio_version: str
    challenger: dict[str, Any]
    secretariat: dict[str, Any]
    decision: dict[str, Any]
    sessions: list[dict[str, Any]]
    artifacts: list[dict[str, Any]]
    assurance: dict[str, Any]
    status: str
    current_node: str
    error: str
    return_to_stage: str


def portfolio_version_hash(portfolios: list[dict[str, Any]]) -> str:
    """Stable hash of options used for stale-approval protection after what-if."""
    return hash_payload(
        [
            {
                "option_key": p.get("option_key"),
                "total_cost_myr": p.get("total_cost_myr"),
                "cost_per_employee_myr": p.get("cost_per_employee_myr"),
                "coverage_score": p.get("coverage_score"),
                "risk_reduction_score": p.get("risk_reduction_score"),
                "operational_coverage": p.get("operational_coverage"),
                "hard_constraint_ok": p.get("hard_constraint_ok"),
                "assignments": p.get("assignments") or [],
            }
            for p in sorted(portfolios, key=lambda x: str(x.get("option_key") or ""))
        ]
    )


def sync_portfolios_into_checkpoint(
    run_id: str,
    portfolios: list[dict[str, Any]] | None = None,
    portfolio_ids: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Push DB (or provided) portfolios into LangGraph checkpoint so /decision finalize matches UI.

    Returns {portfolio_version, checkpoint_synced, portfolio_ids}.
    """
    if portfolios is None or portfolio_ids is None:
        from app.services.cockpit import list_options_with_assignments

        options = list_options_with_assignments(run_id)
        if not options:
            raise ValueError("no portfolio options to sync")
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

    version = portfolio_version_hash(portfolios)
    graph = get_graph()
    thread = _thread_config(run_id)
    snap = graph.get_state(thread)
    values = getattr(snap, "values", None) or {}
    synced = False
    if _interrupt_pending(snap) or values:
        graph.update_state(
            thread,
            {
                "portfolios": portfolios,
                "portfolio_ids": portfolio_ids,
                "portfolio_version": version,
            },
        )
        synced = True
    return {
        "portfolio_version": version,
        "checkpoint_synced": synced,
        "portfolio_ids": portfolio_ids,
        "portfolios": portfolios,
    }


_compiled = None


def _llm() -> GeminiClient:
    return GeminiClient()


def _persist_handoff(run_id: str, result: dict[str, Any], input_obj: Any) -> None:
    from app.services.handoff_contract import HandoffContractError, validate_handoff_envelope

    input_hash = hash_payload(input_obj)
    try:
        envelope = validate_handoff_envelope(
            agent_name=result["agent"],
            input_hash=input_hash,
            output=result.get("output") or {},
            evidence_ids=result.get("evidence_ids") or [],
            confidence=result.get("confidence"),
            requires_review=result.get("requires_review"),
            latency_ms=result.get("latency_ms"),
            model_name=result.get("model_name"),
            citation_coverage=result.get("citation_coverage"),
        )
    except HandoffContractError:
        logger.exception("handoff contract violation agent=%s", result.get("agent"))
        raise
    run_store.save_handoff(
        run_id,
        agent_name=result["agent"],
        input_hash=input_hash,
        output_json=envelope,
        citation_coverage=result.get("citation_coverage"),
        latency_ms=result.get("latency_ms"),
        model_name=result.get("model_name"),
    )
    audit.append_event(
        run_id=run_id,
        event_type=f"agent.{result['agent']}.completed",
        actor_id="system",
        actor_role="system",
        payload={
            "latency_ms": result.get("latency_ms"),
            "model_name": result.get("model_name"),
            "citation_coverage": result.get("citation_coverage"),
            "requires_review": envelope["requires_review"],
            "confidence": envelope["confidence"],
            "contract": "validated",
        },
    )


def node_parallel_intake(state: WorkflowState) -> dict[str, Any]:
    run_id = state["run_id"]
    trigger = state["trigger"]
    run_store.update_run_status(run_id, status="running", current_node="parallel_intake")
    audit.append_event(
        run_id=run_id,
        event_type="workflow.parallel_intake.started",
        actor_id="system",
        actor_role="system",
        payload={},
    )
    # True parallel branches (Diagnostic / Policy / Vendor) — plan §4.2
    safe_trigger = strip_for_llm(trigger)
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {
            pool.submit(agents.run_diagnostic, safe_trigger, _llm()): "diagnostic",
            pool.submit(agents.run_policy_compiler, safe_trigger, _llm()): "policy",
            pool.submit(agents.run_vendor_intelligence, safe_trigger, _llm()): "vendor",
        }
        results: dict[str, dict[str, Any]] = {}
        for fut in as_completed(futures):
            name = futures[fut]
            results[name] = fut.result()
    diagnostic = results["diagnostic"]
    policy = results["policy"]
    vendor = results["vendor"]
    _persist_handoff(run_id, diagnostic, {"trigger_hash": trigger.get("_hash")})
    _persist_handoff(run_id, policy, {"frameworks": trigger["request"].get("regulatory_frameworks")})
    _persist_handoff(
        run_id,
        vendor,
        {
            "mode": vendor.get("output", {}).get("mode_used"),
            "live_evidence_count": vendor.get("output", {}).get("live_evidence_count"),
        },
    )
    # Seed live Tavily evidence into Evidence Spine
    evidence_ids = []
    for ev in vendor.get("output", {}).get("live_evidence") or []:
        eid = evidence.upsert_node(
            run_id=run_id,
            node_type="vendor_evidence",
            external_ref=ev.get("content_hash") or ev.get("url"),
            label=(ev.get("title") or "tavily")[:120],
            payload=ev,
        )
        evidence_ids.append(eid)
    vendor["evidence_ids"] = evidence_ids

    # Persist domain tables (employees/FSF competencies/policies/providers/courses)
    try:
        seed_stats = seed_run_domain(
            run_id=run_id,
            trigger=trigger,
            clauses=policy.get("output", {}).get("clauses") or [],
            courses=vendor.get("output", {}).get("courses") or [],
            embed=True,
        )
        audit.append_event(
            run_id=run_id,
            event_type="domain.seeded",
            actor_id="system",
            actor_role="system",
            payload=seed_stats,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("domain seed failed")
        audit.append_event(
            run_id=run_id,
            event_type="domain.seed_failed",
            actor_id="system",
            actor_role="system",
            payload={"error": str(exc)[:300]},
        )

    # Evidence spine seeds
    for clause in policy.get("output", {}).get("clauses", []):
        cid = evidence.upsert_node(
            run_id=run_id,
            node_type="policy_clause",
            external_ref=clause["clause_ref"],
            label=clause["title"],
            payload=clause,
        )
        for mapping in policy.get("output", {}).get("control_mappings", []):
            if mapping.get("clause_ref") != clause["clause_ref"]:
                continue
            ctrl = evidence.upsert_node(
                run_id=run_id,
                node_type="control",
                external_ref=mapping["control_code"],
                label=mapping["control_name"],
                payload=mapping,
            )
            evidence.link(
                run_id=run_id,
                from_node_id=cid,
                to_node_id=ctrl,
                edge_type="requires_control",
            )
            for comp in mapping.get("competency_codes") or []:
                comp_id = evidence.upsert_node(
                    run_id=run_id,
                    node_type="competency",
                    external_ref=comp,
                    label=comp,
                    payload={"code": comp},
                )
                evidence.link(
                    run_id=run_id,
                    from_node_id=ctrl,
                    to_node_id=comp_id,
                    edge_type="needs_competency",
                )

    for emp in trigger["employees"]:
        emp_node = evidence.upsert_node(
            run_id=run_id,
            node_type="employee",
            external_ref=emp["employee_ref"],
            label=emp["pseudonym"],
            payload={
                "role_code": emp["role_code"],
                "current_level": emp["current_level"],
                "target_level": emp["target_level"],
            },
        )
        for gap in emp.get("competency_gaps") or []:
            comp_id = evidence.upsert_node(
                run_id=run_id,
                node_type="competency",
                external_ref=gap["code"],
                label=gap.get("name") or gap["code"],
                payload=gap,
            )
            evidence.link(
                run_id=run_id,
                from_node_id=emp_node,
                to_node_id=comp_id,
                edge_type="has_gap",
            )

    return {
        "diagnostic": diagnostic,
        "policy": policy,
        "vendor": vendor,
        "current_node": "learning_architect",
        "status": "running",
    }


def node_learning(state: WorkflowState) -> dict[str, Any]:
    run_id = state["run_id"]
    run_store.update_run_status(run_id, status="running", current_node="learning_architect")
    learning = agents.run_learning_architect(
        strip_for_llm(state["trigger"]),
        state["diagnostic"],
        state["policy"],
        _llm(),
    )
    # Ensure deterministic-scorable signals exist even if model omits them
    for scn in learning.get("output", {}).get("scenarios") or []:
        for item in scn.get("rubric") or []:
            if not item.get("required_signals"):
                item["required_signals"] = ["escalate", "document", "verify"]
            if "critical" not in item:
                item["critical"] = "escalat" in str(item.get("level3_behavior", "")).lower()
    _persist_handoff(run_id, learning, {"from": "diagnostic+policy"})
    scenarios = learning.get("output", {}).get("scenarios") or []
    if scenarios:
        run_store.save_scenarios(run_id, scenarios)
    return {"learning": learning, "current_node": "challenger"}


def node_challenger(state: WorkflowState) -> dict[str, Any]:
    """Plan order: Challenger → Optimizer (veto catalog before CP-SAT)."""
    run_id = state["run_id"]
    run_store.update_run_status(run_id, status="running", current_node="challenger")
    challenger = agents.run_challenger(
        None,
        state["vendor"].get("output") or {},
        _llm(),
    )
    _persist_handoff(run_id, challenger, {"stage": "pre_optimizer_catalog"})
    vetoes = {v["course_code"] for v in challenger.get("output", {}).get("vetoes", [])}
    courses = list(state["vendor"].get("output", {}).get("courses") or [])
    for c in courses:
        if c["code"] in vetoes:
            c["challenger_veto"] = True
    vendor = dict(state["vendor"])
    vendor_out = dict(vendor.get("output") or {})
    vendor_out["courses"] = courses
    vendor["output"] = vendor_out
    return {
        "challenger": challenger,
        "vendor": vendor,
        "current_node": "optimizer",
    }


def node_optimizer(state: WorkflowState) -> dict[str, Any]:
    run_id = state["run_id"]
    trigger = state["trigger"]
    req = trigger["request"]
    run_store.update_run_status(run_id, status="running", current_node="optimizer")
    courses = list(state["vendor"].get("output", {}).get("courses") or [])
    n = len(trigger["employees"])
    max_per = int(req.get("max_budget_per_employee_myr") or 5000)
    total_budget = int(req.get("total_budget_myr") or (max_per * int(req.get("target_cohort_size") or n)))
    scaled_budget = min(total_budget, max_per * n)

    portfolios = build_three_portfolios(
        trigger["employees"],
        courses,
        max_cost_per_employee=max_per,
        total_budget=scaled_budget,
        min_operational_coverage=float(req.get("min_operational_coverage_ratio") or 0.7),
    )
    vetoes = {
        v["course_code"]
        for v in (state.get("challenger") or {}).get("output", {}).get("vetoes", [])
        if str(v.get("severity", "")).lower() == "critical"
    }
    for p in portfolios:
        flags = []
        assigned = {a["course_code"] for a in p.get("assignments") or []}
        leaked = assigned & vetoes
        if leaked:
            p["hard_constraint_ok"] = False
            flags.append(
                {
                    "option_key": p["option_key"],
                    "severity": "critical",
                    "message": f"Contains privacy-vetoed course(s): {sorted(leaked)}",
                }
            )
        for gap in (state.get("challenger") or {}).get("output", {}).get("evidence_insufficient") or []:
            if gap.get("course_code") in assigned and str(gap.get("severity")).lower() == "high":
                flags.append(
                    {
                        "option_key": p["option_key"],
                        "severity": "high",
                        "message": gap.get("reason"),
                    }
                )
        p["challenger_flags"] = flags
        for a in p.get("assignments") or []:
            evidence.upsert_node(
                run_id=run_id,
                node_type="course",
                external_ref=a["course_code"],
                label=a.get("course_title") or a["course_code"],
                payload=a,
            )
    ids = run_store.save_portfolios(run_id, portfolios)
    audit.append_event(
        run_id=run_id,
        event_type="optimizer.completed",
        actor_id="system",
        actor_role="system",
        payload={"options": [p["option_key"] for p in portfolios], "scaled_budget": scaled_budget},
    )
    return {
        "portfolios": portfolios,
        "portfolio_ids": ids,
        "current_node": "secretariat",
    }


def node_secretariat(state: WorkflowState) -> dict[str, Any]:
    run_id = state["run_id"]
    run_store.update_run_status(run_id, status="running", current_node="secretariat")
    secretariat = agents.run_management_secretariat(
        strip_for_llm(state["trigger"]),
        state["portfolios"],
        state["challenger"],
        _llm(),
    )
    _persist_handoff(run_id, secretariat, {"awaiting": "manager_decision"})
    # No artifact commitment before approval (plan §4.6)
    run_store.update_run_status(run_id, status="awaiting_approval", current_node="await_approval")
    audit.append_event(
        run_id=run_id,
        event_type="approval.gate",
        actor_id="system",
        actor_role="system",
        payload={"message": "Human approval required before schedule/procurement/artifacts"},
    )
    return {
        "secretariat": secretariat,
        "status": "awaiting_approval",
        "current_node": "await_approval",
    }


def node_await_approval(state: WorkflowState) -> dict[str, Any]:
    """Durable HITL gate — LangGraph interrupt."""
    decision = interrupt(
        {
            "type": "management_approval",
            "run_id": state["run_id"],
            "recommended_option_key": (state.get("secretariat") or {})
            .get("output", {})
            .get("recommended_option_key"),
            "options": [
                {
                    "option_key": p["option_key"],
                    "label": p["label"],
                    "total_cost_myr": p["total_cost_myr"],
                    "hard_constraint_ok": p["hard_constraint_ok"],
                }
                for p in state.get("portfolios") or []
            ],
        }
    )
    return {"decision": decision, "current_node": "finalize", "status": "approved_processing"}


def node_finalize(state: WorkflowState) -> dict[str, Any]:
    run_id = state["run_id"]
    decision = state.get("decision") or {}
    action = decision.get("decision")

    if action == "revise":
        stage = decision.get("return_to_stage") or "learning_architect"
        run_store.update_run_status(run_id, status="revising", current_node=stage)
        audit.append_event(
            run_id=run_id,
            event_type="approval.revise_requested",
            actor_id=decision.get("actor_id", "unknown"),
            actor_role=decision.get("actor_role", "manager"),
            payload=decision,
        )
        return {
            "status": "revising",
            "current_node": stage,
            "return_to_stage": stage,
            "decision": decision,
        }

    if action != "approve":
        run_store.update_run_status(run_id, status="rejected", current_node="finalize")
        audit.append_event(
            run_id=run_id,
            event_type="approval.rejected",
            actor_id=decision.get("actor_id", "unknown"),
            actor_role=decision.get("actor_role", "manager"),
            payload=decision,
        )
        return {"status": "rejected", "current_node": "finalize", "decision": decision}

    option_key = decision["option_key"]
    selected = next(p for p in state["portfolios"] if p["option_key"] == option_key)
    option_id = state["portfolio_ids"][option_key]
    tw = state["trigger"]["request"].get("training_window") or {}

    committed = commit_approval_atomically(
        run_id=run_id,
        option_id=option_id,
        option_key=option_key,
        decision="approve",
        rationale=decision.get("rationale") or "",
        conditions=decision.get("conditions") or [],
        actor_id=decision.get("actor_id") or "manager",
        actor_role=decision.get("actor_role") or "manager",
        assignments=selected.get("assignments") or [],
        employees=state["trigger"].get("employees") or [],
        training_window=tw,
        min_operational_coverage=float(
            state["trigger"]["request"].get("min_operational_coverage_ratio") or 0.7
        ),
        portfolios_snapshot=state["portfolios"],
        secretariat_output=(state.get("secretariat") or {}).get("output"),
        trigger=strip_for_llm(state["trigger"]),
    )
    decision_id = committed["decision_id"]
    sessions = committed["sessions"]

    # Evidence spine links (after durable commit)
    emp_nodes = {}
    for emp in state["trigger"]["employees"]:
        emp_nodes[emp["employee_ref"]] = evidence.upsert_node(
            run_id=run_id,
            node_type="employee",
            external_ref=emp["employee_ref"],
            label=emp["pseudonym"],
            payload={"role_code": emp["role_code"]},
        )
    for a in selected.get("assignments") or []:
        course_node = evidence.upsert_node(
            run_id=run_id,
            node_type="course",
            external_ref=a["course_code"],
            label=a.get("course_title") or a["course_code"],
            payload=a,
        )
        if a["employee_ref"] in emp_nodes:
            evidence.link(
                run_id=run_id,
                from_node_id=emp_nodes[a["employee_ref"]],
                to_node_id=course_node,
                edge_type="assigned_course",
            )
        for comp in a.get("competency_codes") or []:
            comp_id = evidence.upsert_node(
                run_id=run_id,
                node_type="competency",
                external_ref=comp,
                label=comp,
                payload={"code": comp},
            )
            evidence.link(
                run_id=run_id,
                from_node_id=course_node,
                to_node_id=comp_id,
                edge_type="builds_competency",
            )

    approval_node = evidence.upsert_node(
        run_id=run_id,
        node_type="approval",
        external_ref=decision_id,
        label="Management Approval",
        payload={"option_key": option_key, "conditions": decision.get("conditions") or []},
    )
    readiness = evidence.upsert_node(
        run_id=run_id,
        node_type="readiness",
        external_ref=f"readiness-{run_id[:8]}",
        label="Cohort Readiness Path",
        payload={"option_key": option_key},
    )
    evidence.link(
        run_id=run_id,
        from_node_id=approval_node,
        to_node_id=readiness,
        edge_type="authorizes_readiness",
    )

    arts = process_export_outbox(run_id)
    run_store.update_run_status(
        run_id,
        status="completed",
        current_node="assurance_monitor",
        selected_option_id=option_id,
    )
    return {
        "sessions": sessions,
        "artifacts": arts,
        "status": "completed",
        "current_node": "assurance_monitor",
        "decision": {**decision, "decision_id": decision_id},
    }


def node_assurance(state: WorkflowState) -> dict[str, Any]:
    """Pre-delivery baseline only — post-training refresh happens after simulations."""
    run_id = state["run_id"]
    if state.get("status") == "rejected":
        return {"current_node": "completed"}
    from app.services.assurance import refresh_assurance

    decision = state.get("decision") or {}
    refreshed = refresh_assurance(
        run_id,
        trigger=state["trigger"],
        portfolios=state.get("portfolios") or [],
        selected_option_key=decision.get("option_key"),
        phase="pre_delivery",
    )
    audit.append_event(
        run_id=run_id,
        event_type="workflow.scheduled",
        actor_id="system",
        actor_role="system",
        payload={
            "artifact_count": len(state.get("artifacts") or []),
            "assurance_phase": "pre_delivery",
            "note": "Post-training assurance refreshes after simulation attempts",
        },
    )
    run_store.update_run_status(run_id, status="completed", current_node="completed")
    return {
        "assurance": {"agent": "assurance_monitor", "output": refreshed["assurance"]},
        "current_node": "completed",
        "status": "completed",
    }


def _route_after_finalize(state: WorkflowState) -> str:
    decision = state.get("decision") or {}
    if decision.get("decision") == "revise":
        stage = decision.get("return_to_stage") or state.get("return_to_stage") or "learning_architect"
        if stage in {"learning_architect", "challenger", "optimizer", "secretariat"}:
            return stage
        return "learning_architect"
    if decision.get("decision") == "approve":
        return "assurance_monitor"
    return END


def build_graph():
    g = StateGraph(WorkflowState)
    g.add_node("parallel_intake", node_parallel_intake)
    g.add_node("learning_architect", node_learning)
    g.add_node("challenger", node_challenger)
    g.add_node("optimizer", node_optimizer)
    g.add_node("secretariat", node_secretariat)
    g.add_node("await_approval", node_await_approval)
    g.add_node("finalize", node_finalize)
    g.add_node("assurance_monitor", node_assurance)

    g.add_edge(START, "parallel_intake")
    g.add_edge("parallel_intake", "learning_architect")
    g.add_edge("learning_architect", "challenger")
    g.add_edge("challenger", "optimizer")
    g.add_edge("optimizer", "secretariat")
    g.add_edge("secretariat", "await_approval")
    g.add_edge("await_approval", "finalize")
    g.add_conditional_edges(
        "finalize",
        _route_after_finalize,
        {
            "learning_architect": "learning_architect",
            "challenger": "challenger",
            "optimizer": "optimizer",
            "secretariat": "secretariat",
            "assurance_monitor": "assurance_monitor",
            END: END,
        },
    )
    g.add_edge("assurance_monitor", END)
    return g.compile(checkpointer=get_checkpointer())


def get_graph(*, force_reload: bool = False):
    global _compiled
    if _compiled is None or force_reload:
        _compiled = build_graph()
    return _compiled


def reset_graph() -> None:
    global _compiled
    _compiled = None


def _is_db_blip(exc: BaseException) -> bool:
    msg = str(exc).lower()
    needles = (
        "connection is closed",
        "server closed the connection",
        "ssl syscall error",
        "ssl connection has been closed",
        "connection reset",
        "consuming input failed",
    )
    return any(n in msg for n in needles)


def _recover_graph_after_db_blip():
    """Reopen pool + LangGraph checkpointer after Supabase idle drop."""
    from app.db.session import close_pool, get_pool
    from app.graph.checkpoint import close_checkpointer, get_checkpointer

    logger.warning("Recovering DB connections after blip")
    try:
        close_pool()
    except Exception:  # noqa: BLE001
        pass
    get_pool()
    close_checkpointer()
    get_checkpointer()
    return get_graph(force_reload=True)


def execute_run(run_id: str, trigger: dict[str, Any], actor_id: str, actor_role: str) -> dict[str, Any]:
    graph = get_graph()
    thread = {"configurable": {"thread_id": f"tuntas-{run_id}"}}
    payload = {
        "run_id": run_id,
        "trigger": trigger,
        "actor_id": actor_id,
        "actor_role": actor_role,
        "status": "running",
    }
    try:
        result = graph.invoke(payload, config=thread)
    except Exception as exc:
        if not _is_db_blip(exc):
            raise
        logger.warning("execute_run hit DB blip; retrying once: %s", exc)
        graph = _recover_graph_after_db_blip()
        result = graph.invoke(payload, config=thread)
    snap = graph.get_state(thread)
    interrupted = _interrupt_pending(snap) or bool(result.get("__interrupt__"))
    status = "awaiting_approval" if interrupted else result.get("status", "unknown")
    if interrupted:
        run_store.update_run_status(run_id, status="awaiting_approval", current_node="await_approval")
    return {
        "run_id": run_id,
        "status": status,
        "current_node": "await_approval" if interrupted else result.get("current_node"),
        "interrupted": interrupted,
    }


def _thread_config(run_id: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": f"tuntas-{run_id}"}}


def _interrupt_pending(snap: Any) -> bool:
    """True iff LangGraph thread is paused and can accept Command(resume=...)."""
    if snap is None:
        return False
    if getattr(snap, "next", None):
        return True
    if getattr(snap, "tasks", None):
        return True
    if getattr(snap, "interrupts", None):
        return True
    return False


def rearm_approval_interrupt(
    run_id: str,
    *,
    trigger: dict[str, Any],
    portfolios: list[dict[str, Any]],
    portfolio_ids: dict[str, str],
    challenger: dict[str, Any],
    vendor: dict[str, Any],
    policy: dict[str, Any] | None = None,
    diagnostic: dict[str, Any] | None = None,
    learning: dict[str, Any] | None = None,
    actor_id: str = "system",
    actor_role: str = "system",
) -> dict[str, Any]:
    """Re-seat a completed (or non-interrupted) thread at await_approval interrupt.

    Policy reopen updates DB portfolios then MUST call this — otherwise
    POST /decision's Command(resume=...) is a silent no-op after END.
    """
    secretariat = agents.run_management_secretariat(
        strip_for_llm(trigger),
        portfolios,
        challenger,
        _llm(),
    )
    _persist_handoff(run_id, secretariat, {"awaiting": "manager_decision", "reopen": True})

    graph = get_graph()
    thread = _thread_config(run_id)
    # as_node=secretariat ⇒ next edge is await_approval; invoke(None) hits interrupt()
    graph.update_state(
        thread,
        {
            "run_id": run_id,
            "trigger": trigger,
            "actor_id": actor_id,
            "actor_role": actor_role,
            "diagnostic": diagnostic or {},
            "policy": policy or {},
            "vendor": vendor,
            "learning": learning or {},
            "portfolios": portfolios,
            "portfolio_ids": portfolio_ids,
            "challenger": challenger,
            "secretariat": secretariat,
            "decision": {},
            "sessions": [],
            "artifacts": [],
            "assurance": {},
            "status": "awaiting_approval",
            "current_node": "await_approval",
            "return_to_stage": "",
        },
        as_node="secretariat",
    )
    result = graph.invoke(None, config=thread)
    snap = graph.get_state(thread)
    interrupted = _interrupt_pending(snap) or bool(result.get("__interrupt__"))
    if not interrupted:
        raise RuntimeError(
            f"Failed to re-arm approval interrupt for run {run_id}; "
            f"next={getattr(snap, 'next', None)}"
        )
    run_store.update_run_status(run_id, status="awaiting_approval", current_node="await_approval")
    audit.append_event(
        run_id=run_id,
        event_type="approval.gate.rearmed",
        actor_id=actor_id,
        actor_role=actor_role,
        payload={
            "message": "LangGraph interrupt re-armed after policy reopen",
            "next": list(snap.next or ()),
            "option_keys": [p.get("option_key") for p in portfolios],
        },
    )
    return {
        "run_id": run_id,
        "status": "awaiting_approval",
        "interrupted": True,
        "current_node": "await_approval",
        "secretariat": secretariat,
    }


def resume_with_decision(run_id: str, decision: dict[str, Any]) -> dict[str, Any]:
    graph = get_graph()
    thread = _thread_config(run_id)
    try:
        snap = graph.get_state(thread)
        if not _interrupt_pending(snap):
            raise RuntimeError(
                "LangGraph thread is not paused at an approval interrupt. "
                "After a completed run, call blast-radius/reopen (rearm) before /decision — "
                "bare Command(resume=...) is a silent no-op once the graph has ENDed."
            )
        result = graph.invoke(Command(resume=decision), config=thread)
    except Exception as exc:
        if isinstance(exc, RuntimeError) and "not paused" in str(exc):
            raise
        if not _is_db_blip(exc):
            raise
        logger.warning("resume_with_decision hit DB blip; retrying once: %s", exc)
        graph = _recover_graph_after_db_blip()
        snap = graph.get_state(thread)
        if not _interrupt_pending(snap):
            raise RuntimeError(
                "LangGraph thread is not paused at an approval interrupt after reconnect."
            ) from exc
        result = graph.invoke(Command(resume=decision), config=thread)
    # Revise loops may re-hit interrupt
    snap = graph.get_state(thread)
    interrupted = _interrupt_pending(snap) or bool(result.get("__interrupt__"))
    status = "awaiting_approval" if interrupted else result.get("status", "unknown")
    if interrupted:
        run_store.update_run_status(run_id, status="awaiting_approval", current_node="await_approval")
    return {
        "run_id": run_id,
        "status": status,
        "current_node": "await_approval" if interrupted else result.get("current_node"),
        "decision": result.get("decision"),
        "assurance": result.get("assurance"),
    }


def what_if_recalculate(
    run_id: str,
    *,
    max_cost_per_employee: int | None = None,
    total_budget: int | None = None,
    min_operational_coverage: float | None = None,
    apply: bool = True,
) -> dict[str, Any]:
    """Instant portfolio re-solve from stored trigger+vendor catalog (no LLM).

    When apply=True (default): persist to DB and sync LangGraph checkpoint so subsequent
    /decision finalize uses the same assignments the UI just showed.
    When apply=False: preview only — no DB/checkpoint mutation.
    """
    run = run_store.get_run(run_id)
    if not run:
        raise ValueError("run not found")
    trigger = run["trigger_payload"]
    # Load latest vendor handoff courses
    from app.db.session import db_conn

    courses: list[dict[str, Any]] = []
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT output_json FROM tuntas.agent_handoffs
                WHERE run_id = %s::uuid AND agent_name = 'vendor_intelligence'
                ORDER BY created_at DESC LIMIT 1
                """,
                (run_id,),
            )
            row = cur.fetchone()
            if row:
                payload = row["output_json"] or {}
                courses = (payload.get("payload") or payload).get("courses") or []
            cur.execute(
                """
                SELECT output_json FROM tuntas.agent_handoffs
                WHERE run_id = %s::uuid AND agent_name = 'challenger'
                ORDER BY created_at DESC LIMIT 1
                """,
                (run_id,),
            )
            ch = cur.fetchone()
            vetoes = set()
            if ch:
                ch_out = (ch["output_json"] or {}).get("payload") or ch["output_json"] or {}
                vetoes = {
                    v["course_code"]
                    for v in ch_out.get("vetoes") or []
                    if str(v.get("severity", "")).lower() == "critical"
                }
            for c in courses:
                if c.get("code") in vetoes:
                    c["challenger_veto"] = True

    req = trigger.get("request") or {}
    n = len(trigger.get("employees") or [])
    max_per = int(max_cost_per_employee or req.get("max_budget_per_employee_myr") or 5000)
    budget = int(total_budget or min(int(req.get("total_budget_myr") or max_per * n), max_per * n))
    min_cov = float(
        min_operational_coverage
        if min_operational_coverage is not None
        else req.get("min_operational_coverage_ratio") or 0.7
    )
    portfolios = build_three_portfolios(
        trigger.get("employees") or [],
        courses,
        max_cost_per_employee=max_per,
        total_budget=budget,
        min_operational_coverage=min_cov,
    )
    version = portfolio_version_hash(portfolios)
    checkpoint_synced = False
    portfolio_ids: dict[str, str] = {}
    if apply:
        portfolio_ids = run_store.save_portfolios(run_id, portfolios)
        sync = sync_portfolios_into_checkpoint(
            run_id, portfolios=portfolios, portfolio_ids=portfolio_ids
        )
        version = sync["portfolio_version"]
        checkpoint_synced = bool(sync["checkpoint_synced"])
        audit.append_event(
            run_id=run_id,
            event_type="optimizer.what_if",
            actor_id="system",
            actor_role="system",
            payload={
                "max_per": max_per,
                "budget": budget,
                "min_cov": min_cov,
                "apply": True,
                "portfolio_version": version,
                "checkpoint_synced": checkpoint_synced,
            },
        )
    else:
        audit.append_event(
            run_id=run_id,
            event_type="optimizer.what_if.preview",
            actor_id="system",
            actor_role="system",
            payload={
                "max_per": max_per,
                "budget": budget,
                "min_cov": min_cov,
                "apply": False,
                "portfolio_version": version,
            },
        )
    return {
        "portfolios": portfolios,
        "applied": apply,
        "checkpoint_synced": checkpoint_synced,
        "portfolio_version": version,
        "portfolio_ids": portfolio_ids,
    }

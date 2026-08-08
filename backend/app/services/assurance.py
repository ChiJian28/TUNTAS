"""Assurance Monitor lifecycle — baseline at schedule time, refresh after simulations."""
from __future__ import annotations

from typing import Any

from app.agents import pipeline as agents
from app.security.crypto import hash_payload
from app.services import audit, evidence, runs as run_store
from app.services.handoff_contract import validate_handoff_envelope


def refresh_assurance(
    run_id: str,
    *,
    trigger: dict[str, Any] | None = None,
    portfolios: list[dict[str, Any]] | None = None,
    selected_option_key: str | None = None,
    phase: str = "post_training",
) -> dict[str, Any]:
    """Recompute Kirkpatrick/residual risk from current readiness_evidence."""
    run = run_store.get_run(run_id)
    if not run:
        raise ValueError("run not found")
    trigger = trigger or run.get("trigger_payload") or {}
    if portfolios is None:
        portfolios = run.get("options") or []
    if selected_option_key is None:
        # Prefer selected portfolio label key from options + selected_option_id
        selected_option_key = None
        sid = run.get("selected_option_id")
        if sid:
            for o in portfolios:
                if str(o.get("id")) == str(sid):
                    selected_option_key = o.get("option_key")
                    break
        if not selected_option_key and portfolios:
            selected_option_key = portfolios[0].get("option_key")

    # Normalize portfolio shape from DB rows
    norm_portfolios = []
    for p in portfolios:
        norm_portfolios.append(
            {
                "option_key": p.get("option_key"),
                "label": p.get("label"),
                "coverage_score": p.get("coverage_score") or 0,
                "hard_constraint_ok": p.get("hard_constraint_ok", True),
                "total_cost_myr": p.get("total_cost_myr") or 0,
            }
        )

    result = agents.run_assurance_monitor(
        trigger=trigger,
        portfolios=norm_portfolios,
        selected_option_key=selected_option_key,
        run_id=run_id,
    )
    out = result.get("output") or {}
    out["phase"] = phase
    result["output"] = out

    envelope = validate_handoff_envelope(
        agent_name="assurance_monitor",
        input_hash=hash_payload({"run_id": run_id, "phase": phase}),
        output=out,
        confidence=result.get("confidence"),
        requires_review=False,
        citation_coverage=1.0,
    )
    run_store.save_handoff(
        run_id,
        agent_name="assurance_monitor",
        input_hash=envelope["input_hash"],
        output_json=envelope,
        citation_coverage=1.0,
        latency_ms=0,
        model_name=None,
    )
    node_id = evidence.upsert_node(
        run_id=run_id,
        node_type="assurance_snapshot",
        external_ref=f"assurance-{phase}-{run_id[:8]}",
        label=f"Assurance ({phase})",
        payload=out,
    )
    audit.append_event(
        run_id=run_id,
        event_type=f"assurance.{phase}.refreshed",
        actor_id="system",
        actor_role="system",
        payload={
            "node_id": node_id,
            "level3_proofs": (out.get("kirkpatrick") or {}).get("L3_behavior", {}).get(
                "level3_proofs"
            ),
            "residual_risk": out.get("residual_risk"),
        },
    )
    return {"run_id": run_id, "phase": phase, "assurance": out, "node_id": node_id}

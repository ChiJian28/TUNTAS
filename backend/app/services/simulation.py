from __future__ import annotations

import json
from typing import Any

from app.db.session import db_conn
from app.security.crypto import hash_payload
from app.services import evidence
from app.services.rubric import score_attempt_deterministic


def submit_attempt(
    *,
    scenario_id: str,
    employee_ref: str,
    responses: dict[str, Any],
) -> dict[str, Any]:
    """Score with deterministic rubric only — Gemini is not used for Level awards."""
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, run_id::text, code, title, role_focus, rubric, prompt
                FROM tuntas.scenarios WHERE id = %s::uuid
                """,
                (scenario_id,),
            )
            scenario = cur.fetchone()
            if not scenario:
                raise ValueError("scenario not found")

    rubric = scenario["rubric"]
    if isinstance(rubric, str):
        rubric = json.loads(rubric)
    scored = score_attempt_deterministic(rubric=rubric or [], responses=responses)
    evidence_hash = hash_payload(
        {
            "scenario_id": scenario_id,
            "employee_ref": employee_ref,
            "responses": responses,
            "score": scored["score"],
            "level_awarded": scored["level_awarded"],
            "scoring_method": scored["scoring_method"],
        }
    )
    feedback = {
        "text": scored["feedback"],
        "criterion_scores": scored["criterion_scores"],
        "proof_of_level3": scored["proof_of_level3"],
        "scoring_method": scored["scoring_method"],
        "critical_fail": scored["critical_fail"],
    }
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tuntas.simulation_attempts
                  (scenario_id, employee_ref, responses, score, level_awarded, feedback, evidence_hash)
                VALUES (%s::uuid, %s, %s::jsonb, %s, %s, %s::jsonb, %s)
                RETURNING id::text
                """,
                (
                    scenario_id,
                    employee_ref,
                    json.dumps(responses),
                    scored["score"],
                    scored["level_awarded"],
                    json.dumps(feedback),
                    evidence_hash,
                ),
            )
            attempt_id = cur.fetchone()["id"]
            # readiness_evidence row
            cur.execute(
                """
                INSERT INTO tuntas.readiness_evidence
                  (run_id, employee_ref, scenario_code, attempt_id, level_awarded, score, evidence_hash, method)
                VALUES (%s::uuid, %s, %s, %s::uuid, %s, %s, %s, 'deterministic_rubric_v1')
                """,
                (
                    scenario["run_id"],
                    employee_ref,
                    scenario["code"],
                    attempt_id,
                    scored["level_awarded"],
                    scored["score"],
                    evidence_hash,
                ),
            )
        conn.commit()

    run_id = scenario["run_id"]
    att_node = evidence.upsert_node(
        run_id=run_id,
        node_type="simulation_attempt",
        external_ref=attempt_id,
        label=f"Attempt {scenario['code']}",
        payload={
            "employee_ref": employee_ref,
            "score": scored["score"],
            "level_awarded": scored["level_awarded"],
            "evidence_hash": evidence_hash,
            "scoring_method": "deterministic_rubric_v1",
        },
    )
    emp_node = evidence.upsert_node(
        run_id=run_id,
        node_type="employee",
        external_ref=employee_ref,
        label=employee_ref,
        payload={},
    )
    evidence.link(
        run_id=run_id,
        from_node_id=emp_node,
        to_node_id=att_node,
        edge_type="demonstrates_behavior",
    )
    # Post-training assurance refresh (plan: behaviour evidence → residual risk)
    assurance_snapshot = None
    assurance_error = None
    try:
        from app.services.assurance import refresh_assurance

        assurance_snapshot = refresh_assurance(run_id, phase="post_training")
    except Exception as exc:  # noqa: BLE001
        assurance_error = str(exc)[:300]
    return {
        "attempt_id": attempt_id,
        "score": scored["score"],
        "level_awarded": scored["level_awarded"],
        "evidence_hash": evidence_hash,
        "feedback": feedback,
        "assurance_phase": "post_training",
        "assurance_refreshed": assurance_snapshot is not None,
        "assurance_error": assurance_error,
        "residual_risk": (assurance_snapshot or {}).get("assurance", {}).get("residual_risk")
        if assurance_snapshot
        else None,
    }

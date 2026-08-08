"""Adaptive multi-turn simulation — LLM drives dialogue; rubric scores at finalize."""
from __future__ import annotations

import json
from typing import Any

from app.db.session import db_conn
from app.services.llm import GeminiClient
from app.services.simulation import submit_attempt


def _load_scenario(scenario_id: str) -> dict[str, Any]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, run_id::text, code, title, role_focus, rubric, prompt
                FROM tuntas.scenarios WHERE id = %s::uuid
                """,
                (scenario_id,),
            )
            row = cur.fetchone()
    if not row:
        raise ValueError("scenario not found")
    rubric = row["rubric"]
    if isinstance(rubric, str):
        rubric = json.loads(rubric)
    row["rubric"] = rubric or []
    return row


def _signals_from_rubric(rubric: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    for item in rubric:
        for s in item.get("required_signals") or []:
            if s and str(s) not in out:
                out.append(str(s))
    return out[:20]


def start_session(*, scenario_id: str, employee_ref: str) -> dict[str, Any]:
    """Open an adaptive dialogue; turn 0 is LLM-generated scene setup."""
    scenario = _load_scenario(scenario_id)
    client = GeminiClient()
    signals = _signals_from_rubric(scenario["rubric"])
    schema = {
        "type": "object",
        "properties": {
            "narrator": {"type": "string"},
            "npc_message": {"type": "string"},
            "situation": {"type": "string"},
            "difficulty": {
                "type": "string",
                "enum": ["standard", "elevated", "critical"],
            },
            "choices_hint": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["narrator", "npc_message", "situation", "difficulty", "choices_hint"],
    }
    prompt = (
        f"Start an adaptive AmBank capability drill.\n"
        f"Scenario: {scenario['code']} — {scenario['title']}\n"
        f"Role focus: {scenario['role_focus']}\n"
        f"Base prompt: {scenario['prompt']}\n"
        f"Behaviour signals the learner should eventually demonstrate: {signals}\n"
        "Generate turn 0. Do NOT award Level 3. Do NOT reveal the rubric answers."
    )
    from app.agents.base import timed_llm_json

    data, model, ms = timed_llm_json(
        client,
        prompt=prompt,
        schema=schema,
        system=(
            "You are TUNTAS adaptive simulation narrator. "
            "Escalate difficulty when the learner is shallow; introduce complications on weak answers. "
            "Never score Level 3 yourself."
        ),
    )

    turn0 = {
        "turn": 0,
        "role": "system",
        "difficulty": data.get("difficulty") or "standard",
        "narrator": data.get("narrator"),
        "npc_message": data.get("npc_message"),
        "situation": data.get("situation"),
        "choices_hint": data.get("choices_hint") or [],
        "model_name": model,
        "latency_ms": ms,
    }
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tuntas.simulation_sessions
                  (scenario_id, run_id, employee_ref, status, turns, difficulty)
                VALUES (%s::uuid, %s::uuid, %s, 'in_progress', %s::jsonb, %s)
                RETURNING id::text, status, difficulty
                """,
                (
                    scenario_id,
                    scenario["run_id"],
                    employee_ref,
                    json.dumps([turn0]),
                    turn0["difficulty"],
                ),
            )
            row = cur.fetchone()
        conn.commit()
    return {
        "session_id": row["id"],
        "scenario_id": scenario_id,
        "employee_ref": employee_ref,
        "status": row["status"],
        "difficulty": row["difficulty"],
        "turn": turn0,
        "adaptive": True,
        "scoring": "deferred_until_finalize_deterministic_rubric",
    }


def submit_turn(*, session_id: str, learner_action: str, actions: list[str] | None = None) -> dict[str, Any]:
    """Learner acts; LLM adapts next turn (difficulty / complications)."""
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, scenario_id::text, employee_ref, status, turns, difficulty
                FROM tuntas.simulation_sessions WHERE id = %s::uuid
                """,
                (session_id,),
            )
            sess = cur.fetchone()
    if not sess:
        raise ValueError("session not found")
    if sess["status"] != "in_progress":
        raise ValueError(f"session status={sess['status']} cannot accept turns")

    turns = sess["turns"]
    if isinstance(turns, str):
        turns = json.loads(turns)
    turns = list(turns or [])
    scenario = _load_scenario(sess["scenario_id"])
    signals = _signals_from_rubric(scenario["rubric"])

    learner_turn = {
        "turn": len(turns),
        "role": "learner",
        "action": learner_action,
        "actions": actions or [],
    }
    turns.append(learner_turn)

    # Adaptivity heuristic before LLM: escalate if few rubric signals present
    blob = (learner_action + " " + " ".join(actions or [])).lower()
    hits = sum(1 for s in signals if s.lower() in blob)
    prior_diff = sess.get("difficulty") or "standard"
    if hits == 0:
        target_diff = "critical"
    elif hits < max(1, len(signals) // 3):
        target_diff = "elevated"
    else:
        target_diff = "standard"
    # ratchet up, rarely down mid-drill
    order = {"standard": 0, "elevated": 1, "critical": 2}
    if order.get(target_diff, 0) < order.get(prior_diff, 0):
        target_diff = prior_diff

    client = GeminiClient()
    schema = {
        "type": "object",
        "properties": {
            "narrator": {"type": "string"},
            "npc_message": {"type": "string"},
            "situation": {"type": "string"},
            "difficulty": {
                "type": "string",
                "enum": ["standard", "elevated", "critical"],
            },
            "complication": {"type": "string"},
            "continue": {"type": "boolean"},
            "choices_hint": {"type": "array", "items": {"type": "string"}},
        },
        "required": [
            "narrator",
            "npc_message",
            "situation",
            "difficulty",
            "complication",
            "continue",
            "choices_hint",
        ],
    }
    recent = turns[-6:]
    prompt = (
        f"Continue adaptive drill {scenario['code']} for role {scenario['role_focus']}.\n"
        f"Target difficulty: {target_diff}. Prior difficulty: {prior_diff}.\n"
        f"Signal coverage so far (approx): {hits}/{len(signals)}.\n"
        f"Recent turns: {json.dumps(recent)[:5000]}\n"
        "If learner was vague, introduce a complication (deepfake, mule pressure, manager override).\n"
        "Set continue=false after enough evidence (usually 3+ learner turns) or when scene naturally ends.\n"
        "Do NOT award levels."
    )
    from app.agents.base import timed_llm_json

    data, model, ms = timed_llm_json(
        client,
        prompt=prompt,
        schema=schema,
        system="Adaptive simulation narrator. Escalate on weak behaviour; never score Level 3.",
    )
    npc_turn = {
        "turn": len(turns),
        "role": "system",
        "difficulty": data.get("difficulty") or target_diff,
        "narrator": data.get("narrator"),
        "npc_message": data.get("npc_message"),
        "situation": data.get("situation"),
        "complication": data.get("complication"),
        "choices_hint": data.get("choices_hint") or [],
        "continue": bool(data.get("continue", True)),
        "model_name": model,
        "latency_ms": ms,
    }
    turns.append(npc_turn)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE tuntas.simulation_sessions
                SET turns = %s::jsonb, difficulty = %s, updated_at = now()
                WHERE id = %s::uuid
                """,
                (json.dumps(turns), npc_turn["difficulty"], session_id),
            )
        conn.commit()

    return {
        "session_id": session_id,
        "status": "in_progress",
        "difficulty": npc_turn["difficulty"],
        "learner_turn": learner_turn,
        "turn": npc_turn,
        "can_finalize": (not npc_turn["continue"])
        or sum(1 for t in turns if t.get("role") == "learner") >= 3,
        "adaptive": True,
    }


def get_session(session_id: str) -> dict[str, Any] | None:
    """Authoritative session resume payload (turns included)."""
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text AS session_id, scenario_id::text, run_id::text, employee_ref,
                       status, turns, difficulty, attempt_id::text, created_at, updated_at
                FROM tuntas.simulation_sessions WHERE id = %s::uuid
                """,
                (session_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    turns = d.get("turns")
    if isinstance(turns, str):
        turns = json.loads(turns)
    d["turns"] = turns or []
    d["adaptive"] = True
    return d


def list_sessions_for_scenario(scenario_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text AS session_id, scenario_id::text, run_id::text, employee_ref,
                       status, turns, difficulty, attempt_id::text, created_at, updated_at
                FROM tuntas.simulation_sessions
                WHERE scenario_id = %s::uuid
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (scenario_id, limit),
            )
            out = []
            for row in cur.fetchall():
                d = dict(row)
                turns = d.get("turns")
                if isinstance(turns, str):
                    turns = json.loads(turns)
                d["turns"] = turns or []
                d["adaptive"] = True
                out.append(d)
            return out


def abandon_session(*, session_id: str) -> dict[str, Any]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE tuntas.simulation_sessions
                SET status = 'abandoned', updated_at = now()
                WHERE id = %s::uuid AND status = 'in_progress'
                RETURNING id::text AS session_id, scenario_id::text, run_id::text, employee_ref,
                          status, turns, difficulty, attempt_id::text, created_at, updated_at
                """,
                (session_id,),
            )
            row = cur.fetchone()
        conn.commit()
    if not row:
        existing = get_session(session_id)
        if not existing:
            raise ValueError("session not found")
        if existing["status"] != "in_progress":
            raise ValueError(f"session status={existing['status']} cannot abandon")
        raise ValueError("session not found")
    d = dict(row)
    turns = d.get("turns")
    if isinstance(turns, str):
        turns = json.loads(turns)
    d["turns"] = turns or []
    d["adaptive"] = True
    return d


def finalize_session(*, session_id: str) -> dict[str, Any]:
    """Close dialogue and score with deterministic rubric (not LLM)."""
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, scenario_id::text, employee_ref, status, turns
                FROM tuntas.simulation_sessions WHERE id = %s::uuid
                """,
                (session_id,),
            )
            sess = cur.fetchone()
    if not sess:
        raise ValueError("session not found")
    if sess["status"] == "scored":
        raise ValueError("session already scored")

    turns = sess["turns"]
    if isinstance(turns, str):
        turns = json.loads(turns)
    actions: list[str] = []
    notes: list[str] = []
    for t in turns or []:
        if t.get("role") != "learner":
            continue
        if t.get("action"):
            notes.append(str(t["action"]))
        actions.extend(str(a) for a in (t.get("actions") or []))
        actions.append(str(t.get("action") or ""))

    responses = {
        "actions": [a for a in actions if a.strip()],
        "notes": " | ".join(notes),
        "adaptive_turns": len([t for t in turns if t.get("role") == "learner"]),
        "dialogue": turns,
        "mode": "adaptive_multi_turn",
    }
    scored = submit_attempt(
        scenario_id=sess["scenario_id"],
        employee_ref=sess["employee_ref"],
        responses=responses,
    )

    # Persist post-training assessment row
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE tuntas.simulation_sessions
                SET status = 'scored', attempt_id = %s::uuid, updated_at = now(), turns = %s::jsonb
                WHERE id = %s::uuid
                """,
                (scored["attempt_id"], json.dumps(turns), session_id),
            )
            cur.execute(
                """
                SELECT role_focus, run_id::text, code FROM tuntas.scenarios WHERE id = %s::uuid
                """,
                (sess["scenario_id"],),
            )
            scn = cur.fetchone()
            cur.execute(
                "SELECT role_code FROM tuntas.employees WHERE employee_ref = %s",
                (sess["employee_ref"],),
            )
            emp_row = cur.fetchone()
            role_code = (emp_row or {}).get("role_code")
            cur.execute(
                """
                INSERT INTO tuntas.assessments
                  (employee_ref, role_code, assessment_type, competency_code,
                   level_before, level_after, source, run_id, evidence_ref, payload)
                VALUES (%s, %s, 'simulation', NULL, NULL, %s, 'simulation_attempt',
                        %s::uuid, %s, %s::jsonb)
                """,
                (
                    sess["employee_ref"],
                    role_code,
                    scored["level_awarded"],
                    scn["run_id"] if scn else None,
                    scored["attempt_id"],
                    json.dumps(
                        {
                            "scenario_code": scn["code"] if scn else None,
                            "role_focus": scn["role_focus"] if scn else None,
                            "score": scored["score"],
                            "session_id": session_id,
                            "adaptive": True,
                        }
                    ),
                ),
            )
        conn.commit()

    return {
        **scored,
        "session_id": session_id,
        "adaptive": True,
        "status": "scored",
        "learner_turns": sum(1 for t in turns if t.get("role") == "learner"),
    }

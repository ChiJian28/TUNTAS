"""Serial department HITL gates.

Agents still compute the full pack first. Humans then walk Compliance →
Procurement → Learning → Operations → Management. Only Management may
call the existing LangGraph /decision COMMIT (sessions, assignments,
artifacts). Gates 1–4 persist audit + gate rows and never unlock Delivery.

Circular / Scenario B still requires Procurement: confirm the in-force
catalogue covers OR-TC (no automatic new RFP; Challenger vetoes still apply).
skip_on_circular remains available but no gate uses it.
"""
from __future__ import annotations

import json
from typing import Any, Literal

from app.db.session import db_conn
from app.security.crypto import hash_payload
from app.services import audit
from app.services import runs as run_store

GateKey = Literal["compliance", "procurement", "learning", "operations", "management"]
ReviewPath = Literal["capability", "circular"]
GateStatus = Literal["pending", "active", "approved", "rejected", "skipped"]

GATE_KEYS: tuple[GateKey, ...] = (
    "compliance",
    "procurement",
    "learning",
    "operations",
    "management",
)

# skip_on_circular: reserved. No current gate skips on circular.
GATE_SPECS: tuple[dict[str, Any], ...] = (
    {
        "key": "compliance",
        "sequence": 1,
        "label": "Compliance",
        "prompt_capability": "Gap analysis, policy mapping, and blast radius are correct?",
        "prompt_circular": "OR-TC 2026/1 impact assessment OK? (Expected vs Found)",
        "allowed_roles": frozenset({"compliance", "manager", "admin", "mcp_service"}),
        "revise_stage": "parallel_intake",
        "skip_on_circular": False,
        "commits": False,
    },
    {
        "key": "procurement",
        "sequence": 2,
        "label": "Procurement",
        "prompt_capability": "Vendor shortlist and Challenger vetoes OK?",
        "prompt_circular": "Can in-force vendors cover OR-TC without a new buy? Challenger vetoes still apply.",
        "allowed_roles": frozenset({"manager", "admin", "mcp_service"}),
        "revise_stage": "challenger",
        "skip_on_circular": False,
        "commits": False,
    },
    {
        "key": "learning",
        "sequence": 3,
        "label": "Learning",
        "prompt_capability": "Scenarios, rubric, and training path OK?",
        "prompt_circular": "Remediation portfolio for only the 3 stale programmes OK?",
        "allowed_roles": frozenset({"analyst", "manager", "admin", "mcp_service"}),
        "revise_stage": "learning_architect",
        "skip_on_circular": False,
        "commits": False,
    },
    {
        "key": "operations",
        "sequence": 4,
        "label": "Operations",
        "prompt_capability": "Operational coverage and budget band are feasible?",
        "prompt_circular": "7-person retraining + operational coverage what-if OK?",
        "allowed_roles": frozenset({"manager", "admin", "mcp_service"}),
        "revise_stage": "optimizer",
        "skip_on_circular": False,
        "commits": False,
    },
    {
        "key": "management",
        "sequence": 5,
        "label": "Management",
        "prompt_capability": "Select a portfolio and COMMIT schedule / artifacts?",
        "prompt_circular": "Confirm which plan to schedule? Playbook 2 ends at COMMIT — do not reopen red paths.",
        "allowed_roles": frozenset({"manager", "admin", "mcp_service"}),
        "revise_stage": "secretariat",
        "skip_on_circular": False,
        "commits": True,
    },
)

SPEC_BY_KEY = {s["key"]: s for s in GATE_SPECS}

STAGE_RESET_FROM: dict[str, GateKey] = {
    "parallel_intake": "compliance",
    "learning_architect": "learning",
    "challenger": "procurement",
    "optimizer": "operations",
    "secretariat": "management",
}

DECIDABLE_RUN_STATUSES = frozenset({"awaiting_approval", "needs_policy_recompile"})
CHAIN_INIT_STATUSES = frozenset(
    {"awaiting_approval", "needs_policy_recompile", "revising"}
)
POST_COMMIT_STATUSES = frozenset({"completed", "rejected"})


def circular_hitl_needs_rearm(run_status: str) -> bool:
    """True when a circular may re-open department gates without reopen=true."""
    return run_status in POST_COMMIT_STATUSES


class ReviewGateError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status_code: int = 409,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details or {}


def spec_for(gate_key: str) -> dict[str, Any]:
    spec = SPEC_BY_KEY.get(gate_key)
    if not spec:
        raise ReviewGateError(f"Unknown gate_key {gate_key}", status_code=400)
    return spec


def prompt_for(spec: dict[str, Any], path: ReviewPath) -> str:
    if path == "circular":
        return str(spec["prompt_circular"])
    return str(spec["prompt_capability"])


def is_skipped_on_path(spec: dict[str, Any], path: ReviewPath) -> bool:
    return bool(spec.get("skip_on_circular")) and path == "circular"


def detect_path(run_id: str) -> ReviewPath:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1
                FROM tuntas.evidence_nodes
                WHERE run_id = %s::uuid
                  AND (
                    node_type = 'policy_circular'
                    OR (
                      node_type = 'policy_clause'
                      AND payload->>'framework_code' = 'BNM_ORTC_2026'
                    )
                  )
                LIMIT 1
                """,
                (run_id,),
            )
            return "circular" if cur.fetchone() else "capability"


def missing_prior_keys(rows: list[dict[str, Any]], gate_key: str) -> list[str]:
    spec = spec_for(gate_key)
    seq = int(spec["sequence"])
    missing: list[str] = []
    for row in sorted(rows, key=lambda r: int(r["sequence"])):
        if int(row["sequence"]) >= seq:
            break
        if row["status"] == "skipped":
            continue
        if row["status"] != "approved":
            missing.append(row["gate_key"])
    return missing


def commit_missing(rows: list[dict[str, Any]]) -> list[str]:
    """Non-management gates that must be approved (or skipped) before COMMIT."""
    missing: list[str] = []
    for row in sorted(rows, key=lambda r: int(r["sequence"])):
        if row["gate_key"] == "management":
            continue
        if row["status"] == "skipped":
            continue
        if row["status"] != "approved":
            missing.append(row["gate_key"])
    return missing


def pick_current_row(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    ordered = sorted(rows, key=lambda r: int(r["sequence"]))
    rejected = [r for r in ordered if r["status"] == "rejected"]
    if rejected:
        return rejected[0]
    for row in ordered:
        if row["status"] not in {"approved", "skipped"}:
            return row
    return None


def _row_to_public(
    row: dict[str, Any],
    *,
    path: ReviewPath,
    current_key: str | None,
    run_status: str,
    actor_role: str | None,
) -> dict[str, Any]:
    spec = spec_for(row["gate_key"])
    cond = row.get("conditions") or []
    if isinstance(cond, str):
        cond = json.loads(cond)
    status = row["status"]
    commits = bool(spec["commits"])
    skipped = status == "skipped"
    role_ok = bool(
        actor_role
        and (actor_role in spec["allowed_roles"] or actor_role == "admin")
    )
    run_ok = run_status in DECIDABLE_RUN_STATUSES
    is_current = current_key == row["gate_key"]
    can_open = is_current and status in {"active", "rejected", "pending"} and not skipped
    blocked_by: str | None = None
    if skipped:
        blocked_by = "skipped_on_circular_path"
    elif commits:
        blocked_by = "commits_via_post_decision"
    elif run_status == "revising":
        blocked_by = "pipeline_revising"
    elif not run_ok:
        blocked_by = f"run_status:{run_status}"
    elif status == "approved":
        blocked_by = "already_approved"
    elif not is_current:
        blocked_by = f"waiting_for:{current_key}" if current_key else "not_current"
    elif not role_ok:
        blocked_by = "insufficient_role"

    can_decide = (
        (not skipped)
        and (not commits)
        and run_ok
        and can_open
        and role_ok
        and status != "approved"
    )

    return {
        "id": row.get("id"),
        "gate_key": row["gate_key"],
        "sequence": row["sequence"],
        "label": spec["label"],
        "prompt": prompt_for(spec, path),
        "status": status,
        "decision": row.get("decision"),
        "rationale": row.get("rationale"),
        "conditions": cond,
        "actor_id": row.get("actor_id"),
        "actor_role": row.get("actor_role"),
        "input_hash": row.get("input_hash"),
        "return_to_stage": row.get("return_to_stage"),
        "decided_at": row.get("decided_at"),
        "updated_at": row.get("updated_at"),
        "skipped": skipped,
        "commits": commits,
        "allowed_roles": sorted(spec["allowed_roles"]),
        "revise_stage": spec["revise_stage"],
        "can_decide": can_decide,
        "blocked_by": None if can_decide else blocked_by,
        "missing_priors": [],
    }


def _fetch_rows(cur, run_id: str, *, for_update: bool = False) -> list[dict[str, Any]]:
    sql = """
        SELECT id::text, run_id::text, gate_key, sequence, status, decision,
               rationale, conditions, actor_id, actor_role, input_hash,
               return_to_stage, decided_at, created_at, updated_at
        FROM tuntas.review_gates
        WHERE run_id = %s::uuid
        ORDER BY sequence
    """
    if for_update:
        sql += " FOR UPDATE"
    cur.execute(sql, (run_id,))
    rows = [dict(r) for r in cur.fetchall()]
    for row in rows:
        cond = row.get("conditions")
        if isinstance(cond, str):
            row["conditions"] = json.loads(cond)
        row["conditions"] = row.get("conditions") or []
    return rows


def _apply_path_and_current(cur, run_id: str, path: ReviewPath, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Skip Procurement on circular if it has not been decided. Recompute active."""
    by_key = {r["gate_key"]: r for r in rows}
    for spec in GATE_SPECS:
        row = by_key[spec["key"]]
        want_skip = is_skipped_on_path(spec, path)
        if want_skip and row["status"] in {"pending", "active"}:
            cur.execute(
                """
                UPDATE tuntas.review_gates
                SET status = 'skipped', updated_at = now()
                WHERE run_id = %s::uuid AND gate_key = %s
                """,
                (run_id, spec["key"]),
            )
            row["status"] = "skipped"
        elif (not want_skip) and row["status"] == "skipped" and row.get("decision") is None:
            cur.execute(
                """
                UPDATE tuntas.review_gates
                SET status = 'pending', updated_at = now()
                WHERE run_id = %s::uuid AND gate_key = %s
                """,
                (run_id, spec["key"]),
            )
            row["status"] = "pending"

    current = pick_current_row(list(by_key.values()))
    for spec in GATE_SPECS:
        row = by_key[spec["key"]]
        if row["status"] in {"approved", "skipped", "rejected"}:
            continue
        target = "active" if current and current["gate_key"] == spec["key"] else "pending"
        if row["status"] != target:
            cur.execute(
                """
                UPDATE tuntas.review_gates
                SET status = %s, updated_at = now()
                WHERE run_id = %s::uuid AND gate_key = %s
                """,
                (target, run_id, spec["key"]),
            )
            row["status"] = target
    return [by_key[s["key"]] for s in GATE_SPECS]


def _insert_missing(cur, run_id: str, path: ReviewPath) -> None:
    for spec in GATE_SPECS:
        initial = "skipped" if is_skipped_on_path(spec, path) else "pending"
        cur.execute(
            """
            INSERT INTO tuntas.review_gates (run_id, gate_key, sequence, status)
            VALUES (%s::uuid, %s, %s, %s)
            ON CONFLICT (run_id, gate_key) DO NOTHING
            """,
            (run_id, spec["key"], spec["sequence"], initial),
        )


def ensure_chain(run_id: str, *, path: ReviewPath | None = None) -> dict[str, Any]:
    """Create or repair gate rows. Safe to call repeatedly."""
    path = path or detect_path(run_id)
    with db_conn() as conn:
        with conn.cursor() as cur:
            _insert_missing(cur, run_id, path)
            rows = _fetch_rows(cur, run_id, for_update=True)
            rows = _apply_path_and_current(cur, run_id, path, rows)
        conn.commit()
    return _serialize_chain(run_id, path=path, rows=rows, actor_role=None)


def reset_chain(run_id: str, *, reason: str, actor_id: str = "system", actor_role: str = "system") -> dict[str, Any]:
    """Clear all decisions (reopen / full re-arm). Prior COMMIT is a separate table."""
    path = detect_path(run_id)
    with db_conn() as conn:
        with conn.cursor() as cur:
            _insert_missing(cur, run_id, path)
            cur.execute(
                """
                UPDATE tuntas.review_gates
                SET status = 'pending',
                    decision = NULL,
                    rationale = NULL,
                    conditions = '[]'::jsonb,
                    actor_id = NULL,
                    actor_role = NULL,
                    input_hash = NULL,
                    return_to_stage = NULL,
                    decided_at = NULL,
                    updated_at = now()
                WHERE run_id = %s::uuid
                """,
                (run_id,),
            )
            rows = _fetch_rows(cur, run_id, for_update=True)
            rows = _apply_path_and_current(cur, run_id, path, rows)
        conn.commit()
    audit.append_event(
        run_id=run_id,
        event_type="review.gates.reset",
        actor_id=actor_id,
        actor_role=actor_role,
        payload={"reason": reason, "path": path},
    )
    return _serialize_chain(run_id, path=path, rows=rows, actor_role=None)


def reset_from_stage(run_id: str, stage: str) -> dict[str, Any]:
    gate_key = STAGE_RESET_FROM.get(stage, "learning")
    return reset_from_gate(run_id, gate_key)


def reset_from_gate(run_id: str, from_key: str) -> dict[str, Any]:
    spec = spec_for(from_key)
    seq = int(spec["sequence"])
    path = detect_path(run_id)
    with db_conn() as conn:
        with conn.cursor() as cur:
            _insert_missing(cur, run_id, path)
            cur.execute(
                """
                UPDATE tuntas.review_gates
                SET status = 'pending',
                    decision = NULL,
                    rationale = NULL,
                    conditions = '[]'::jsonb,
                    actor_id = NULL,
                    actor_role = NULL,
                    input_hash = NULL,
                    return_to_stage = NULL,
                    decided_at = NULL,
                    updated_at = now()
                WHERE run_id = %s::uuid AND sequence >= %s
                """,
                (run_id, seq),
            )
            rows = _fetch_rows(cur, run_id, for_update=True)
            rows = _apply_path_and_current(cur, run_id, path, rows)
        conn.commit()
    return _serialize_chain(run_id, path=path, rows=rows, actor_role=None)


def apply_circular_path(
    run_id: str,
    *,
    actor_id: str = "system",
    actor_role: str = "system",
) -> dict[str, Any]:
    """After ingest_circular: mark path circular; re-arm HITL if the run already COMMITted."""
    run = run_store.get_run(run_id)
    if not run:
        raise ReviewGateError("run not found", status_code=404)
    if circular_hitl_needs_rearm(run["status"]):
        from app.services.circular import arm_circular_hitl_if_completed

        arm_circular_hitl_if_completed(
            run_id, actor_id=actor_id, actor_role=actor_role
        )
        return ensure_chain(run_id, path="circular")
    if run["status"] not in CHAIN_INIT_STATUSES | DECIDABLE_RUN_STATUSES:
        return get_chain(run_id)
    return ensure_chain(run_id, path="circular")


def _serialize_chain(
    run_id: str,
    *,
    path: ReviewPath,
    rows: list[dict[str, Any]],
    actor_role: str | None,
    run_status: str | None = None,
) -> dict[str, Any]:
    run = run_store.get_run(run_id)
    status = run_status or (run["status"] if run else "unknown")
    current = pick_current_row(rows)
    current_key = current["gate_key"] if current else None
    public = []
    for row in rows:
        item = _row_to_public(
            row,
            path=path,
            current_key=current_key,
            run_status=status,
            actor_role=actor_role,
        )
        item["missing_priors"] = missing_prior_keys(rows, row["gate_key"])
        if item["missing_priors"] and item["can_decide"]:
            item["can_decide"] = False
            item["blocked_by"] = "prior_gates:" + ",".join(item["missing_priors"])
        if actor_role and actor_role not in spec_for(row["gate_key"])["allowed_roles"]:
            if item["can_decide"]:
                item["can_decide"] = False
                item["blocked_by"] = "insufficient_role"
        public.append(item)
    missing = commit_missing(rows)
    commit_unlocked = (
        status in DECIDABLE_RUN_STATUSES
        and len(missing) == 0
        and (current_key == "management" or current_key is None)
    )
    return {
        "run_id": run_id,
        "path": path,
        "current_gate": current_key,
        "commit_unlocked": commit_unlocked,
        "commit_blocked_by": missing,
        "run_status": status,
        "gates": public,
    }


def get_chain(run_id: str, *, actor_role: str | None = None) -> dict[str, Any]:
    run = run_store.get_run(run_id)
    if not run:
        raise ReviewGateError("run not found", status_code=404)
    path = detect_path(run_id)
    if run["status"] in CHAIN_INIT_STATUSES | DECIDABLE_RUN_STATUSES:
        ensure_chain(run_id, path=path)
    with db_conn() as conn:
        with conn.cursor() as cur:
            rows = _fetch_rows(cur, run_id)
    if not rows:
        # Pipeline has not reached HITL yet — return catalog, no persistence.
        synthetic = []
        for spec in GATE_SPECS:
            skipped = is_skipped_on_path(spec, path)
            synthetic.append(
                {
                    "id": None,
                    "gate_key": spec["key"],
                    "sequence": spec["sequence"],
                    "status": "skipped" if skipped else "pending",
                    "decision": None,
                    "rationale": None,
                    "conditions": [],
                    "actor_id": None,
                    "actor_role": None,
                    "input_hash": None,
                    "return_to_stage": None,
                    "decided_at": None,
                    "updated_at": None,
                }
            )
        rows = synthetic
    return _serialize_chain(
        run_id, path=path, rows=rows, actor_role=actor_role, run_status=run["status"]
    )


def assert_commit_allowed(run_id: str) -> dict[str, Any]:
    chain = get_chain(run_id)
    if not chain["commit_unlocked"]:
        raise ReviewGateError(
            "Management COMMIT is blocked until prior department gates are approved.",
            status_code=409,
            details={
                "current_gate": chain["current_gate"],
                "missing_gates": chain["commit_blocked_by"],
                "path": chain["path"],
            },
        )
    return chain


def mark_management_decision(
    run_id: str,
    *,
    decision: str,
    rationale: str,
    conditions: list[str],
    actor_id: str,
    actor_role: str,
) -> None:
    status = {
        "approve": "approved",
        "reject": "rejected",
        "revise": "pending",
    }.get(decision, "pending")
    input_hash = hash_payload(
        {
            "gate_key": "management",
            "decision": decision,
            "rationale": rationale,
            "conditions": conditions,
        }
    )
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tuntas.review_gates (run_id, gate_key, sequence, status)
                VALUES (%s::uuid, 'management', 5, 'pending')
                ON CONFLICT (run_id, gate_key) DO NOTHING
                """,
                (run_id,),
            )
            if decision == "revise":
                cur.execute(
                    """
                    UPDATE tuntas.review_gates
                    SET status = 'pending',
                        decision = 'revise',
                        rationale = %s,
                        conditions = %s::jsonb,
                        actor_id = %s,
                        actor_role = %s,
                        input_hash = %s,
                        decided_at = now(),
                        updated_at = now()
                    WHERE run_id = %s::uuid AND gate_key = 'management'
                    """,
                    (
                        rationale,
                        json.dumps(conditions),
                        actor_id,
                        actor_role,
                        input_hash,
                        run_id,
                    ),
                )
            else:
                cur.execute(
                    """
                    UPDATE tuntas.review_gates
                    SET status = %s,
                        decision = %s,
                        rationale = %s,
                        conditions = %s::jsonb,
                        actor_id = %s,
                        actor_role = %s,
                        input_hash = %s,
                        decided_at = now(),
                        updated_at = now()
                    WHERE run_id = %s::uuid AND gate_key = 'management'
                    """,
                    (
                        status,
                        decision,
                        rationale,
                        json.dumps(conditions),
                        actor_id,
                        actor_role,
                        input_hash,
                        run_id,
                    ),
                )
        conn.commit()


def decide_department_gate(
    run_id: str,
    gate_key: str,
    *,
    decision: str,
    rationale: str,
    conditions: list[str] | None = None,
    actor_id: str,
    actor_role: str,
    return_to_stage: str | None = None,
) -> dict[str, Any]:
    """Approve / reject / revise gates 1–4. Never COMMITs."""
    spec = spec_for(gate_key)
    if spec["commits"]:
        raise ReviewGateError(
            "Management COMMIT must use POST /v1/runs/{id}/decision. "
            "This endpoint is only for department gates.",
            status_code=400,
            details={"gate_key": gate_key},
        )
    if decision not in {"approve", "reject", "revise"}:
        raise ReviewGateError("decision must be approve | reject | revise", status_code=400)
    if len((rationale or "").strip()) < 8:
        raise ReviewGateError("rationale must be at least 8 characters", status_code=400)
    if actor_role not in spec["allowed_roles"] and actor_role != "admin":
        raise ReviewGateError(
            f"Role {actor_role} cannot decide the {spec['label']} gate.",
            status_code=403,
            details={"allowed_roles": sorted(spec["allowed_roles"])},
        )

    run = run_store.get_run(run_id)
    if not run:
        raise ReviewGateError("run not found", status_code=404)
    if run["status"] not in DECIDABLE_RUN_STATUSES:
        raise ReviewGateError(
            f"Department gates only accept decisions when status is "
            f"awaiting_approval (got {run['status']}).",
            status_code=409,
        )

    conditions = conditions or []
    path = detect_path(run_id)
    stage = return_to_stage or spec["revise_stage"]
    input_hash = hash_payload(
        {
            "gate_key": gate_key,
            "decision": decision,
            "rationale": rationale.strip(),
            "conditions": conditions,
            "path": path,
        }
    )

    snapshot: list[dict[str, Any]] = []
    with db_conn() as conn:
        with conn.cursor() as cur:
            _insert_missing(cur, run_id, path)
            rows = _fetch_rows(cur, run_id, for_update=True)
            rows = _apply_path_and_current(cur, run_id, path, rows)
            snapshot = [dict(r) for r in rows]
            row = next((r for r in rows if r["gate_key"] == gate_key), None)
            if not row:
                raise ReviewGateError("gate row missing", status_code=500)
            if row["status"] == "skipped":
                raise ReviewGateError(
                    f"Gate {gate_key} is skipped on the {path} path.",
                    status_code=409,
                    details={"path": path, "gate_key": gate_key},
                )
            current = pick_current_row(rows)
            if not current or current["gate_key"] != gate_key:
                raise ReviewGateError(
                    f"Gate {gate_key} is not current. Current gate is "
                    f"{current['gate_key'] if current else 'none'}.",
                    status_code=409,
                    details={"current_gate": current["gate_key"] if current else None},
                )
            missing = missing_prior_keys(rows, gate_key)
            if missing:
                raise ReviewGateError(
                    "Prior department gates are not approved.",
                    status_code=409,
                    details={"missing_gates": missing},
                )
            if row["status"] == "approved":
                raise ReviewGateError("This gate is already approved.", status_code=409)

            if decision == "approve":
                cur.execute(
                    """
                    UPDATE tuntas.review_gates
                    SET status = 'approved',
                        decision = 'approve',
                        rationale = %s,
                        conditions = %s::jsonb,
                        actor_id = %s,
                        actor_role = %s,
                        input_hash = %s,
                        return_to_stage = NULL,
                        decided_at = now(),
                        updated_at = now()
                    WHERE run_id = %s::uuid AND gate_key = %s
                    """,
                    (
                        rationale.strip(),
                        json.dumps(conditions),
                        actor_id,
                        actor_role,
                        input_hash,
                        run_id,
                        gate_key,
                    ),
                )
            elif decision == "reject":
                cur.execute(
                    """
                    UPDATE tuntas.review_gates
                    SET status = 'rejected',
                        decision = 'reject',
                        rationale = %s,
                        conditions = %s::jsonb,
                        actor_id = %s,
                        actor_role = %s,
                        input_hash = %s,
                        return_to_stage = NULL,
                        decided_at = now(),
                        updated_at = now()
                    WHERE run_id = %s::uuid AND gate_key = %s
                    """,
                    (
                        rationale.strip(),
                        json.dumps(conditions),
                        actor_id,
                        actor_role,
                        input_hash,
                        run_id,
                        gate_key,
                    ),
                )
            else:
                cur.execute(
                    """
                    UPDATE tuntas.review_gates
                    SET status = 'pending',
                        decision = 'revise',
                        rationale = %s,
                        conditions = %s::jsonb,
                        actor_id = %s,
                        actor_role = %s,
                        input_hash = %s,
                        return_to_stage = %s,
                        decided_at = now(),
                        updated_at = now()
                    WHERE run_id = %s::uuid AND gate_key = %s
                    """,
                    (
                        rationale.strip(),
                        json.dumps(conditions),
                        actor_id,
                        actor_role,
                        input_hash,
                        stage,
                        run_id,
                        gate_key,
                    ),
                )
                seq = int(spec["sequence"])
                cur.execute(
                    """
                    UPDATE tuntas.review_gates
                    SET status = 'pending',
                        decision = NULL,
                        rationale = NULL,
                        conditions = '[]'::jsonb,
                        actor_id = NULL,
                        actor_role = NULL,
                        input_hash = NULL,
                        return_to_stage = NULL,
                        decided_at = NULL,
                        updated_at = now()
                    WHERE run_id = %s::uuid AND sequence > %s
                    """,
                    (run_id, seq),
                )
            rows = _fetch_rows(cur, run_id, for_update=True)
            if decision != "revise":
                rows = _apply_path_and_current(cur, run_id, path, rows)
        conn.commit()

    audit.append_event(
        run_id=run_id,
        event_type=f"review.gate.{decision}",
        actor_id=actor_id,
        actor_role=actor_role,
        payload={
            "gate_key": gate_key,
            "decision": decision,
            "rationale": rationale.strip(),
            "conditions": conditions,
            "input_hash": input_hash,
            "path": path,
            "return_to_stage": stage if decision == "revise" else None,
        },
    )

    langgraph_resumed = False
    if decision == "revise":
        try:
            langgraph_resumed = _resume_revise(
                run_id,
                stage=stage,
                rationale=rationale.strip(),
                conditions=conditions,
                actor_id=actor_id,
                actor_role=actor_role,
            )
        except Exception:
            _restore_rows(run_id, snapshot)
            raise

    chain = get_chain(run_id, actor_role=actor_role)
    message = {
        "approve": f"{spec['label']} approved. Next gate: {chain['current_gate']}.",
        "reject": f"{spec['label']} rejected. Delivery stays locked.",
        "revise": f"{spec['label']} sent back to {stage}. Subsequent gates reset.",
    }[decision]
    return {
        **chain,
        "message": message,
        "langgraph_resumed": langgraph_resumed,
        "decided_gate": gate_key,
        "decision": decision,
        "input_hash": input_hash,
    }


def _restore_rows(run_id: str, snapshot: list[dict[str, Any]]) -> None:
    with db_conn() as conn:
        with conn.cursor() as cur:
            for row in snapshot:
                cur.execute(
                    """
                    UPDATE tuntas.review_gates
                    SET status = %s,
                        decision = %s,
                        rationale = %s,
                        conditions = %s::jsonb,
                        actor_id = %s,
                        actor_role = %s,
                        input_hash = %s,
                        return_to_stage = %s,
                        decided_at = %s,
                        updated_at = now()
                    WHERE run_id = %s::uuid AND gate_key = %s
                    """,
                    (
                        row["status"],
                        row.get("decision"),
                        row.get("rationale"),
                        json.dumps(row.get("conditions") or []),
                        row.get("actor_id"),
                        row.get("actor_role"),
                        row.get("input_hash"),
                        row.get("return_to_stage"),
                        row.get("decided_at"),
                        run_id,
                        row["gate_key"],
                    ),
                )
        conn.commit()


def _resume_revise(
    run_id: str,
    *,
    stage: str,
    rationale: str,
    conditions: list[str],
    actor_id: str,
    actor_role: str,
) -> bool:
    from app.graph.workflow import resume_with_decision
    from app.services.cockpit import list_options_with_assignments

    options = list_options_with_assignments(run_id)
    option_key = "balanced"
    if options:
        option_key = next(
            (o["option_key"] for o in options if o["option_key"] == "balanced"),
            options[0]["option_key"],
        )
    allowed = {"parallel_intake", "learning_architect", "challenger", "optimizer", "secretariat"}
    if stage not in allowed:
        stage = "learning_architect"
    resume_with_decision(
        run_id,
        {
            "option_key": option_key,
            "decision": "revise",
            "rationale": rationale,
            "conditions": conditions,
            "actor_id": actor_id,
            "actor_role": actor_role,
            "return_to_stage": stage,
        },
    )
    return True

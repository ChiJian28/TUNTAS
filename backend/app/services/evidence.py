from __future__ import annotations

import json
from typing import Any

from app.db.session import db_conn
from app.security.crypto import dumps_json, hash_payload


def get_node(
    *,
    run_id: str,
    node_type: str,
    external_ref: str,
    conn: Any | None = None,
) -> dict[str, Any] | None:
    def _fetch(c: Any) -> dict[str, Any] | None:
        with c.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, node_type, external_ref, label, payload
                FROM tuntas.evidence_nodes
                WHERE run_id = %s::uuid AND node_type = %s AND external_ref = %s
                """,
                (run_id, node_type, external_ref),
            )
            row = cur.fetchone()
        return dict(row) if row else None

    if conn is not None:
        return _fetch(conn)
    with db_conn() as c:
        return _fetch(c)


def upsert_node(
    *,
    run_id: str,
    node_type: str,
    external_ref: str,
    label: str,
    payload: dict[str, Any] | None = None,
    conn: Any | None = None,
) -> str:
    payload = payload or {}
    content_hash = hash_payload(payload)

    def _upsert(c: Any) -> str:
        with c.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tuntas.evidence_nodes
                  (run_id, node_type, external_ref, label, payload, content_hash)
                VALUES (%s::uuid, %s, %s, %s, %s::jsonb, %s)
                ON CONFLICT (run_id, node_type, external_ref)
                DO UPDATE SET label = EXCLUDED.label,
                              payload = EXCLUDED.payload,
                              content_hash = EXCLUDED.content_hash
                RETURNING id::text
                """,
                (run_id, node_type, external_ref, label, dumps_json(payload), content_hash),
            )
            return cur.fetchone()["id"]

    if conn is not None:
        return _upsert(conn)
    with db_conn() as c:
        node_id = _upsert(c)
        c.commit()
        return node_id


def link(
    *,
    run_id: str,
    from_node_id: str,
    to_node_id: str,
    edge_type: str,
    weight: float = 1.0,
    payload: dict[str, Any] | None = None,
    conn: Any | None = None,
) -> None:
    payload = payload or {}

    def _link(c: Any) -> None:
        with c.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tuntas.evidence_edges
                  (run_id, from_node_id, to_node_id, edge_type, weight, payload)
                VALUES (%s::uuid, %s::uuid, %s::uuid, %s, %s, %s::jsonb)
                ON CONFLICT (from_node_id, to_node_id, edge_type)
                DO UPDATE SET
                  payload = COALESCE(tuntas.evidence_edges.payload, '{}'::jsonb)
                             || EXCLUDED.payload,
                  weight = EXCLUDED.weight
                """,
                (run_id, from_node_id, to_node_id, edge_type, weight, dumps_json(payload)),
            )

    if conn is not None:
        _link(conn)
        return
    with db_conn() as c:
        _link(c)
        c.commit()


def lineage(node_id: str, depth: int = 6) -> dict[str, Any]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH RECURSIVE walk AS (
                  SELECT e.id, e.from_node_id, e.to_node_id, e.edge_type, 1 AS depth
                  FROM tuntas.evidence_edges e
                  WHERE e.to_node_id = %s::uuid OR e.from_node_id = %s::uuid
                  UNION
                  SELECT e.id, e.from_node_id, e.to_node_id, e.edge_type, w.depth + 1
                  FROM tuntas.evidence_edges e
                  JOIN walk w ON e.from_node_id = w.to_node_id OR e.to_node_id = w.from_node_id
                  WHERE w.depth < %s
                )
                SELECT DISTINCT * FROM walk
                """,
                (node_id, node_id, depth),
            )
            edges = [dict(r) for r in cur.fetchall()]
            node_ids = {node_id}
            for e in edges:
                node_ids.add(str(e["from_node_id"]))
                node_ids.add(str(e["to_node_id"]))
            cur.execute(
                """
                SELECT id::text, node_type, external_ref, label, payload, content_hash
                FROM tuntas.evidence_nodes
                WHERE id = ANY(%s::uuid[])
                """,
                (list(node_ids),),
            )
            nodes = [dict(r) for r in cur.fetchall()]
    return {"root_node_id": node_id, "nodes": nodes, "edges": edges}


def _use_circular_scope(framework_code: str, policy_nodes: list[dict[str, Any]]) -> bool:
    """Scenario B: walk only ingest-created edges. Do not reuse RMiT competency-bridge."""
    from app.services.gold import gold_for_framework

    if gold_for_framework(framework_code):
        return True
    return any(
        (n.get("payload") or {}).get("circular_scoped")
        or (n.get("payload") or {}).get("circular_id")
        for n in policy_nodes
    )


def _framework_policy_nodes(
    cur: Any, run_id: str, framework_code: str
) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT id::text, node_type, external_ref, label, payload
        FROM tuntas.evidence_nodes
        WHERE run_id = %s::uuid
          AND node_type IN ('policy_clause', 'policy_circular')
          AND (
            payload->>'framework_code' = %s
            OR external_ref LIKE %s
            OR %s = ANY(
              SELECT jsonb_array_elements_text(
                COALESCE(payload->'framework_codes', '[]'::jsonb)
              )
            )
          )
        """,
        (run_id, framework_code, f"{framework_code}%", framework_code),
    )
    return [dict(r) for r in cur.fetchall()]


def _load_policy_seeds(
    run_id: str, framework_code: str
) -> tuple[list[dict[str, Any]], bool]:
    from app.services.gold import gold_for_framework

    with db_conn() as conn:
        with conn.cursor() as cur:
            policy_nodes = _framework_policy_nodes(cur, run_id, framework_code)
            circular_scope = _use_circular_scope(framework_code, policy_nodes)
            if not policy_nodes and not circular_scope:
                cur.execute(
                    """
                    SELECT id::text, node_type, external_ref, label, payload
                    FROM tuntas.evidence_nodes
                    WHERE run_id = %s::uuid
                      AND node_type = 'policy_clause'
                      AND (
                        payload->>'framework_code' ILIKE %s
                        OR payload::text ILIKE %s
                      )
                    """,
                    (run_id, f"%{framework_code}%", f"%{framework_code}%"),
                )
                policy_nodes = [dict(r) for r in cur.fetchall()]
                circular_scope = _use_circular_scope(framework_code, policy_nodes)
    return policy_nodes, circular_scope or bool(gold_for_framework(framework_code))


def blast_radius(run_id: str, framework_code: str) -> dict[str, Any]:
    """Find readiness paths affected by a policy framework version change.

    Default (legacy RMiT): bidirectional walk + competency bridge.

    Circular frameworks (BNM_ORTC_2026): walk only edges tagged
    `circular_scoped` / matching framework_code. Competency-bridge is skipped
    so CS staff with FSF_PR110 and lookalike syllabi stay green.
    """
    from app.services.gold import (
        compare_to_gold,
        excluded_active_codes,
        featured_green,
        featured_red,
        gold_for_framework,
    )

    gold = gold_for_framework(framework_code)
    policy_nodes, circular_scope = _load_policy_seeds(run_id, framework_code)
    if not policy_nodes and gold:
        from app.services.circular import ingest_circular

        ingest_circular(
            run_id,
            actor_id="system",
            actor_role="system",
            framework_code=framework_code,
            source="fixture",
        )
        policy_nodes, circular_scope = _load_policy_seeds(run_id, framework_code)
    if not policy_nodes:
        empty = {
            "framework_code": framework_code,
            "affected_nodes": [],
            "affected_employees": [],
            "affected_courses": [],
            "message": (
                "No BNM_ORTC_2026 clauses on this run. Call ingest_circular first."
                if gold
                else "No linked policy nodes for framework"
            ),
            "ingest_required": bool(gold),
            "walk": "circular_scoped" if circular_scope else "legacy",
        }
        if gold:
            empty["expected_vs_found"] = compare_to_gold(
                found_stale_course_codes=[],
                found_affected_employee_refs=[],
                gold=gold,
            )
        return empty

    with db_conn() as conn:
        with conn.cursor() as cur:
            ids = [n["id"] for n in policy_nodes]
            if circular_scope:
                cur.execute(
                    """
                    WITH RECURSIVE
                    seed AS (
                      SELECT unnest(%s::uuid[]) AS node_id, 0 AS depth
                    ),
                    walk AS (
                      SELECT node_id, depth FROM seed
                      UNION
                      SELECT CASE
                               WHEN e.from_node_id = w.node_id THEN e.to_node_id
                               ELSE e.from_node_id
                             END,
                             w.depth + 1
                      FROM tuntas.evidence_edges e
                      JOIN walk w
                        ON e.from_node_id = w.node_id OR e.to_node_id = w.node_id
                      WHERE w.depth < 10
                        AND (
                          COALESCE(e.payload->>'framework_code', '') = %s
                          OR COALESCE(e.payload->>'circular_scoped', '') IN ('true', 'True')
                        )
                    )
                    SELECT DISTINCT n.id::text, n.node_type, n.external_ref, n.label, n.payload
                    FROM tuntas.evidence_nodes n
                    JOIN walk w ON n.id = w.node_id
                    WHERE n.run_id = %s::uuid
                    """,
                    (ids, framework_code, run_id),
                )
                affected = [dict(r) for r in cur.fetchall()]
            else:
                cur.execute(
                    """
                    WITH RECURSIVE walk AS (
                      SELECT e.from_node_id AS node_id, 1 AS depth
                      FROM tuntas.evidence_edges e
                      WHERE e.from_node_id = ANY(%s::uuid[]) OR e.to_node_id = ANY(%s::uuid[])
                      UNION
                      SELECT CASE
                               WHEN e.from_node_id = w.node_id THEN e.to_node_id
                               ELSE e.from_node_id
                             END,
                             w.depth + 1
                      FROM tuntas.evidence_edges e
                      JOIN walk w ON e.from_node_id = w.node_id OR e.to_node_id = w.node_id
                      WHERE w.depth < 10
                    )
                    SELECT DISTINCT n.id::text, n.node_type, n.external_ref, n.label, n.payload
                    FROM tuntas.evidence_nodes n
                    JOIN walk w ON n.id = w.node_id
                    WHERE n.run_id = %s::uuid
                    """,
                    (ids, ids, run_id),
                )
                affected = [dict(r) for r in cur.fetchall()]

                # Competency bridge: employees/courses sharing competency codes
                # reached from policy→control→competency path. NOT used for circulars.
                comp_codes = [
                    n["external_ref"]
                    for n in affected
                    if n["node_type"] == "competency"
                ]
                if comp_codes:
                    cur.execute(
                        """
                        SELECT DISTINCT n.id::text, n.node_type, n.external_ref, n.label, n.payload
                        FROM tuntas.evidence_nodes n
                        JOIN tuntas.evidence_edges e
                          ON e.from_node_id = n.id OR e.to_node_id = n.id
                        JOIN tuntas.evidence_nodes c
                          ON c.id = e.from_node_id OR c.id = e.to_node_id
                        WHERE n.run_id = %s::uuid
                          AND c.run_id = %s::uuid
                          AND c.node_type = 'competency'
                          AND c.external_ref = ANY(%s)
                          AND n.node_type IN ('employee', 'course', 'approval', 'readiness')
                        """,
                        (run_id, run_id, comp_codes),
                    )
                    extra = [dict(r) for r in cur.fetchall()]
                    seen = {n["id"] for n in affected}
                    for n in extra:
                        if n["id"] not in seen:
                            affected.append(n)
                            seen.add(n["id"])

    exclude = excluded_active_codes(gold) if gold else {"GCX-REGTECH-ULTRA"}
    employees = sorted(
        {n["external_ref"] for n in affected if n["node_type"] == "employee"}
    )
    courses = sorted(
        {
            n["external_ref"]
            for n in affected
            if n["node_type"] == "course" and n["external_ref"] not in exclude
        }
    )
    result: dict[str, Any] = {
        "framework_code": framework_code,
        "seed_policy_nodes": policy_nodes,
        "affected_nodes": affected,
        "affected_employees": employees,
        "affected_courses": courses,
        "walk": "circular_scoped" if circular_scope else "legacy",
    }
    if gold:
        comparison = compare_to_gold(
            found_stale_course_codes=courses,
            found_affected_employee_refs=employees,
            gold=gold,
        )
        result["expected_vs_found"] = comparison
        result["featured_red"] = featured_red(gold)
        result["featured_green"] = featured_green(gold)
    return result


def reopen_affected_paths(
    run_id: str,
    *,
    framework_code: str,
    reason: str,
    actor_id: str,
    actor_role: str,
) -> dict[str, Any]:
    """Mark blast-radius employees/courses/readiness as stale and reopen run for recompile."""
    from app.services import audit

    radius = blast_radius(run_id, framework_code)
    employees = radius.get("affected_employees") or []
    courses = radius.get("affected_courses") or []
    stale_nodes = []
    with db_conn() as conn:
        with conn.cursor() as cur:
            for emp in employees:
                nid = upsert_node(
                    run_id=run_id,
                    node_type="readiness_stale",
                    external_ref=f"stale-{emp}-{framework_code}",
                    label=f"Stale readiness {emp}",
                    payload={
                        "employee_ref": emp,
                        "framework_code": framework_code,
                        "reason": reason,
                        "status": "reopened",
                    },
                )
                stale_nodes.append(nid)
            cur.execute(
                """
                UPDATE tuntas.workflow_runs
                SET status = 'needs_policy_recompile',
                    current_node = 'policy_compiler',
                    updated_at = now()
                WHERE id = %s::uuid
                """,
                (run_id,),
            )
            cur.execute(
                """
                UPDATE tuntas.readiness_evidence
                SET residual_risk = residual_risk || %s::jsonb
                WHERE run_id = %s::uuid AND employee_ref = ANY(%s)
                """,
                (
                    json.dumps(
                        {
                            "stale": True,
                            "framework_code": framework_code,
                            "reason": reason,
                        }
                    ),
                    run_id,
                    employees or ["__none__"],
                ),
            )
        conn.commit()
    audit.append_event(
        run_id=run_id,
        event_type="policy.blast_radius.reopened",
        actor_id=actor_id,
        actor_role=actor_role,
        payload={
            "framework_code": framework_code,
            "reason": reason,
            "affected_employees": employees,
            "affected_courses": courses,
            "stale_nodes": stale_nodes,
        },
    )
    return {
        "run_id": run_id,
        "status": "needs_policy_recompile",
        "framework_code": framework_code,
        "reopened_employees": employees,
        "reopened_courses": courses,
        "stale_node_ids": stale_nodes,
        "message": "Affected readiness paths marked stale; re-run policy compile / optimizer for those paths.",
    }

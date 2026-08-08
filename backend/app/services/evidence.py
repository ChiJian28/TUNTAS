from __future__ import annotations

import json
from typing import Any

from app.db.session import db_conn
from app.security.crypto import dumps_json, hash_payload


def upsert_node(
    *,
    run_id: str,
    node_type: str,
    external_ref: str,
    label: str,
    payload: dict[str, Any] | None = None,
) -> str:
    payload = payload or {}
    content_hash = hash_payload(payload)
    with db_conn() as conn:
        with conn.cursor() as cur:
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
            node_id = cur.fetchone()["id"]
        conn.commit()
    return node_id


def link(
    *,
    run_id: str,
    from_node_id: str,
    to_node_id: str,
    edge_type: str,
    weight: float = 1.0,
    payload: dict[str, Any] | None = None,
) -> None:
    payload = payload or {}
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tuntas.evidence_edges
                  (run_id, from_node_id, to_node_id, edge_type, weight, payload)
                VALUES (%s::uuid, %s::uuid, %s::uuid, %s, %s, %s::jsonb)
                ON CONFLICT (from_node_id, to_node_id, edge_type) DO NOTHING
                """,
                (run_id, from_node_id, to_node_id, edge_type, weight, dumps_json(payload)),
            )
        conn.commit()


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


def blast_radius(run_id: str, framework_code: str) -> dict[str, Any]:
    """Find readiness paths affected by a policy framework version change.

    Walks evidence edges in both directions from matching policy clauses, then
    expands through shared competencies to assigned employees/courses.
    """
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, node_type, external_ref, label, payload
                FROM tuntas.evidence_nodes
                WHERE run_id = %s::uuid
                  AND node_type = 'policy_clause'
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
            policy_nodes = [dict(r) for r in cur.fetchall()]
            if not policy_nodes:
                # Fallback: any clause whose source/framework naming matches
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
            if not policy_nodes:
                return {
                    "framework_code": framework_code,
                    "affected_nodes": [],
                    "affected_employees": [],
                    "affected_courses": [],
                    "message": "No linked policy nodes for framework",
                }
            ids = [n["id"] for n in policy_nodes]
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
            # reached from policy→control→competency path.
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

    employees = sorted(
        {n["external_ref"] for n in affected if n["node_type"] == "employee"}
    )
    courses = sorted(
        {n["external_ref"] for n in affected if n["node_type"] == "course"}
    )
    return {
        "framework_code": framework_code,
        "seed_policy_nodes": policy_nodes,
        "affected_nodes": affected,
        "affected_employees": employees,
        "affected_courses": courses,
    }

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

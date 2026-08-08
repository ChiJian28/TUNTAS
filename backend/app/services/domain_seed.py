"""Persist run domain rows (employees/policies/providers/courses) — not only evidence JSON."""
from __future__ import annotations

import json
from typing import Any

from app.db.session import db_conn
from app.security.crypto import sha256_hex
from app.services.fsf_ingest import ingest_fsf_skills
from app.services.llm import GeminiClient


def seed_run_domain(
    *,
    run_id: str,
    trigger: dict[str, Any],
    clauses: list[dict[str, Any]],
    courses: list[dict[str, Any]],
    embed: bool = True,
) -> dict[str, Any]:
    employees = trigger.get("employees") or []
    gap_codes = {
        g["code"]
        for e in employees
        for g in (e.get("competency_gaps") or [])
        if g.get("code")
    }
    ingested = ingest_fsf_skills(only_codes=gap_codes or None)

    client = GeminiClient() if embed else None
    stats = {
        "employees": 0,
        "competencies": ingested,
        "clauses": 0,
        "providers": 0,
        "courses": 0,
        "roles": 0,
        "assessments": 0,
    }

    with db_conn() as conn:
        with conn.cursor() as cur:
            # Upsert roles first (plan domain: employees/roles/competencies/assessments)
            role_seen: set[str] = set()
            for emp in employees:
                rcode = emp.get("role_code") or "UNKNOWN"
                if rcode in role_seen:
                    continue
                role_seen.add(rcode)
                focus = sorted(
                    {
                        g["code"]
                        for e in employees
                        if (e.get("role_code") or "UNKNOWN") == rcode
                        for g in (e.get("competency_gaps") or [])
                        if g.get("code")
                    }
                )
                cur.execute(
                    """
                    INSERT INTO tuntas.roles (code, title, unit_default, risk_tier, competency_focus, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (code) DO UPDATE SET
                      title = EXCLUDED.title,
                      competency_focus = EXCLUDED.competency_focus,
                      metadata = EXCLUDED.metadata
                    """,
                    (
                        rcode,
                        emp.get("role_title") or rcode,
                        emp.get("unit") or "",
                        "high" if "FRAUD" in rcode or "AML" in rcode or "COMPLIANCE" in rcode else "medium",
                        focus,
                        json.dumps({"seeded_from_run": run_id}),
                    ),
                )
                stats["roles"] += 1

            for emp in employees:
                cur.execute(
                    """
                    INSERT INTO tuntas.employees
                      (employee_ref, pseudonym, role_code, role_title, unit, location,
                       current_level, target_level, availability_pct, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (employee_ref) DO UPDATE SET
                      pseudonym = EXCLUDED.pseudonym,
                      role_code = EXCLUDED.role_code,
                      availability_pct = EXCLUDED.availability_pct,
                      metadata = EXCLUDED.metadata
                    RETURNING id
                    """,
                    (
                        emp["employee_ref"],
                        emp.get("pseudonym") or emp["employee_ref"],
                        emp.get("role_code") or "UNKNOWN",
                        emp.get("role_title") or emp.get("role_code") or "Unknown",
                        emp.get("unit") or "Unknown",
                        emp.get("location") or "MY",
                        int(emp.get("current_level") or 1),
                        int(emp.get("target_level") or 3),
                        float(emp.get("availability_pct") or 100),
                        json.dumps({"run_id": run_id, "gaps": emp.get("competency_gaps") or []}),
                    ),
                )
                emp_id = cur.fetchone()["id"]
                stats["employees"] += 1
                for g in emp.get("competency_gaps") or []:
                    cur.execute(
                        "SELECT id FROM tuntas.competencies WHERE code = %s",
                        (g["code"],),
                    )
                    crow = cur.fetchone()
                    if not crow:
                        cur.execute(
                            """
                            INSERT INTO tuntas.competencies (code, name, cluster, fsf_skill_code, description)
                            VALUES (%s, %s, %s, %s, %s)
                            ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
                            RETURNING id
                            """,
                            (
                                g["code"],
                                g.get("name") or g["code"],
                                "Imported",
                                g["code"],
                                g.get("name") or "",
                            ),
                        )
                        crow = cur.fetchone()
                    cur.execute(
                        """
                        INSERT INTO tuntas.employee_competencies
                          (employee_id, competency_id, current_level, target_level, gap_priority)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (employee_id, competency_id) DO UPDATE SET
                          current_level = EXCLUDED.current_level,
                          target_level = EXCLUDED.target_level,
                          gap_priority = EXCLUDED.gap_priority
                        """,
                        (
                            emp_id,
                            crow["id"],
                            int(g.get("current_level") or 1),
                            int(g.get("target_level") or 3),
                            int(g.get("gap_priority") or 1),
                        ),
                    )
                    cur.execute(
                        """
                        INSERT INTO tuntas.assessments
                          (employee_ref, role_code, assessment_type, competency_code,
                           level_before, level_after, source, run_id, evidence_ref, payload)
                        VALUES (%s, %s, 'baseline_gap', %s, %s, %s, 'trigger', %s::uuid, %s, %s::jsonb)
                        """,
                        (
                            emp["employee_ref"],
                            emp.get("role_code") or "UNKNOWN",
                            g["code"],
                            int(g.get("current_level") or 1),
                            int(g.get("target_level") or 3),
                            run_id,
                            f"gap:{g['code']}",
                            json.dumps({"gap_priority": g.get("gap_priority") or 1}),
                        ),
                    )
                    stats["assessments"] += 1

            # Policy documents + clauses (+ optional embeddings)
            by_fw: dict[str, list[dict[str, Any]]] = {}
            for c in clauses:
                by_fw.setdefault(c.get("framework_code") or "UNKNOWN", []).append(c)
            for fw, items in by_fw.items():
                body = "\n".join(f"{i['clause_ref']}: {i.get('body','')}" for i in items)
                source_hash = sha256_hex(body)
                cur.execute(
                    """
                    INSERT INTO tuntas.policy_documents
                      (framework_code, title, version, source_uri, source_hash, effective_date)
                    VALUES (%s, %s, %s, %s, %s, CURRENT_DATE)
                    ON CONFLICT (framework_code, version) DO UPDATE SET source_hash = EXCLUDED.source_hash
                    RETURNING id
                    """,
                    (
                        fw,
                        f"{fw} demo pack",
                        "2026-demo",
                        f"data/policies/{fw}",
                        source_hash,
                    ),
                )
                doc_id = cur.fetchone()["id"]
                for item in items:
                    emb = None
                    if client is not None:
                        try:
                            emb = client.embed(
                                f"{item.get('clause_ref')} {item.get('title')} {item.get('body')}"
                            )
                        except Exception:
                            emb = None
                    if emb is not None:
                        # pgvector accepts string '[1,2,...]'
                        emb_lit = "[" + ",".join(f"{x:.8f}" for x in emb) + "]"
                        cur.execute(
                            """
                            INSERT INTO tuntas.policy_clauses
                              (policy_document_id, clause_ref, title, body, embedding)
                            VALUES (%s, %s, %s, %s, %s::vector)
                            ON CONFLICT (policy_document_id, clause_ref) DO UPDATE SET
                              title = EXCLUDED.title,
                              body = EXCLUDED.body,
                              embedding = EXCLUDED.embedding
                            """,
                            (
                                doc_id,
                                item["clause_ref"],
                                item.get("title") or item["clause_ref"],
                                item.get("body") or "",
                                emb_lit,
                            ),
                        )
                    else:
                        cur.execute(
                            """
                            INSERT INTO tuntas.policy_clauses
                              (policy_document_id, clause_ref, title, body)
                            VALUES (%s, %s, %s, %s)
                            ON CONFLICT (policy_document_id, clause_ref) DO UPDATE SET
                              title = EXCLUDED.title,
                              body = EXCLUDED.body
                            """,
                            (
                                doc_id,
                                item["clause_ref"],
                                item.get("title") or item["clause_ref"],
                                item.get("body") or "",
                            ),
                        )
                    stats["clauses"] += 1

            providers: dict[str, Any] = {}
            for course in courses:
                pcode = course.get("provider_code") or "UNKNOWN"
                if pcode not in providers:
                    cur.execute(
                        """
                        INSERT INTO tuntas.providers (code, name, country, website, metadata)
                        VALUES (%s, %s, %s, %s, %s::jsonb)
                        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
                        RETURNING id
                        """,
                        (
                            pcode,
                            course.get("provider_name") or pcode,
                            course.get("provider_country") or "MY",
                            course.get("provider_website"),
                            json.dumps({}),
                        ),
                    )
                    providers[pcode] = cur.fetchone()["id"]
                    stats["providers"] += 1
                cur.execute(
                    """
                    INSERT INTO tuntas.courses
                      (provider_id, code, title, delivery_mode, cost_myr, duration_hours,
                       competency_codes, framework_codes, data_residency, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (code) DO UPDATE SET
                      cost_myr = EXCLUDED.cost_myr,
                      metadata = EXCLUDED.metadata
                    """,
                    (
                        providers[pcode],
                        course["code"],
                        course["title"],
                        course.get("delivery_mode") or "hybrid",
                        float(course.get("cost_myr") or 0),
                        float(course.get("duration_hours") or 8),
                        course.get("competency_codes") or [],
                        course.get("framework_codes") or [],
                        course.get("data_residency") or "MY",
                        json.dumps(
                            {
                                "privacy_flags": course.get("privacy_flags") or [],
                                "price_status": course.get("price_status"),
                                "run_id": run_id,
                                "class_capacity": int(course.get("class_capacity") or 30),
                                "prerequisite_codes": course.get("prerequisite_codes") or [],
                                "hrd_corp": course.get("hrd_corp")
                                or {
                                    "status": course.get("hrd_corp_claim_status"),
                                    "claimable": course.get("hrd_corp_claimable"),
                                    "scheme": course.get("hrd_corp_scheme"),
                                },
                            }
                        ),
                    ),
                )
                stats["courses"] += 1
        conn.commit()
    return stats

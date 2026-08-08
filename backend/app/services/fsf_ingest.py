"""Versioned AICB FSF Excel ingest into tuntas.competencies."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

from app.config import get_settings
from app.db.session import db_conn

logger = logging.getLogger(__name__)


def fsf_workbook_path() -> Path:
    settings = get_settings()
    path = settings.backend_root / "docs" / "fsf-job-roles-and-skills_master-database.xlsx"
    if not path.exists():
        raise FileNotFoundError(f"FSF workbook missing: {path}")
    return path


def parse_fsf_skills(path: Path | None = None) -> list[dict[str, Any]]:
    path = path or fsf_workbook_path()
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb["Skill Codes"]
    skills: list[dict[str, Any]] = []
    header_seen = False
    for row in ws.iter_rows(values_only=True):
        if not row or row[0] is None:
            continue
        # header: No., Skill Cluster, Skill Name, Skill Code
        if str(row[0]).strip() in {"No.", "No"} or (
            len(row) > 3 and str(row[3] or "").startswith("Skill")
        ):
            header_seen = True
            continue
        if not header_seen:
            # Some sheets have title rows before header
            if len(row) >= 4 and str(row[3] or "").startswith("FSF_"):
                pass
            else:
                continue
        if len(row) < 4:
            continue
        code = str(row[3] or "").strip()
        if not code.startswith("FSF_"):
            continue
        skills.append(
            {
                "code": code,
                "name": str(row[2] or code).strip(),
                "cluster": str(row[1] or "").strip(),
                "fsf_skill_code": code,
                "description": f"AICB FSF skill {code}",
            }
        )
    return skills


def ingest_fsf_skills(*, only_codes: set[str] | None = None) -> int:
    skills = parse_fsf_skills()
    if only_codes:
        skills = [s for s in skills if s["code"] in only_codes]
    if not skills:
        return 0
    n = 0
    with db_conn() as conn:
        with conn.cursor() as cur:
            for s in skills:
                cur.execute(
                    """
                    INSERT INTO tuntas.competencies (code, name, cluster, fsf_skill_code, description)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (code) DO UPDATE SET
                      name = EXCLUDED.name,
                      cluster = EXCLUDED.cluster,
                      fsf_skill_code = EXCLUDED.fsf_skill_code,
                      description = EXCLUDED.description
                    """,
                    (s["code"], s["name"], s["cluster"], s["fsf_skill_code"], s["description"]),
                )
                n += 1
        conn.commit()
    logger.info("FSF ingest wrote %s competencies", n)
    return n

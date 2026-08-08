from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from app.schemas.cockpit import ArtifactView
from app.security.auth import Principal, require_roles
from app.services.artifacts import list_artifacts
from app.services import runs as run_store

router = APIRouter(prefix="/v1", tags=["artifacts"])


@router.get("/runs/{run_id}/artifacts", response_model=list[ArtifactView])
def list_run_artifacts(
    run_id: str,
    principal: Principal = Depends(
        require_roles("viewer", "analyst", "manager", "compliance", "admin", "mcp_service")
    ),
) -> list[ArtifactView]:
    if not run_store.get_run(run_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="run not found")
    return [ArtifactView(**a) for a in list_artifacts(run_id)]


@router.get("/artifacts/{artifact_id}")
def download_artifact(
    artifact_id: str,
    principal: Principal = Depends(
        require_roles("viewer", "analyst", "manager", "compliance", "admin", "mcp_service")
    ),
):
    from app.db.session import db_conn

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, filename, storage_path, content_type
                FROM tuntas.artifacts WHERE id = %s::uuid
                """,
                (artifact_id,),
            )
            row = cur.fetchone()
    if not row or not row["storage_path"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="artifact not found")
    path = Path(row["storage_path"])
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="artifact file missing")
    return FileResponse(path, media_type=row["content_type"], filename=row["filename"])

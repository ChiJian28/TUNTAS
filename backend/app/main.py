from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

# macOS Homebrew libs for WeasyPrint (pango/cairo) — must be visible to dynamic loader
_HOMEBREW_LIB = Path("/opt/homebrew/lib")
if _HOMEBREW_LIB.exists():
    current = os.environ.get("DYLD_LIBRARY_PATH", "")
    prefix = str(_HOMEBREW_LIB)
    if prefix not in current.split(":"):
        os.environ["DYLD_LIBRARY_PATH"] = f"{prefix}:{current}" if current else prefix

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import get_settings
from app.db.session import apply_schema, close_pool
from app.graph.checkpoint import close_checkpointer, get_checkpointer
from app.graph.workflow import reset_graph
from app.routers import artifacts, auth_me, cockpit, evidence, metrics, runs, simulations
from app.schemas.api import ErrorResponse, HealthResponse


@asynccontextmanager
async def lifespan(_: FastAPI):
    apply_schema()
    get_checkpointer()  # PostgresSaver.setup() once
    reset_graph()
    yield
    reset_graph()
    close_checkpointer()
    close_pool()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="TUNTAS API",
        description="Traceable Upskilling & Normative Training Assurance System",
        version=__version__,
        lifespan=lifespan,
        responses={
            400: {"model": ErrorResponse},
            401: {"model": ErrorResponse},
            403: {"model": ErrorResponse},
            404: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
            500: {"model": ErrorResponse},
        },
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth_me.router)
    app.include_router(cockpit.router)  # list + cockpit reads (before parameterized collisions)
    app.include_router(runs.router)
    app.include_router(evidence.router)
    app.include_router(simulations.router)
    app.include_router(metrics.router)
    app.include_router(artifacts.router)

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            app=settings.app_name,
            env=settings.app_env,
            time=datetime.now(timezone.utc),
        )

    return app


app = create_app()

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    app_name: str = "TUNTAS"
    host: str = "0.0.0.0"
    port: int = 8001
    log_level: str = "INFO"
    cors_allowed_origins: str = "http://localhost:3000"
    frontend_url: str = "http://localhost:3000"
    backend_public_url: str = "http://localhost:8001"

    supabase_url: str
    supabase_publishable_key: str
    supabase_secret_key: str
    supabase_jwks_url: str
    supabase_jwt_audience: str = "authenticated"
    database_url: str
    supabase_artifacts_bucket: str = "tuntas-artifacts"
    supabase_policy_bucket: str = "tuntas-policy-sources"

    gemini_api_key: str
    gemini_model: str = "gemini-3.1-flash-lite-preview"
    gemini_fallback_model: str = "gemini-3.5-flash"
    gemini_embedding_model: str = "gemini-embedding-2"
    gemini_embedding_dimensions: int = 768
    gemini_timeout_seconds: int = 60

    tavily_api_key: str = ""
    vendor_research_mode: Literal["live", "hybrid", "fixture"] = "hybrid"
    tavily_search_depth: str = "basic"
    tavily_max_results: int = 10
    vendor_evidence_max_age_days: int = 30

    app_master_encryption_key: str
    artifact_hmac_key: str
    mcp_service_token: str
    mcp_backend_base_url: str = "http://localhost:8001"
    mcp_host: str = "0.0.0.0"
    mcp_port: int = 8787
    mcp_path: str = "/mcp"

    langgraph_checkpoint_schema: str = "tuntas_checkpoint"
    workflow_max_concurrency: int = 3
    workflow_step_timeout_seconds: int = 180
    workflow_max_retries: int = 2

    ambank_trigger_schema_version: str = "v1"
    allow_synthetic_trigger_fallback: bool = True
    policy_source_dir: str = "./data/policies"
    vendor_fixture_path: str = "./data/fixtures/vendors.json"
    artifact_temp_dir: str = "./var/artifacts"

    default_employee_count: int = 250
    max_cost_per_employee_myr: int = 5000
    total_budget_myr: int = 1_250_000
    training_window_start: str = "2026-07-01"
    training_window_end: str = "2026-09-30"
    min_operational_coverage_ratio: float = 0.70

    calendar_provider: Literal["ics", "google"] = "ics"
    demo_auth_bypass: bool = Field(
        default=True,
        description="Allow X-Demo-Role header in development only.",
    )

    @field_validator("cors_allowed_origins")
    @classmethod
    def _strip_origins(cls, v: str) -> str:
        return v.strip()

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]

    @property
    def backend_root(self) -> Path:
        return BACKEND_ROOT

    def resolve_path(self, value: str) -> Path:
        path = Path(value)
        if path.is_absolute():
            return path
        return (BACKEND_ROOT / path).resolve()

    @property
    def database_dsn(self) -> str:
        """DATABASE_URL with sslmode/timeout/keepalive normalized for Supabase."""
        from app.db.dsn import normalize_database_url

        return normalize_database_url(self.database_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()

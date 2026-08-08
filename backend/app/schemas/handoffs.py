"""Typed agent handoff contracts — required by TUNTAS plan §4.2."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class AgentHandoffEnvelope(BaseModel):
    schema_version: str = "v1"
    source_agent: str
    evidence_ids: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0, default=0.7)
    input_hash: str
    requires_review: bool = False
    latency_ms: int | None = None
    model_name: str | None = None
    citation_coverage: float | None = None


class DiagnosticPayload(BaseModel):
    summary: str
    priority_gaps: list[dict[str, Any]] = Field(default_factory=list)
    cohort_risk_statement: str = ""
    gap_frequency: dict[str, int] = Field(default_factory=dict)
    employee_count: int = 0
    role_breakdown: dict[str, int] = Field(default_factory=dict)


class DiagnosticHandoff(AgentHandoffEnvelope):
    source_agent: Literal["diagnostic"] = "diagnostic"
    payload: DiagnosticPayload


class PolicyCompilerPayload(BaseModel):
    control_mappings: list[dict[str, Any]] = Field(default_factory=list)
    nsc07_tc17_note: str = ""
    clauses: list[dict[str, Any]] = Field(default_factory=list)


class PolicyCompilerHandoff(AgentHandoffEnvelope):
    source_agent: Literal["policy_compiler"] = "policy_compiler"
    payload: PolicyCompilerPayload


class VendorIntelligencePayload(BaseModel):
    shortlist_notes: str = ""
    risk_flags: list[dict[str, Any]] = Field(default_factory=list)
    mode_used: str = "hybrid"
    courses: list[dict[str, Any]] = Field(default_factory=list)
    live_evidence: list[dict[str, Any]] = Field(default_factory=list)
    queries_used: list[str] = Field(default_factory=list)
    live_evidence_count: int = 0
    tavily_authenticated: bool = False
    retrieved_at: str | None = None


class VendorIntelligenceHandoff(AgentHandoffEnvelope):
    source_agent: Literal["vendor_intelligence"] = "vendor_intelligence"
    payload: VendorIntelligencePayload


class LearningArchitectPayload(BaseModel):
    curriculum_modules: list[dict[str, Any]] = Field(default_factory=list)
    scenarios: list[dict[str, Any]] = Field(default_factory=list)


class LearningArchitectHandoff(AgentHandoffEnvelope):
    source_agent: Literal["learning_architect"] = "learning_architect"
    payload: LearningArchitectPayload


class ChallengerPayload(BaseModel):
    vetoes: list[dict[str, Any]] = Field(default_factory=list)
    option_flags: list[dict[str, Any]] = Field(default_factory=list)
    overall_recommendation: str = ""
    evidence_insufficient: list[dict[str, Any]] = Field(default_factory=list)


class ChallengerHandoff(AgentHandoffEnvelope):
    source_agent: Literal["challenger"] = "challenger"
    payload: ChallengerPayload
    requires_review: bool = True


class SecretariatPayload(BaseModel):
    decision_brief: str
    questions_for_manager: list[str] = Field(default_factory=list)
    recommended_option_key: str = "balanced"


class SecretariatHandoff(AgentHandoffEnvelope):
    source_agent: Literal["management_secretariat"] = "management_secretariat"
    payload: SecretariatPayload
    requires_review: bool = True


class AssuranceMonitorPayload(BaseModel):
    kirkpatrick: dict[str, Any] = Field(default_factory=dict)
    residual_risk: dict[str, Any] = Field(default_factory=dict)
    control_coverage: dict[str, Any] = Field(default_factory=dict)
    readiness_updates: list[dict[str, Any]] = Field(default_factory=list)
    evidence_spine_touched: list[str] = Field(default_factory=list)
    phase: str = "post_training"


class AssuranceMonitorHandoff(AgentHandoffEnvelope):
    source_agent: Literal["assurance_monitor"] = "assurance_monitor"
    payload: AssuranceMonitorPayload

"""Enforce typed agent handoff contracts at persist time."""
from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from app.schemas.handoffs import (
    AgentHandoffEnvelope,
    AssuranceMonitorHandoff,
    AssuranceMonitorPayload,
    ChallengerHandoff,
    ChallengerPayload,
    DiagnosticHandoff,
    DiagnosticPayload,
    LearningArchitectHandoff,
    LearningArchitectPayload,
    PolicyCompilerHandoff,
    PolicyCompilerPayload,
    SecretariatHandoff,
    SecretariatPayload,
    VendorIntelligenceHandoff,
    VendorIntelligencePayload,
)

_AGENT_MODELS: dict[str, tuple[type, type]] = {
    "diagnostic": (DiagnosticHandoff, DiagnosticPayload),
    "policy_compiler": (PolicyCompilerHandoff, PolicyCompilerPayload),
    "vendor_intelligence": (VendorIntelligenceHandoff, VendorIntelligencePayload),
    "learning_architect": (LearningArchitectHandoff, LearningArchitectPayload),
    "challenger": (ChallengerHandoff, ChallengerPayload),
    "management_secretariat": (SecretariatHandoff, SecretariatPayload),
    "assurance_monitor": (AssuranceMonitorHandoff, AssuranceMonitorPayload),
}


class HandoffContractError(ValueError):
    pass


def validate_handoff_envelope(
    *,
    agent_name: str,
    input_hash: str,
    output: dict[str, Any],
    evidence_ids: list[str] | None = None,
    confidence: float | None = None,
    requires_review: bool | None = None,
    latency_ms: int | None = None,
    model_name: str | None = None,
    citation_coverage: float | None = None,
) -> dict[str, Any]:
    """Build + model_validate a typed handoff; raise if contract broken."""
    pair = _AGENT_MODELS.get(agent_name)
    conf = float(
        confidence
        if confidence is not None
        else (citation_coverage if citation_coverage is not None else 0.7)
    )
    conf = max(0.0, min(1.0, conf))
    base = {
        "schema_version": "v1",
        "source_agent": agent_name,
        "evidence_ids": evidence_ids or [],
        "confidence": conf,
        "input_hash": input_hash,
        "requires_review": bool(
            requires_review
            if requires_review is not None
            else agent_name in {"challenger", "management_secretariat"}
        ),
        "latency_ms": latency_ms,
        "model_name": model_name,
        "citation_coverage": citation_coverage,
        "payload": output or {},
    }
    try:
        if pair is None:
            # Unknown agent: still enforce generic envelope + opaque payload
            validated = AgentHandoffEnvelope(
                source_agent=agent_name,
                evidence_ids=base["evidence_ids"],
                confidence=base["confidence"],
                input_hash=input_hash,
                requires_review=base["requires_review"],
                latency_ms=latency_ms,
                model_name=model_name,
                citation_coverage=citation_coverage,
            )
            data = validated.model_dump()
            data["payload"] = output or {}
            return data

        handoff_cls, payload_cls = pair
        payload = payload_cls.model_validate(output or {})
        handoff = handoff_cls.model_validate({**base, "payload": payload.model_dump()})
        return handoff.model_dump()
    except ValidationError as exc:
        raise HandoffContractError(
            f"handoff contract failed for {agent_name}: {exc}"
        ) from exc

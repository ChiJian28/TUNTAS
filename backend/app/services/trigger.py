from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.security.crypto import encrypt_text, hash_payload


class TriggerAdapterError(ValueError):
    pass


_SENSITIVE_KEYS = {
    "name",
    "full_name",
    "employee_name",
    "email",
    "phone",
    "mobile",
    "nric",
    "ic",
    "passport",
    "staff_id_raw",
}


def load_trigger(
    *,
    trigger_path: str | None = None,
    trigger_payload: dict[str, Any] | None = None,
    use_synthetic_fallback: bool = True,
) -> tuple[dict[str, Any], bool]:
    """Return (normalized+pseudonymised trigger, is_synthetic)."""
    settings = get_settings()
    synthetic = False

    if trigger_payload is not None:
        payload = trigger_payload
    elif trigger_path:
        path = Path(trigger_path)
        if not path.is_absolute():
            path = settings.backend_root / path
        if not path.exists():
            raise TriggerAdapterError(f"trigger file not found: {path}")
        payload = json.loads(path.read_text(encoding="utf-8"))
    else:
        organiser = (
            settings.backend_root.parent
            / "source_materials"
            / "organiser"
            / "ambank_skill_gap_trigger.json"
        )
        if organiser.exists():
            payload = json.loads(organiser.read_text(encoding="utf-8"))
        elif use_synthetic_fallback and settings.allow_synthetic_trigger_fallback:
            synthetic = True
            payload = json.loads(
                (
                    settings.backend_root
                    / "data"
                    / "triggers"
                    / "synthetic_mys_gen_2026_cap_102_v1.json"
                ).read_text(encoding="utf-8")
            )
        else:
            raise TriggerAdapterError(
                "No trigger payload provided and synthetic fallback disabled/unavailable"
            )

    normalized = _normalize(payload)
    normalized = pseudonymise_trigger(normalized)
    normalized["_hash"] = hash_payload(
        {
            "request": normalized["request"],
            "employees": normalized["employees"],
            "schema_version": normalized["schema_version"],
        }
    )
    if synthetic:
        normalized["source"] = "synthetic_fallback"
    return normalized, synthetic


def pseudonymise_trigger(trigger: dict[str, Any]) -> dict[str, Any]:
    """Replace PII before any model sees the payload; encrypt originals off-path."""
    employees_in = trigger.get("employees") or []
    employees_out: list[dict[str, Any]] = []
    vault: list[dict[str, Any]] = []

    for idx, emp in enumerate(employees_in, start=1):
        emp = dict(emp)
        raw_name = (
            emp.get("name")
            or emp.get("full_name")
            or emp.get("employee_name")
            or emp.get("pseudonym")
        )
        employee_ref = emp.get("employee_ref") or f"EMP-SYN-{idx:03d}"
        if not re.match(r"^EMP-[A-Z0-9-]+$", str(employee_ref)):
            # Force opaque ref if organiser sent HRIS IDs that look personal
            employee_ref = f"EMP-PX-{idx:03d}"

        sensitive_blob = {
            k: emp.pop(k)
            for k in list(emp.keys())
            if k.lower() in _SENSITIVE_KEYS or k.lower().endswith("_name")
        }
        if raw_name and "pseudonym" not in emp:
            # Keep display-safe role label only
            role = emp.get("role_code") or "ROLE"
            emp["pseudonym"] = f"{role[:12]}-{idx:03d}"

        encrypted = None
        if sensitive_blob:
            encrypted = encrypt_text(json.dumps(sensitive_blob, ensure_ascii=False))
            vault.append(
                {
                    "employee_ref": employee_ref,
                    "ciphertext": encrypted,
                }
            )

        emp["employee_ref"] = employee_ref
        emp.pop("name", None)
        emp.pop("full_name", None)
        emp.pop("email", None)
        emp.pop("nric", None)
        employees_out.append(emp)

    out = dict(trigger)
    out["employees"] = employees_out
    if vault:
        out["_pii_vault_encrypted"] = vault  # never sent to LLM agents
    return out


def _normalize(payload: dict[str, Any]) -> dict[str, Any]:
    if "request" in payload and "employees" in payload:
        req = payload["request"]
        employees = payload["employees"]
    else:
        req = {
            "request_id": payload.get("request_id") or payload.get("Request ID") or "MYS-GEN-2026-CAP-102",
            "issuing_unit": payload.get("issuing_unit") or payload.get("Issuing Unit"),
            "urgency": payload.get("urgency") or payload.get("Urgency") or "High",
            "target_cohort_size": payload.get("target_cohort_size") or 250,
            "capability_domain": payload.get("capability_domain")
            or payload.get("Capability Domain"),
            "proficiency_from": payload.get("proficiency_from", 1),
            "proficiency_to": payload.get("proficiency_to", 3),
            "max_budget_per_employee_myr": payload.get("max_budget_per_employee_myr")
            or payload.get("Max Budget")
            or 5000,
            "total_budget_myr": payload.get("total_budget_myr") or 1_250_000,
            "target_timeline": payload.get("target_timeline") or "Q3 2026",
            "delivery_preference": payload.get("delivery_preference")
            or payload.get("Delivery Preference"),
            "regulatory_frameworks": payload.get("regulatory_frameworks")
            or payload.get("Regulatory Frameworks")
            or [],
            "min_operational_coverage_ratio": payload.get(
                "min_operational_coverage_ratio", 0.70
            ),
            "training_window": payload.get("training_window")
            or {"start": "2026-07-01", "end": "2026-09-30"},
        }
        employees = payload.get("employees") or []
        if not employees:
            raise TriggerAdapterError(
                "Flat trigger missing employees[]; provide organiser file or use synthetic fallback"
            )

    if not employees:
        raise TriggerAdapterError("trigger contains zero employees")

    return {
        "schema_version": payload.get("schema_version") or "v1",
        "source": payload.get("source") or "organiser",
        "request": req,
        "employees": employees,
    }


def strip_for_llm(trigger: dict[str, Any]) -> dict[str, Any]:
    """Copy safe for LLM — never includes encrypted PII vault."""
    return {
        "schema_version": trigger.get("schema_version"),
        "source": trigger.get("source"),
        "request": trigger.get("request"),
        "employees": trigger.get("employees"),
        "_hash": trigger.get("_hash"),
    }

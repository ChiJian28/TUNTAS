"""Deterministic rubric scoring — LLM must not award Level 3."""
from __future__ import annotations

import re
from typing import Any


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def score_attempt_deterministic(
    *,
    rubric: list[dict[str, Any]],
    responses: dict[str, Any],
) -> dict[str, Any]:
    """Score by required_signals / keywords in rubric — no LLM.

    Rubric item shape (supported):
      {
        "criterion": str,
        "weight": float,
        "level3_behavior": str,
        "required_signals": ["escalate", "str", ...],   # preferred
        "critical": bool
      }

    Responses may be:
      {"actions": ["..."], "notes": "...", "<criterion>": "..."} or free text under "response".
    """
    if not rubric:
        raise ValueError("rubric is empty — cannot score deterministically")

    blob_parts: list[str] = []
    if isinstance(responses.get("actions"), list):
        blob_parts.extend(str(a) for a in responses["actions"])
    if isinstance(responses.get("checklist"), list):
        blob_parts.extend(str(a) for a in responses["checklist"])
    for k, v in responses.items():
        if k in {"actions", "checklist"}:
            continue
        if isinstance(v, (str, int, float, bool)):
            blob_parts.append(str(v))
        elif isinstance(v, list):
            blob_parts.extend(str(x) for x in v)
        elif isinstance(v, dict):
            blob_parts.append(str(v))
    response_blob = _norm(" ".join(blob_parts))

    criterion_scores: list[dict[str, Any]] = []
    weighted = 0.0
    weight_sum = 0.0
    critical_fail = False

    for item in rubric:
        criterion = str(item.get("criterion") or "criterion")
        weight = float(item.get("weight") or 1.0)
        weight_sum += weight
        signals = item.get("required_signals") or []
        if not signals:
            # Derive weak signals from level3_behavior text
            behavior = _norm(str(item.get("level3_behavior") or ""))
            signals = [tok for tok in re.findall(r"[a-z]{4,}", behavior) if tok not in {
                "must", "should", "with", "from", "that", "this", "have", "into", "when"
            }][:6]
        signals = [_norm(str(s)) for s in signals if str(s).strip()]
        if not signals:
            matched = 0.0
            note = "No required_signals defined; scored 0 (fail-closed)"
        else:
            hits = [s for s in signals if s in response_blob]
            matched = len(hits) / len(signals)
            note = f"matched {len(hits)}/{len(signals)} signals: {hits}"
        score = round(matched, 4)
        weighted += score * weight
        is_critical = bool(item.get("critical"))
        if is_critical and score < 0.67:
            critical_fail = True
        criterion_scores.append(
            {
                "criterion": criterion,
                "score": score,
                "weight": weight,
                "critical": is_critical,
                "note": note,
                "required_signals": signals,
            }
        )

    overall = weighted / weight_sum if weight_sum else 0.0
    overall = round(overall, 4)

    # Level mapping: Level 3 only if high score AND no critical fail
    if critical_fail:
        level = 1 if overall < 0.4 else 2
        proof = False
    elif overall >= 0.85:
        level = 3
        proof = True
    elif overall >= 0.6:
        level = 2
        proof = False
    else:
        level = 1
        proof = False

    return {
        "score": overall,
        "level_awarded": level,
        "proof_of_level3": proof,
        "criterion_scores": criterion_scores,
        "scoring_method": "deterministic_rubric_v1",
        "critical_fail": critical_fail,
        "feedback": (
            "Level 3 awarded by deterministic rubric evidence."
            if proof
            else "Level 3 not awarded — insufficient behavioural signals or critical gap."
        ),
    }

#!/usr/bin/env python3
"""Pure (no-DB) checks for serial review gates.

Run: python scripts/verify_review_gates.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.review_gates import (  # noqa: E402
    GATE_SPECS,
    POST_COMMIT_STATUSES,
    STAGE_RESET_FROM,
    circular_hitl_needs_rearm,
    commit_missing,
    is_skipped_on_path,
    missing_prior_keys,
    pick_current_row,
    spec_for,
)


def _row(key: str, status: str) -> dict:
    spec = spec_for(key)
    return {"gate_key": key, "sequence": spec["sequence"], "status": status}


def main() -> int:
    failures: list[str] = []

    keys = [s["key"] for s in GATE_SPECS]
    if keys != ["compliance", "procurement", "learning", "operations", "management"]:
        failures.append(f"gate order {keys}")

    proc = spec_for("procurement")
    if is_skipped_on_path(proc, "circular"):
        failures.append("procurement must NOT skip on circular")
    if is_skipped_on_path(proc, "capability"):
        failures.append("procurement must NOT skip on capability")
    if is_skipped_on_path(spec_for("compliance"), "circular"):
        failures.append("compliance must not skip")
    if not spec_for("management")["commits"]:
        failures.append("management must be the COMMIT gate")
    if any(s["commits"] for s in GATE_SPECS if s["key"] != "management"):
        failures.append("only management may commit")
    if any(s.get("skip_on_circular") for s in GATE_SPECS):
        failures.append("no gate should skip_on_circular")

    capability = [
        _row("compliance", "approved"),
        _row("procurement", "pending"),
        _row("learning", "pending"),
        _row("operations", "pending"),
        _row("management", "pending"),
    ]
    if missing_prior_keys(capability, "learning") != ["procurement"]:
        failures.append(f"capability learning priors {missing_prior_keys(capability, 'learning')}")
    if commit_missing(capability) != ["procurement", "learning", "operations"]:
        failures.append(f"capability commit missing {commit_missing(capability)}")

    circular = [
        _row("compliance", "approved"),
        _row("procurement", "approved"),
        _row("learning", "approved"),
        _row("operations", "approved"),
        _row("management", "pending"),
    ]
    if missing_prior_keys(circular, "management"):
        failures.append(f"circular management priors {missing_prior_keys(circular, 'management')}")
    if commit_missing(circular):
        failures.append(f"circular should unlock COMMIT, missing={commit_missing(circular)}")
    current = pick_current_row(circular)
    if not current or current["gate_key"] != "management":
        failures.append(f"circular current {current}")

    rejected = [
        _row("compliance", "rejected"),
        _row("procurement", "pending"),
        _row("learning", "pending"),
        _row("operations", "pending"),
        _row("management", "pending"),
    ]
    cur = pick_current_row(rejected)
    if not cur or cur["gate_key"] != "compliance":
        failures.append("rejected compliance must remain current")

    if STAGE_RESET_FROM["parallel_intake"] != "compliance":
        failures.append("compliance revise must reset from compliance")
    if STAGE_RESET_FROM["challenger"] != "procurement":
        failures.append("procurement revise maps to challenger")
    if STAGE_RESET_FROM["optimizer"] != "operations":
        failures.append("operations revise maps to optimizer")

    mid = [
        _row("compliance", "approved"),
        _row("procurement", "pending"),
        _row("learning", "pending"),
        _row("operations", "pending"),
        _row("management", "pending"),
    ]
    cur_mid = pick_current_row(mid)
    if not cur_mid or cur_mid["gate_key"] != "procurement":
        failures.append(f"after compliance, circular current {cur_mid}")
    if missing_prior_keys(mid, "learning") != ["procurement"]:
        failures.append(f"learning should wait on procurement {missing_prior_keys(mid, 'learning')}")
    if commit_missing(mid) != ["procurement", "learning", "operations"]:
        failures.append(f"mid commit missing {commit_missing(mid)}")

    skipped_legacy = [
        _row("compliance", "approved"),
        _row("procurement", "skipped"),
        _row("learning", "pending"),
        _row("operations", "pending"),
        _row("management", "pending"),
    ]
    if missing_prior_keys(skipped_legacy, "learning"):
        failures.append("skipped procurement must not block learning")
    if commit_missing(skipped_legacy) != ["learning", "operations"]:
        failures.append(f"skipped procurement commit missing {commit_missing(skipped_legacy)}")

    rejected_commit = [
        _row("compliance", "rejected"),
        _row("procurement", "pending"),
        _row("learning", "pending"),
        _row("operations", "pending"),
        _row("management", "pending"),
    ]
    if "compliance" not in commit_missing(rejected_commit):
        failures.append("rejected compliance must block COMMIT")

    if POST_COMMIT_STATUSES != frozenset({"completed", "rejected"}):
        failures.append(f"POST_COMMIT_STATUSES {POST_COMMIT_STATUSES}")
    if not circular_hitl_needs_rearm("completed"):
        failures.append("completed capability COMMIT must re-open circular HITL")
    if not circular_hitl_needs_rearm("rejected"):
        failures.append("rejected run must re-open circular HITL")
    if circular_hitl_needs_rearm("awaiting_approval"):
        failures.append("awaiting_approval must not look like post-COMMIT rearm")
    if circular_hitl_needs_rearm("running"):
        failures.append("running must not re-open circular HITL")

    if failures:
        print("FAIL")
        for item in failures:
            print(f"  - {item}")
        return 1
    print("review_gates_ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

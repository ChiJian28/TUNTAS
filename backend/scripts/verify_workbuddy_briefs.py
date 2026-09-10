#!/usr/bin/env python3
"""Pure checks for WorkBuddy paste-ready briefs (no DB).

Run: python scripts/verify_workbuddy_briefs.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.circular import format_impact_chat_markdown  # noqa: E402
from app.services.gold import ACTION_BRIEF  # noqa: E402
from app.services.workbuddy_briefs import (  # noqa: E402
    DEFAULT_GATE_RATIONALE,
    GATE_EXPERTS,
    PASTE_INSTRUCTION,
    dispatch_action,
    dispatch_for_current,
    format_gate_table,
    format_human_ask,
    format_options_table,
    format_coverage_note,
    format_curriculum_modules,
    format_pack_links,
    format_policy_mapping_table,
    format_scenarios,
    format_vendor_shortlist,
    format_wait_line,
    human_commands,
    human_facing_leaks,
    metric_cell,
)


def _chain(**kwargs):
    gates = kwargs.pop(
        "gates",
        [
            {"gate_key": "compliance", "sequence": 1, "label": "Compliance", "status": "active"},
            {"gate_key": "procurement", "sequence": 2, "label": "Procurement", "status": "pending"},
            {"gate_key": "learning", "sequence": 3, "label": "Learning", "status": "pending"},
            {"gate_key": "operations", "sequence": 4, "label": "Operations", "status": "pending"},
            {"gate_key": "management", "sequence": 5, "label": "Management", "status": "pending"},
        ],
    )
    base = {
        "run_id": "run-x",
        "path": "capability",
        "current_gate": "compliance",
        "commit_unlocked": False,
        "commit_blocked_by": ["compliance", "procurement", "learning", "operations"],
        "run_status": "awaiting_approval",
        "gates": gates,
    }
    base.update(kwargs)
    return base


def _assert_human(label: str, text: str, failures: list[str]) -> None:
    leaks = human_facing_leaks(text)
    if leaks:
        failures.append(f"{label} leaked {leaks}: {text}")


def main() -> int:
    failures: list[str] = []

    if set(GATE_EXPERTS) != {"compliance", "procurement", "learning", "operations"}:
        failures.append(f"GATE_EXPERTS keys {set(GATE_EXPERTS)}")
    if GATE_EXPERTS["compliance"]["expert_id"] != "nadia-impact-officer":
        failures.append("Nadia must own compliance")
    if GATE_EXPERTS["procurement"]["expert_id"] != "arun-procurement-officer":
        failures.append("Arun must own procurement")
    if GATE_EXPERTS["learning"]["expert_id"] != "riz-remediation-planner":
        failures.append("Riz must own learning")
    if GATE_EXPERTS["operations"]["expert_id"] != "hakim-operations-officer":
        failures.append("Hakim must own operations")
    if "management" in GATE_EXPERTS:
        failures.append("Management must not have a gate expert")
    if len(DEFAULT_GATE_RATIONALE) < 8:
        failures.append("default rationale shorter than API min_length")

    depts = {row["department"] for row in ACTION_BRIEF}
    if depts != {"Compliance", "Procurement", "L&D", "Operations", "Management"}:
        failures.append(f"ACTION_BRIEF departments {depts}")
    proc = next(r for r in ACTION_BRIEF if r["department"] == "Procurement")
    if proc.get("blocked_by") != "human_gate:procurement":
        failures.append("Procurement ACTION_BRIEF must be human_gate:procurement")
    mgmt = next(r for r in ACTION_BRIEF if r["department"] == "Management")
    if mgmt.get("blocked_by") != "human_gate:management":
        failures.append("Management ACTION_BRIEF must be human_gate:management")

    if metric_cell({}, "expected") != "—":
        failures.append("missing metric must be em-dash, not a guessed number")
    if metric_cell({"expected": 3}, "expected") != "3":
        failures.append("present metric must pass through")

    md = format_impact_chat_markdown(
        {
            "headline": "empty",
            "expected_vs_found": {},
            "action_brief": ACTION_BRIEF,
            "wait_state": "Nothing has been scheduled yet.",
        }
    )
    if "| stale programmes | — | — |" not in md:
        failures.append(f"impact markdown must not default Expected to 3:\n{md}")
    _assert_human("impact markdown", md, failures)

    cap = _chain()
    who = dispatch_for_current(cap)
    if not who or who["name"] != "Nadia":
        failures.append(f"capability current compliance should dispatch Nadia, got {who}")
    if dispatch_action(cap) != "summon_once":
        failures.append(dispatch_action(cap))
    cmds = human_commands(cap)
    if cmds[0] != "Compliance approve":
        failures.append(f"commands {cmds}")
    wait = format_wait_line(cap)
    if "`Compliance approve`" not in wait or "submit_management_decision" not in wait:
        failures.append(f"wait line {wait}")
    ask = format_human_ask(cap)
    if "Compliance approve" not in ask:
        failures.append(f"human ask {ask}")
    _assert_human("human ask", ask, failures)
    _assert_human("gate table", format_gate_table(cap), failures)

    running = _chain(run_status="running")
    if dispatch_for_current(running) is not None:
        failures.append("must not dispatch during pipeline")
    if dispatch_action(running) != "wait_pipeline":
        failures.append(dispatch_action(running))
    if human_commands(running):
        failures.append("no human gate commands while running")
    _assert_human("running ask", format_human_ask(running), failures)

    circular = _chain(
        path="circular",
        current_gate="procurement",
        gates=[
            {"gate_key": "compliance", "sequence": 1, "label": "Compliance", "status": "approved"},
            {"gate_key": "procurement", "sequence": 2, "label": "Procurement", "status": "active"},
            {"gate_key": "learning", "sequence": 3, "label": "Learning", "status": "pending"},
            {"gate_key": "operations", "sequence": 4, "label": "Operations", "status": "pending"},
            {"gate_key": "management", "sequence": 5, "label": "Management", "status": "pending"},
        ],
        commit_blocked_by=["procurement", "learning", "operations"],
    )
    who = dispatch_for_current(circular)
    if not who or who["name"] != "Arun":
        failures.append(f"circular after compliance should dispatch Arun, got {who}")
    table = format_gate_table(circular)
    if "Not needed this time" in table:
        failures.append("circular procurement must not look skipped")
    if "Waiting for you" not in table:
        failures.append("circular procurement must show as waiting")
    wait = format_wait_line(circular)
    if "`Procurement approve`" not in wait:
        failures.append(f"circular procurement wait {wait}")
    if "SANS" not in wait or "colleague voice" not in wait:
        failures.append(f"procurement wait must keep SANS questions in colleague voice: {wait}")
    if "SANS/HTB" not in PASTE_INSTRUCTION or "Do not narrate" not in PASTE_INSTRUCTION:
        failures.append("instruction must keep SANS/RFP answers in colleague voice")
    _assert_human("circular table", table, failures)
    _assert_human("circular ask", format_human_ask(circular), failures)

    skip_proc = _chain(
        path="circular",
        current_gate="procurement",
        gates=[
            {"gate_key": "compliance", "sequence": 1, "label": "Compliance", "status": "approved"},
            {
                "gate_key": "procurement",
                "sequence": 2,
                "label": "Procurement",
                "status": "skipped",
                "skipped": True,
            },
            {"gate_key": "learning", "sequence": 3, "label": "Learning", "status": "pending"},
            {"gate_key": "operations", "sequence": 4, "label": "Operations", "status": "pending"},
            {"gate_key": "management", "sequence": 5, "label": "Management", "status": "pending"},
        ],
    )
    if dispatch_for_current(skip_proc) is not None:
        failures.append("must not dispatch Arun on a skipped procurement row")

    unlocked = _chain(
        current_gate="management",
        commit_unlocked=True,
        commit_blocked_by=[],
        gates=[
            {"gate_key": "compliance", "sequence": 1, "label": "Compliance", "status": "approved"},
            {"gate_key": "procurement", "sequence": 2, "label": "Procurement", "status": "approved"},
            {"gate_key": "learning", "sequence": 3, "label": "Learning", "status": "approved"},
            {"gate_key": "operations", "sequence": 4, "label": "Operations", "status": "approved"},
            {"gate_key": "management", "sequence": 5, "label": "Management", "status": "active"},
        ],
    )
    if dispatch_for_current(unlocked) is not None:
        failures.append("must not dispatch a Management expert")
    if dispatch_action(unlocked) != "wait_human_commit":
        failures.append(dispatch_action(unlocked))
    wait = format_wait_line(unlocked)
    if "`Management commit Balanced`" not in wait:
        failures.append(wait)
    if human_commands(unlocked)[0] != "Management commit Balanced":
        failures.append(str(human_commands(unlocked)))
    ask = format_human_ask(unlocked)
    if "Management commit Balanced" not in ask:
        failures.append(f"unlocked ask {ask}")
    _assert_human("unlocked ask", ask, failures)

    empty_opts = format_options_table([])
    if "TUNTAS did not return any training plans" not in empty_opts:
        failures.append("empty options must refuse invention")
    _assert_human("empty options", empty_opts, failures)
    opts = format_options_table(
        [
            {
                "option_key": "balanced",
                "label": "Balanced",
                "total_cost_myr": 12000,
                "cost_per_employee_myr": 1200,
                "operational_coverage": 0.7,
                "hard_constraint_ok": True,
                "solver_status": "OPTIMAL",
                "assignments": [{"employee_ref": "DO-NOT-SHOW"}],
            }
        ]
    )
    if "DO-NOT-SHOW" in opts:
        failures.append("assignments must not leak into options table")
    if "Balanced" not in opts or "RM 12,000" not in opts or "70%" not in opts:
        failures.append(opts)
    _assert_human("options table", opts, failures)

    links = format_pack_links(
        {
            "review_url": "http://localhost:3000/runs/run-x/review/compliance",
            "evidence_url": "http://localhost:3000/runs/run-x/evidence",
        },
        "compliance",
    )
    if "/review/compliance" not in links:
        failures.append(f"compliance pack must include review URL: {links}")
    if "Graph ledger:" not in links or "/evidence" not in links:
        failures.append(f"pack links must still include graph: {links}")
    if "open" in links.lower() and "approve" in links.lower():
        failures.append(f"pack links must not tell the human to open a page to approve: {links}")
    _assert_human("pack links", links, failures)

    mapping = format_policy_mapping_table(
        {
            "control_mappings": [
                {
                    "clause_ref": "RMiT-3.1",
                    "control_code": "CTRL-RMiT-3.1",
                    "control_name": "Technology Risk Governance",
                    "competency_codes": ["COMP-GOV-01", "COMP-RM-01"],
                    "citation": "BNM RMiT Clause RMiT-3.1",
                }
            ],
            "nsc07_tc17_note": "NSC07/TC17 is a Standards Malaysia AI committee pathway, not a single Act.",
        }
    )
    if "RMiT-3.1" not in mapping or "COMP-GOV-01" not in mapping:
        failures.append(f"policy mapping table missing clause/competency: {mapping}")
    if "NSC07/TC17" not in mapping:
        failures.append("policy mapping must keep the NSC07 note from TUNTAS")
    _assert_human("policy mapping", mapping, failures)
    empty_map = format_policy_mapping_table({})
    if "TUNTAS did not return policy mapping" not in empty_map:
        failures.append("empty policy mapping must refuse invention")

    modules = format_curriculum_modules(
        {
            "curriculum_modules": [
                {
                    "module_code": "MOD-FRAUD-001",
                    "title": "Advanced Transaction Monitoring and Alert Triage",
                    "delivery": "Hybrid: Self-paced simulation drills",
                    "level_from": 1,
                    "level_to": 3,
                    "competency_codes": ["FSF_PR110", "FSF_PR019"],
                }
            ]
        }
    )
    if "MOD-FRAUD-001" not in modules or "FSF_PR110" not in modules:
        failures.append(f"curriculum must use module_code: {modules}")
    if "`—`" in modules.split("MOD-FRAUD-001")[0][-20:]:
        failures.append("curriculum must not fall back to missing code when module_code exists")
    _assert_human("curriculum", modules, failures)

    scenes = format_scenarios(
        [
            {
                "code": "SCN-AML-ESC",
                "title": "AML Escalation and STR Judgment",
                "role_focus": "COMPLIANCE_OFFICER",
                "rubric": [{"criterion": "Regulatory Judgment", "critical": True}],
            }
        ]
    )
    if "SCN-AML-ESC" not in scenes or "COMPLIANCE_OFFICER" not in scenes:
        failures.append(f"scenarios missing UI fields: {scenes}")
    if "(critical)" not in scenes:
        failures.append("critical rubric must be labelled")
    _assert_human("scenarios", scenes, failures)

    shortlist = format_vendor_shortlist(
        [
            {
                "code": "GCX-REGTECH-ULTRA",
                "title": "RegTech Ultra",
                "provider_name": "GCX",
                "cost_myr": 9000,
                "data_residency": "US",
                "hrd_corp_claimable": False,
            }
        ]
    )
    if "GCX-REGTECH-ULTRA" not in shortlist or "Not claimable" not in shortlist:
        failures.append(f"shortlist missing course row: {shortlist}")
    _assert_human("shortlist", shortlist, failures)
    empty_list = format_vendor_shortlist([])
    if "TUNTAS did not return a vendor shortlist" not in empty_list:
        failures.append("empty shortlist must refuse invention")

    trap = format_coverage_note(
        [
            {
                "option_key": "balanced",
                "label": "Balanced",
                "total_cost_myr": 31200,
                "cost_per_employee_myr": 3120,
                "operational_coverage": 0.5,
                "hard_constraint_ok": True,
                "solver_status": "OPTIMAL",
            }
        ],
        0.7,
    )
    if "Feasible = Yes" not in trap or "99%" not in trap:
        failures.append(f"coverage note must defuse 50% vs 70%: {trap}")
    if "not feasible" in trap.lower():
        failures.append("feasible plans must not be described as not feasible")
    _assert_human("coverage note", trap, failures)
    blocked = format_coverage_note(
        [
            {
                "option_key": "balanced",
                "label": "Balanced",
                "operational_coverage": 0.5,
                "hard_constraint_ok": False,
                "solver_status": "INFEASIBLE",
            }
        ],
        0.99,
    )
    if "not feasible" not in blocked.lower():
        failures.append(f"infeasible plans must say so: {blocked}")

    if failures:
        print("FAIL")
        for item in failures:
            print(f"  - {item}")
        return 1
    print("workbuddy_briefs_ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

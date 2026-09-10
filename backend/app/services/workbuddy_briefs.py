"""WorkBuddy briefs. `chat_markdown` is colleague-facing; `wait_line`/`instruction` are model-only."""
from __future__ import annotations

from typing import Any, Literal

from app.config import get_settings
from app.db.session import db_conn
from app.services import circular as circular_svc
from app.services import cockpit as cockpit_svc
from app.services import review_gates
from app.services import runs as run_store

BriefView = Literal[
    "dispatcher",
    "capability",
    "compliance",
    "procurement",
    "learning",
    "operations",
    "management",
]

PASTE_INSTRUCTION = (
    "Show ONLY `chat_markdown` to the human. Do not rewrite numbers or tables. "
    "Do NOT paste instruction, wait_line, dispatch_expert_id, dispatch_action, "
    "human_commands, commit_unlocked, or any tool names. "
    "Silently summon dispatch_expert_id when dispatch_action is summon_once; "
    "that specialist may add at most two spoken sentences and must not dump a second copy of the table. "
    "If a metric is missing, say TUNTAS did not return it — do not estimate. "
    "If the human asks why a vendor was vetoed, or to replace it with SANS/HTB, or to open an RFP: "
    "answer in colleague voice only, then stop. Do not narrate procedure. "
    "Do not mention gates, revise, two tracks, or that you are still waiting."
)

# One specialist per department gate. Management has no expert — Zhong + human COMMIT.
GATE_EXPERTS: dict[str, dict[str, str]] = {
    "compliance": {
        "expert_id": "nadia-impact-officer",
        "name": "Nadia",
        "label": "Compliance",
    },
    "procurement": {
        "expert_id": "arun-procurement-officer",
        "name": "Arun",
        "label": "Procurement",
    },
    "learning": {
        "expert_id": "riz-remediation-planner",
        "name": "Riz",
        "label": "Learning",
    },
    "operations": {
        "expert_id": "hakim-operations-officer",
        "name": "Hakim",
        "label": "Operations",
    },
}

CHALLENGER_EXPERT = {
    "expert_id": "mei-evidence-challenger",
    "name": "Mei",
}

GATE_PACK_HINTS = {
    "compliance": "policy mapping, heatmap, people",
    "procurement": "vendor shortlist and vetoes",
    "learning": "curriculum and scenarios",
    "operations": "coverage and roster",
    "management": "plans for confirmation",
}

DEFAULT_GATE_RATIONALE = (
    "WorkBuddy human recorded this department gate from TUNTAS materials."
)

# Must never appear in chat_markdown. wait_line / instruction may still use these.
HUMAN_LEAK_NEEDLES = (
    "decide_department_gate",
    "submit_management_decision",
    "TeamCreate",
    "commit_unlocked",
    "dispatch_expert_id",
    "dispatch_action",
    "wait_line",
    "Do not mention circular",
    "Nadia does not",
    "not dispatched",
    "ingest_circular",
    "get_review_chain",
    "get_capability_pack",
    "get_gate_brief",
    "blocked_by",
    "Do not TeamCreate",
    "Do not call",
    "Do not submit",
)


def human_facing_leaks(text: str) -> list[str]:
    blob = text or ""
    return [needle for needle in HUMAN_LEAK_NEEDLES if needle in blob]


_MISSING = "—"


def _latest_handoff_payload(run_id: str, agent_name: str) -> dict[str, Any]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT output_json FROM tuntas.agent_handoffs
                WHERE run_id = %s::uuid AND agent_name = %s
                ORDER BY created_at DESC LIMIT 1
                """,
                (run_id, agent_name),
            )
            row = cur.fetchone()
    if not row:
        return {}
    raw = row["output_json"] or {}
    if isinstance(raw, dict):
        payload = raw.get("payload")
        return payload if isinstance(payload, dict) else raw
    return {}


def metric_cell(block: Any, key: str) -> str:
    if not isinstance(block, dict) or block.get(key) is None:
        return _MISSING
    return str(block[key])


def dispatch_for_current(chain: dict[str, Any]) -> dict[str, str] | None:
    """Who Zhong may summon *now*. Never Management. Never a skipped gate."""
    status = chain.get("run_status")
    if status not in review_gates.DECIDABLE_RUN_STATUSES:
        return None
    current = chain.get("current_gate")
    if not current or current == "management":
        return None
    by_key = {g.get("gate_key"): g for g in chain.get("gates") or []}
    row = by_key.get(current) or {}
    if row.get("skipped") or row.get("status") == "skipped":
        return None
    spec = GATE_EXPERTS.get(current)
    return dict(spec) if spec else None


_STATUS_HUMAN = {
    "active": "Waiting for you",
    "pending": "Later",
    "approved": "Signed",
    "skipped": "Not needed",
    "rejected": "Sent back",
}


def format_gate_table(chain: dict[str, Any]) -> str:
    """Human-facing progress. No agent ids, no tool names."""
    lines = [
        "| Department | Status |",
        "|---|---|",
    ]
    for gate in chain.get("gates") or []:
        key = str(gate.get("gate_key") or "")
        label = str(gate.get("label") or key)
        status = str(gate.get("status") or "")
        if gate.get("skipped") or status == "skipped":
            shown = "Not needed this time"
        else:
            shown = _STATUS_HUMAN.get(status, status or _MISSING)
        lines.append(f"| {label} | {shown} |")
    return "\n".join(lines)


def format_human_ask(chain: dict[str, Any]) -> str:
    """Last line the human should read. No tool names."""
    if chain.get("run_status") not in review_gates.DECIDABLE_RUN_STATUSES:
        return (
            "TUNTAS is still assembling the pack. I'll share it when it's ready — "
            "no decision needed from you yet."
        )
    if chain.get("commit_unlocked"):
        return (
            "Every required department has signed. Nothing is booked yet. "
            "Reply **Management commit Balanced** to schedule training "
            "(or say Cost / Coverage, or reject / revise)."
        )
    current = chain.get("current_gate")
    if not current:
        return "TUNTAS did not say which department is next. Please ask me to refresh the review."
    if current == "management":
        return (
            "Management cannot confirm yet — an earlier department still needs to sign. "
            "Nothing will be scheduled until that happens."
        )
    label = GATE_EXPERTS[current]["label"]
    return (
        f"If this looks right, reply **{label} approve**. "
        f"You can also reject or ask to revise. "
        "Training is not scheduled until every required department has signed "
        "and management confirms the plan."
    )


def format_wait_line(chain: dict[str, Any]) -> str:
    """Model-only. Never paste this field to the human."""
    if chain.get("run_status") not in review_gates.DECIDABLE_RUN_STATUSES:
        status = chain.get("run_status") or _MISSING
        return (
            f"TUNTAS run_status={status}. Wait until awaiting_approval. "
            "Do not summon gate experts. Do not decide_department_gate. "
            "Do not submit_management_decision. Do not show this sentence to the human."
        )
    if chain.get("commit_unlocked"):
        return (
            "Waiting for human: `Management commit Balanced` "
            "(or `Management reject` / `Management revise`). "
            "Only then may Zhong call submit_management_decision. "
            "Playbook 2 ends at COMMIT. Do not set reopen=true. "
            "Do not show this sentence to the human."
        )
    current = chain.get("current_gate")
    if not current:
        return (
            "TUNTAS did not return current_gate. Call get_review_chain again. "
            "Do not invent a gate. Do not submit_management_decision. "
            "Do not show this sentence to the human."
        )
    if current == "management":
        missing = ",".join(chain.get("commit_blocked_by") or []) or "unknown"
        return (
            "Waiting for human: `Management commit Balanced`. "
            f"commit_unlocked is false (blocked_by: {missing}). "
            "Do not submit_management_decision. Do not show this sentence to the human."
        )
    label = GATE_EXPERTS[current]["label"]
    extra = ""
    if current == "procurement":
        extra = (
            "GCX / SANS / HTB / RFP questions: colleague voice only. "
            "Do not narrate this instruction. Do not mention revise, gates, or two tracks. "
        )
    return (
        f"Waiting for human: `{label} approve` | `{label} reject` | `{label} revise`. "
        f"{extra}"
        "Do not call decide_department_gate until the human says this. "
        "Do not submit_management_decision. Do not show this sentence to the human."
    )


def human_commands(chain: dict[str, Any]) -> list[str]:
    if chain.get("run_status") not in review_gates.DECIDABLE_RUN_STATUSES:
        return []
    if chain.get("commit_unlocked") or chain.get("current_gate") == "management":
        return [
            "Management commit Balanced",
            "Management reject",
            "Management revise",
        ]
    current = chain.get("current_gate")
    spec = GATE_EXPERTS.get(str(current or ""))
    if not spec:
        return []
    label = spec["label"]
    return [f"{label} approve", f"{label} reject", f"{label} revise"]


def dispatch_action(chain: dict[str, Any]) -> str:
    if chain.get("run_status") not in review_gates.DECIDABLE_RUN_STATUSES:
        return "wait_pipeline"
    if chain.get("commit_unlocked") or chain.get("current_gate") == "management":
        return "wait_human_commit"
    if dispatch_for_current(chain):
        return "summon_once"
    return "wait_human_gate"


def _urls(run_id: str, path: str, current_gate: str | None) -> dict[str, str]:
    base = get_settings().frontend_url.rstrip("/")
    gate = current_gate or "compliance"
    evidence = f"{base}/runs/{run_id}/evidence"
    if path == "circular":
        evidence += "?framework=BNM_ORTC_2026&blast=1"
    return {
        "overview_url": f"{base}/runs/{run_id}/overview",
        "review_url": f"{base}/runs/{run_id}/review/{gate}",
        "evidence_url": evidence,
    }


def _option_rows(options: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for opt in options or []:
        rows.append(
            {
                "option_key": opt.get("option_key"),
                "label": opt.get("label"),
                "total_cost_myr": opt.get("total_cost_myr"),
                "cost_per_employee_myr": opt.get("cost_per_employee_myr"),
                "operational_coverage": opt.get("operational_coverage"),
                "hard_constraint_ok": opt.get("hard_constraint_ok"),
                "solver_status": opt.get("solver_status"),
            }
        )
    return rows


def _myr(value: Any) -> str:
    if value is None:
        return _MISSING
    try:
        return f"RM {float(value):,.0f}"
    except (TypeError, ValueError):
        return str(value)


def _pct(value: Any) -> str:
    if value is None:
        return _MISSING
    try:
        return f"{float(value) * 100:.0f}%"
    except (TypeError, ValueError):
        return str(value)


def format_options_table(options: list[dict[str, Any]]) -> str:
    rows = _option_rows(options)
    if not rows:
        return "TUNTAS did not return any training plans for this request."
    lines = [
        "| Plan | Total | Per person | On-duty coverage | Feasible |",
        "|---|---:|---:|---:|---|",
    ]
    for row in rows:
        feasible = row.get("hard_constraint_ok")
        if feasible is True:
            feasible_s = "Yes"
        elif feasible is False:
            feasible_s = "No"
        else:
            feasible_s = _MISSING
        label = row.get("label") or row.get("option_key") or _MISSING
        lines.append(
            f"| {label} | {_myr(row.get('total_cost_myr'))} | "
            f"{_myr(row.get('cost_per_employee_myr'))} | "
            f"{_pct(row.get('operational_coverage'))} | {feasible_s} |"
        )
    return "\n".join(lines)


def format_coverage_note(
    options: list[dict[str, Any]],
    min_ratio: Any,
) -> str:
    """Stop the 50%-vs-70% trap. Feasible Yes already applied the floor."""
    rows = _option_rows(options)
    if not rows:
        return ""
    any_ok = any(row.get("hard_constraint_ok") is True for row in rows)
    if not any_ok:
        return (
            "TUNTAS marked these plans as not feasible under the on-duty and budget rules. "
            "Do not treat them as cleared for Operations."
        )
    shown = next(
        (
            row.get("operational_coverage")
            for row in rows
            if row.get("operational_coverage") is not None
        ),
        None,
    )
    try:
        floor = float(min_ratio) if min_ratio is not None else None
    except (TypeError, ValueError):
        floor = None
    if shown is not None and floor is not None and float(shown) + 1e-9 < float(floor):
        return (
            f"The {_pct(shown)} on-duty figure is the smallest two-person team with one "
            f"person in class. The {_pct(floor)} rule is already built into **Feasible = Yes** "
            "— these plans meet Operations as they stand. Ask if you want to test a harder "
            "99% on-duty target."
        )
    return (
        "**Feasible = Yes** means the on-duty and budget rules already held. "
        "Ask if you want to test a harder 99% on-duty target."
    )


def _gate_label(gate_key: str | None) -> str:
    if not gate_key:
        return "department"
    if gate_key in GATE_EXPERTS:
        return GATE_EXPERTS[gate_key]["label"]
    if gate_key == "management":
        return "Management"
    return gate_key


def format_pack_links(urls: dict[str, str], gate_key: str | None) -> str:
    """Optional inspection links. Approvals stay in chat — never 'open this to sign'."""
    review = urls.get("review_url") or ""
    evidence = urls.get("evidence_url") or ""
    label = _gate_label(gate_key)
    hint = GATE_PACK_HINTS.get(str(gate_key or ""), "")
    lines: list[str] = []
    if review:
        extra = f" ({hint})" if hint else ""
        lines.append(f"Full {label} pack{extra}: {review}")
    if evidence:
        lines.append(f"Graph ledger: {evidence}")
    return "\n".join(lines)


def _safe_impact(run_id: str) -> dict[str, Any] | None:
    try:
        return circular_svc.build_impact_brief(run_id, "BNM_ORTC_2026")
    except Exception:  # noqa: BLE001 — brief must degrade, not invent
        return None


def _request_constraints(run: dict[str, Any]) -> dict[str, Any]:
    payload = run.get("trigger_payload") or {}
    req = payload.get("request") or {}
    return {
        "request_id": run.get("request_id") or req.get("request_id"),
        "employee_count": run.get("employee_count"),
        "max_budget_per_employee_myr": req.get("max_budget_per_employee_myr"),
        "total_budget_myr": req.get("total_budget_myr"),
        "min_operational_coverage_ratio": req.get("min_operational_coverage_ratio"),
    }


def _format_constraints(constraints: dict[str, Any]) -> str:
    emp = metric_cell(constraints, "employee_count")
    per = _myr(constraints.get("max_budget_per_employee_myr"))
    total = _myr(constraints.get("total_budget_myr"))
    cov = _pct(constraints.get("min_operational_coverage_ratio"))
    req = constraints.get("request_id") or _MISSING
    return (
        f"TUNTAS planned training for **{emp}** people on request `{req}`. "
        f"Ceiling: {per} per person, {total} total, keep at least {cov} of each unit on duty."
    )


def _fsf_names(run: dict[str, Any]) -> dict[str, str]:
    names: dict[str, str] = {}
    payload = run.get("trigger_payload") or {}
    employees = payload.get("employees") or []
    if not isinstance(employees, list):
        return names
    for emp in employees:
        if not isinstance(emp, dict):
            continue
        for gap in emp.get("competency_gaps") or []:
            if not isinstance(gap, dict):
                continue
            code = gap.get("code") or gap.get("competency_code")
            title = gap.get("name") or gap.get("title") or gap.get("label")
            if code and title:
                names[str(code)] = str(title)
    return names


def _gap_lines(payload: dict[str, Any], names: dict[str, str] | None = None) -> str:
    names = names or {}
    freq = payload.get("gap_frequency")
    gaps = payload.get("priority_gaps")
    lines: list[str] = []
    emp = payload.get("employee_count")
    if emp is not None:
        lines.append(f"**Skill gaps** across **{emp}** people:")
    if isinstance(freq, dict) and freq:
        for key, value in list(freq.items())[:8]:
            title = names.get(str(key), "")
            shown = f"`{key}` {title}".rstrip() if title else f"`{key}`"
            lines.append(f"- {shown}: {value} people")
    elif isinstance(gaps, list) and gaps:
        for item in gaps[:8]:
            if not isinstance(item, dict):
                continue
            code = item.get("competency_code") or item.get("code") or item.get("id")
            title = item.get("title") or item.get("name") or item.get("gap") or ""
            lines.append(f"- {code or _MISSING} {title}".rstrip())
    if len(lines) <= 1:
        return "TUNTAS did not return diagnostic gaps for this run."
    return "\n".join(lines)


def format_policy_mapping_table(payload: dict[str, Any]) -> str:
    mappings = payload.get("control_mappings") or []
    if not isinstance(mappings, list) or not mappings:
        return "TUNTAS did not return policy mapping for this run."
    lines = [
        "**Policy mapping** (clause → control → competency)",
        "| Clause | Control | Competencies | Source |",
        "|---|---|---|---|",
    ]
    for item in mappings[:16]:
        if not isinstance(item, dict):
            continue
        clause = item.get("clause_ref") or _MISSING
        control = item.get("control_code") or _MISSING
        control_name = item.get("control_name") or ""
        control_cell = f"`{control}` {control_name}".rstrip() if control_name else f"`{control}`"
        comps = item.get("competency_codes")
        if isinstance(comps, list) and comps:
            comp_s = ", ".join(str(c) for c in comps)
        else:
            comp_s = _MISSING
        citation = item.get("citation") or _MISSING
        lines.append(f"| `{clause}` | {control_cell} | {comp_s} | {citation} |")
    if len(lines) <= 3:
        return "TUNTAS did not return policy mapping for this run."
    note = (payload.get("nsc07_tc17_note") or "").strip()
    if note:
        lines += ["", note]
    return "\n".join(lines)


def _diagnostic_narrative(payload: dict[str, Any]) -> str:
    summary = str(payload.get("summary") or "").strip()
    risk = str(payload.get("cohort_risk_statement") or "").strip()
    parts = [p for p in (summary, risk) if p]
    if not parts:
        return ""
    return "**Diagnostic**\n\n" + "\n\n".join(parts)


def _top_gap_cell(emp: dict[str, Any]) -> str:
    gaps = emp.get("competency_gaps") or []
    if not isinstance(gaps, list) or not gaps:
        return _MISSING
    scored: list[tuple[int, str, str]] = []
    for gap in gaps:
        if not isinstance(gap, dict):
            continue
        try:
            priority = int(gap.get("gap_priority"))
        except (TypeError, ValueError):
            priority = 99
        code = str(gap.get("code") or gap.get("competency_code") or "")
        title = str(gap.get("name") or gap.get("title") or "")
        if code or title:
            scored.append((priority, code, title))
    if not scored:
        return _MISSING
    scored.sort()
    _, code, title = scored[0]
    if code and title:
        return f"`{code}` {title}"
    return f"`{code}`" if code else title or _MISSING


def _cohort_lines(run: dict[str, Any]) -> str:
    payload = run.get("trigger_payload") or {}
    employees = payload.get("employees") or []
    if not isinstance(employees, list) or not employees:
        return "TUNTAS did not return the employee cohort for this run."
    lines = [
        "**People in this cohort**",
        "| Person | Role | Top gap |",
        "|---|---|---|",
    ]
    for emp in employees[:12]:
        if not isinstance(emp, dict):
            continue
        name = emp.get("pseudonym") or emp.get("employee_ref") or _MISSING
        ref = emp.get("employee_ref") or _MISSING
        role = emp.get("role_title") or emp.get("role_code") or _MISSING
        person = f"{name} (`{ref}`)" if ref != _MISSING else str(name)
        lines.append(f"| {person} | {role} | {_top_gap_cell(emp)} |")
    if len(lines) <= 3:
        return "TUNTAS did not return the employee cohort for this run."
    return "\n".join(lines)


def _signing_line(chain: dict[str, Any], gate_key: str) -> str:
    try:
        spec = review_gates.spec_for(gate_key)
        path: review_gates.ReviewPath = (
            "circular" if chain.get("path") == "circular" else "capability"
        )
        question = review_gates.prompt_for(spec, path)
    except review_gates.ReviewGateError:
        return ""
    label = _gate_label(gate_key)
    return f"{label} is checking: {question}"


def _veto_lines(payload: dict[str, Any]) -> str:
    vetoes = payload.get("vetoes") or []
    if not isinstance(vetoes, list) or not vetoes:
        return "TUNTAS did not return vendor vetoes for this run."
    lines = []
    for item in vetoes[:12]:
        if not isinstance(item, dict):
            continue
        code = item.get("course_code") or item.get("code") or _MISSING
        reason = item.get("reason") or _MISSING
        severity = item.get("severity") or _MISSING
        lines.append(f"- `{code}` ({severity}): {reason}")
    return "\n".join(lines) if lines else "TUNTAS did not return vendor vetoes for this run."


def format_curriculum_modules(payload: dict[str, Any]) -> str:
    """Match the Learning review page: module_code · title · delivery · levels · FSF."""
    modules = payload.get("curriculum_modules") or []
    if not isinstance(modules, list) or not modules:
        return "TUNTAS did not return a curriculum for this run."
    lines = ["**Curriculum modules**"]
    for item in modules[:12]:
        if not isinstance(item, dict):
            continue
        code = (
            item.get("module_code")
            or item.get("code")
            or item.get("course_code")
            or _MISSING
        )
        title = item.get("title") or item.get("name") or _MISSING
        delivery = item.get("delivery") or _MISSING
        level_from = item.get("level_from")
        level_to = item.get("level_to")
        if level_from is not None and level_to is not None:
            levels = f"L{level_from}→L{level_to}"
        else:
            levels = _MISSING
        comps = item.get("competency_codes")
        if isinstance(comps, list) and comps:
            comp_s = ", ".join(str(c) for c in comps)
        else:
            comp_s = _MISSING
        lines.append(f"- `{code}` · {title}")
        lines.append(f"  {delivery} · {levels} · {comp_s}")
    if len(lines) <= 1:
        return "TUNTAS did not return a curriculum for this run."
    return "\n".join(lines)


def format_scenarios(rows: list[dict[str, Any]]) -> str:
    """Match the Learning review page: scenario + role + rubric criteria."""
    if not rows:
        return "TUNTAS did not return scenarios for this run."
    lines = [
        "**Scenarios & rubric**",
        "These drills are stored for later assurance. Approving Learning does not launch them.",
    ]
    for item in rows[:8]:
        if not isinstance(item, dict):
            continue
        code = item.get("code") or _MISSING
        title = item.get("title") or _MISSING
        role = item.get("role_focus") or _MISSING
        lines.append(f"- `{code}` · {title}")
        lines.append(f"  Role focus: {role}")
        rubric = item.get("rubric") or []
        if isinstance(rubric, list):
            for criterion in rubric[:6]:
                if not isinstance(criterion, dict):
                    continue
                name = criterion.get("criterion") or _MISSING
                tag = " (critical)" if criterion.get("critical") else ""
                lines.append(f"  - {name}{tag}")
    if len(lines) <= 2:
        return "TUNTAS did not return scenarios for this run."
    return "\n".join(lines)


def _scenario_rows(run_id: str, learning: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        persisted = cockpit_svc.list_scenarios(run_id)
    except Exception:  # noqa: BLE001 — brief must degrade, not invent
        persisted = []
    if isinstance(persisted, list) and persisted:
        return [row for row in persisted if isinstance(row, dict)]
    raw = learning.get("scenarios") or []
    if isinstance(raw, list):
        return [row for row in raw if isinstance(row, dict)]
    return []


def format_vendor_shortlist(courses: list[Any]) -> str:
    """Compact version of the Procurement course cards — not live-evidence dumps."""
    if not isinstance(courses, list) or not courses:
        return "TUNTAS did not return a vendor shortlist for this run."
    lines = [
        "**Course shortlist**",
        "| Code | Title | Provider | Price | Residency | HRD |",
        "|---|---|---|---:|---|---|",
    ]
    for item in courses[:12]:
        if not isinstance(item, dict):
            continue
        code = item.get("code") or item.get("course_code") or _MISSING
        title = item.get("title") or item.get("course") or _MISSING
        provider = item.get("provider_name") or item.get("provider") or _MISSING
        price = item.get("cost_myr")
        if price is None:
            price = item.get("price_myr")
        residency = item.get("data_residency") or _MISSING
        hrd = item.get("hrd_corp_claimable")
        if hrd is True:
            hrd_s = "Claimable"
        elif hrd is False:
            hrd_s = "Not claimable"
        else:
            hrd_s = _MISSING
        lines.append(
            f"| `{code}` | {title} | {provider} | {_myr(price)} | {residency} | {hrd_s} |"
        )
    if len(lines) <= 3:
        return "TUNTAS did not return a vendor shortlist for this run."
    return "\n".join(lines)


def _risk_flag_lines(payload: dict[str, Any]) -> str:
    flags = payload.get("risk_flags") or []
    if not isinstance(flags, list) or not flags:
        return ""
    lines = ["**Other flags**"]
    wrote = False
    for item in flags[:12]:
        if not isinstance(item, dict):
            continue
        code = item.get("course_code") or item.get("code") or _MISSING
        flag = item.get("flag") or item.get("reason") or item.get("message") or _MISSING
        severity = item.get("severity") or _MISSING
        lines.append(f"- `{code}` ({severity}): {flag}")
        wrote = True
    return "\n".join(lines) if wrote else ""


def _stale_course_lines(brief: dict[str, Any] | None) -> str:
    if not brief:
        return "TUNTAS did not return which programmes are out of date."
    rows = brief.get("stale_courses") or []
    if not rows:
        return "TUNTAS returned no out-of-date programmes."
    lines = ["Programmes that need replacing:"]
    for row in rows:
        code = row.get("code") or _MISSING
        title = row.get("title") or _MISSING
        clause = row.get("clause_ref") or _MISSING
        lines.append(f"- {title} (`{code}`), tied to {clause}")
    return "\n".join(lines)


def _employee_lines(brief: dict[str, Any] | None) -> str:
    if not brief:
        return "TUNTAS did not return who needs retraining."
    rows = brief.get("affected_employees") or []
    if not rows:
        return "TUNTAS returned no one who needs retraining."
    lines = ["People who need retraining:"]
    for row in rows:
        ref = row.get("employee_ref") or _MISSING
        name = row.get("pseudonym") or _MISSING
        unit = row.get("unit") or _MISSING
        lines.append(f"- {name} ({ref}, {unit})")
    return "\n".join(lines)


def _envelope(run_id: str, view: str, chain: dict[str, Any], markdown: str) -> dict[str, Any]:
    path = chain.get("path") or "capability"
    current = chain.get("current_gate")
    expert = dispatch_for_current(chain)
    urls = _urls(run_id, str(path), current)
    return {
        "ok": True,
        "instruction": PASTE_INSTRUCTION,
        "chat_markdown": markdown,
        "run_id": run_id,
        "view": view,
        "path": path,
        "current_gate": current,
        "commit_unlocked": bool(chain.get("commit_unlocked")),
        "commit_blocked_by": list(chain.get("commit_blocked_by") or []),
        "run_status": chain.get("run_status"),
        "dispatch_expert_id": expert["expert_id"] if expert else None,
        "dispatch_expert_name": expert["name"] if expert else None,
        "dispatch_action": dispatch_action(chain),
        "wait_line": format_wait_line(chain),
        "human_commands": human_commands(chain),
        **urls,
    }


def _path_note(chain: dict[str, Any]) -> str:
    if chain.get("run_status") not in review_gates.DECIDABLE_RUN_STATUSES:
        return ""
    if chain.get("path") == "circular":
        return (
            "After Compliance signs, Procurement confirms whether in-force vendors "
            "can cover OR-TC without a new purchase. Challenger vetoes still apply."
        )
    return "After Compliance signs, Procurement will review the vendor shortlist."


def _dispatcher_markdown(
    run_id: str,
    chain: dict[str, Any],
    run: dict[str, Any],
    urls: dict[str, str],
) -> str:
    current = chain.get("current_gate")
    intro = "The training plan is ready for department review."
    if chain.get("path") == "circular":
        intro = "Here is the regulatory impact, ready for department review."
    if chain.get("run_status") not in review_gates.DECIDABLE_RUN_STATUSES:
        intro = "TUNTAS is still assembling the pack."
    parts = [
        intro,
        "",
        format_gate_table(chain),
    ]
    note = _path_note(chain)
    if note:
        parts += ["", note]
    if chain.get("run_status") in review_gates.DECIDABLE_RUN_STATUSES and current:
        body = _gate_body(run_id, chain, run, current)
        if body:
            parts += ["", body]
    parts += ["", format_human_ask(chain)]
    links = format_pack_links(urls, current)
    if links:
        parts += ["", links]
    return "\n".join(parts)


def _with_signing(chain: dict[str, Any], gate_key: str, inner: str) -> str:
    question = _signing_line(chain, gate_key)
    if question:
        return f"{question}\n\n{inner}"
    return inner


def _gate_body(
    run_id: str,
    chain: dict[str, Any],
    run: dict[str, Any],
    gate_key: str,
) -> str:
    if gate_key == "compliance":
        inner = _compliance_body(run_id, chain, run)
    elif gate_key == "procurement":
        inner = _procurement_body(run_id, chain)
    elif gate_key == "learning":
        inner = _learning_body(run_id, chain)
    elif gate_key == "operations":
        inner = _operations_body(run_id, chain, run)
    elif gate_key == "management":
        inner = _management_body(run_id, chain)
    else:
        return ""
    return _with_signing(chain, gate_key, inner)


def _capability_body(run_id: str, run: dict[str, Any]) -> str:
    options = cockpit_svc.list_options_with_assignments(run_id)
    constraints = _request_constraints(run)
    diag = _latest_handoff_payload(run_id, "diagnostic")
    policy = _latest_handoff_payload(run_id, "policy_compiler")
    names = _fsf_names(run)
    parts = [
        _format_constraints(constraints),
        "",
        "**Proposed plans**",
        format_options_table(options),
        "",
        format_policy_mapping_table(policy),
    ]
    narrative = _diagnostic_narrative(diag)
    if narrative:
        parts += ["", narrative]
    parts += ["", _gap_lines(diag, names), "", _cohort_lines(run)]
    return "\n".join(parts)


def _finish_markdown(
    chain: dict[str, Any],
    urls: dict[str, str],
    gate_key: str | None,
    parts: list[str],
) -> str:
    parts = [*parts, "", format_human_ask(chain)]
    links = format_pack_links(urls, gate_key)
    if links:
        parts += ["", links]
    return "\n".join(parts)


def _capability_markdown(run_id: str, chain: dict[str, Any], run: dict[str, Any]) -> str:
    gate = chain.get("current_gate") or "compliance"
    urls = _urls(run_id, str(chain.get("path") or "capability"), gate)
    return _finish_markdown(
        chain,
        urls,
        gate,
        [
            "Nadia (Compliance): here is what TUNTAS calculated.",
            "",
            _with_signing(chain, "compliance", _capability_body(run_id, run)),
        ],
    )


def _compliance_body(run_id: str, chain: dict[str, Any], run: dict[str, Any]) -> str:
    if chain.get("path") == "circular":
        brief = _safe_impact(run_id)
        body = (brief or {}).get("chat_markdown") if brief else None
        if not body:
            return "TUNTAS did not return an impact brief."
        return body
    return _capability_body(run_id, run)


def _compliance_markdown(run_id: str, chain: dict[str, Any], run: dict[str, Any]) -> str:
    urls = _urls(run_id, str(chain.get("path") or "capability"), "compliance")
    return _finish_markdown(
        chain,
        urls,
        "compliance",
        [
            "Nadia (Compliance):",
            "",
            _with_signing(chain, "compliance", _compliance_body(run_id, chain, run)),
        ],
    )


def _procurement_body(run_id: str, chain: dict[str, Any]) -> str:
    by_key = {g.get("gate_key"): g for g in chain.get("gates") or []}
    row = by_key.get("procurement") or {}
    if row.get("status") == "skipped" or row.get("skipped"):
        return (
            "Procurement does not need to sign this round."
        )
    challenger = _latest_handoff_payload(run_id, "challenger")
    vendor = _latest_handoff_payload(run_id, "vendor_intelligence")
    courses = vendor.get("courses") if isinstance(vendor.get("courses"), list) else []
    rec = challenger.get("overall_recommendation") or _MISSING
    notes = str(vendor.get("shortlist_notes") or "").strip()
    if chain.get("path") == "circular":
        brief = _safe_impact(run_id)
        parts = [
            "Arun (Procurement): a new circular is not automatically a new vendor buy. "
            "TUNTAS is asking whether the in-force catalogue can cover the programmes "
            "it marked stale. A Challenger veto is not a reason to purchase a replacement vendor.",
            "",
            _stale_course_lines(brief),
            "",
            f"Overall recommendation: {rec}",
        ]
        if notes:
            parts += ["", notes]
        parts += [
            "",
            "**Catalogue still on the table**",
            format_vendor_shortlist(courses),
            "",
            "**Vetoes to respect**",
            _veto_lines(challenger),
        ]
        extra = _risk_flag_lines(vendor)
        if extra:
            parts += ["", extra]
        return "\n".join(parts)
    parts = [
        f"Arun (Procurement): TUNTAS reviewed {len(courses) if courses else _MISSING} vendor courses. "
        "A Challenger veto is not a reason to purchase a replacement vendor. "
        "Stay with the in-force catalogue.",
        f"Overall recommendation: {rec}",
    ]
    if notes:
        parts += ["", notes]
    parts += ["", format_vendor_shortlist(courses), "", "**Vetoes to respect**", _veto_lines(challenger)]
    extra = _risk_flag_lines(vendor)
    if extra:
        parts += ["", extra]
    return "\n".join(parts)


def _procurement_markdown(run_id: str, chain: dict[str, Any]) -> str:
    urls = _urls(run_id, str(chain.get("path") or "capability"), "procurement")
    return _finish_markdown(
        chain,
        urls,
        "procurement",
        [_with_signing(chain, "procurement", _procurement_body(run_id, chain))],
    )


def _learning_body(run_id: str, chain: dict[str, Any]) -> str:
    learning = _latest_handoff_payload(run_id, "learning_architect")
    parts: list[str] = []
    if chain.get("path") == "circular":
        brief = _safe_impact(run_id)
        parts += [
            "Riz (Learning): we should only replace the programmes TUNTAS marked out of date.",
            "",
            _stale_course_lines(brief),
            "",
        ]
    else:
        parts += ["Riz (Learning): here is the proposed training path.", ""]
    parts += [
        format_curriculum_modules(learning),
        "",
        format_scenarios(_scenario_rows(run_id, learning)),
    ]
    return "\n".join(parts)


def _learning_markdown(run_id: str, chain: dict[str, Any]) -> str:
    urls = _urls(run_id, str(chain.get("path") or "capability"), "learning")
    return _finish_markdown(
        chain,
        urls,
        "learning",
        [_with_signing(chain, "learning", _learning_body(run_id, chain))],
    )


def _operations_body(run_id: str, chain: dict[str, Any], run: dict[str, Any]) -> str:
    options = cockpit_svc.list_options_with_assignments(run_id)
    constraints = _request_constraints(run)
    parts = [
        "Hakim (Operations): here is coverage versus the plans on the table.",
        "",
        _format_constraints(constraints),
        "",
        format_options_table(options),
        "",
        format_coverage_note(
            options, constraints.get("min_operational_coverage_ratio")
        ),
    ]
    if chain.get("path") == "circular":
        brief = _safe_impact(run_id)
        parts += ["", _employee_lines(brief)]
    return "\n".join(parts)


def _operations_markdown(run_id: str, chain: dict[str, Any], run: dict[str, Any]) -> str:
    urls = _urls(run_id, str(chain.get("path") or "capability"), "operations")
    return _finish_markdown(
        chain,
        urls,
        "operations",
        [_with_signing(chain, "operations", _operations_body(run_id, chain, run))],
    )


def _management_body(run_id: str, chain: dict[str, Any]) -> str:
    options = cockpit_svc.list_options_with_assignments(run_id)
    if chain.get("commit_unlocked"):
        lead = "All required departments have signed. Please confirm which plan to schedule."
    else:
        lead = "Management cannot confirm the schedule yet — an earlier department still needs to sign."
    return "\n".join([lead, "", format_options_table(options)])


def _management_markdown(run_id: str, chain: dict[str, Any]) -> str:
    urls = _urls(run_id, str(chain.get("path") or "capability"), "management")
    return _finish_markdown(
        chain,
        urls,
        "management",
        [_with_signing(chain, "management", _management_body(run_id, chain))],
    )


def build_workbuddy_brief(run_id: str, view: BriefView = "dispatcher") -> dict[str, Any]:
    run = run_store.get_run(run_id)
    if not run:
        return {
            "ok": False,
            "instruction": "Run not found. Do not invent a run_id or counts.",
            "chat_markdown": "I could not find that TUNTAS run.",
            "run_id": run_id,
            "view": view,
            "dispatch_action": "stop",
            "wait_line": "TUNTAS: run not found.",
            "human_commands": [],
            "commit_unlocked": False,
            "commit_blocked_by": [],
        }
    try:
        chain = review_gates.get_chain(run_id, actor_role="mcp_service")
    except review_gates.ReviewGateError as exc:
        return {
            "ok": False,
            "instruction": "Show chat_markdown. Do not invent gate state.",
            "chat_markdown": "TUNTAS could not load the review. Please try again.",
            "run_id": run_id,
            "view": view,
            "dispatch_action": "stop",
            "wait_line": exc.message,
            "human_commands": [],
            "commit_unlocked": False,
            "commit_blocked_by": list((exc.details or {}).get("missing_gates") or []),
            "detail": exc.message,
        }

    urls = _urls(run_id, str(chain.get("path") or "capability"), chain.get("current_gate"))
    if view == "dispatcher":
        md = _dispatcher_markdown(run_id, chain, run, urls)
    elif view == "capability":
        md = _capability_markdown(run_id, chain, run)
    elif view == "compliance":
        md = _compliance_markdown(run_id, chain, run)
    elif view == "procurement":
        md = _procurement_markdown(run_id, chain)
    elif view == "learning":
        md = _learning_markdown(run_id, chain)
    elif view == "operations":
        md = _operations_markdown(run_id, chain, run)
    elif view == "management":
        md = _management_markdown(run_id, chain)
    else:
        md = "TUNTAS did not recognise that briefing view."
        return {**_envelope(run_id, view, chain, md), "ok": False}

    return _envelope(run_id, view, chain, md)

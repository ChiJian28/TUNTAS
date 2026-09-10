---
name: cap-102-inforce-envelope
description: Reuse on any new BNM circular that hits the already-committed CAP-102 run. Carry the operating envelope, vendor veto, and HITL rules. Never start a new capability run. Never invent who is stale.
source: WorkBuddy capability planning session
---

# 在训信封 · CAP-102

Planning session 已结束。Management 已 COMMIT **Balanced**。
下一场工作默认读这份信封，不要从零规划。

## 已锁定（不要重新谈判）

- `run_id`: `<RUN_ID>`
- 队列：`employee_count = 10`（禁止 47 / 428）
- 覆盖率：`0.99` 已 `INFEASIBLE`；在训政策 = **0.70 Balanced**
- 预算：人均 ≤ RM 5000
- 采购：`GCX-REGTECH-ULTRA` 因 missing DPA 已否决；不要发明 SANS / HTB
- 签字：`{Dept} approve` 只过当前部门闸；写课表只接受 `Management commit …`

## 通告进来时怎么续（不是怎么从零开始）

1. 必须使用上面的 `run_id`。禁止 `start_capability_run`。
2. 乐享取通告 → ingest → `assess(reopen=false)`。先不要 reopen。
3. 过期课 / 受影响的人 / 仍为绿的课 **只许抄 TUNTAS JSON**。本 Skill 不含名单。
4. 部门闸跟 `get_review_chain`。上一场 Procurement 必过；这一场若 JSON 写 skipped，不要派 Arun。
5. 若业务再次要求 99% 在岗：Hakim 再解一次，用来**证明仍然不可行**，然后回到 0.70 Balanced。Riz 不许 what-if。

## 自检

- [ ] 没有新的 capability run
- [ ] 人数仍是 10
- [ ] 没有把 GCX 当成在训课或替代供应商
- [ ] 可见回复里的数字能在 TUNTAS 返回里对上

#!/usr/bin/env bash
# Create AmBank TUNTAS team / agent / task and the CAP-102 envelope skill.
# Idempotent. Does not touch WorkBuddy skills, mcp.json, or TUNTAS code.
set -euo pipefail

SEED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SEED_DIR/../../deploy/global-images" && pwd)"
# shellcheck source=../../deploy/global-images/_lib.sh
source "$ROOT/_lib.sh"
load_env

PANEL_URL="${PANEL_URL:-http://127.0.0.1:${PANEL_PORT:-8125}}"
INSTANCE_ID="${TDAI_SERVICE_ID:-default}"
ADMIN_KEY_FILE="${MEMORY_CORE_ADMIN_KEY_FILE:-$ROOT/.admin-key}"
STATE_FILE="$ROOT/.proxy-config/ambank-seed-state.json"
SKILL_FILE="$SEED_DIR/SKILL.md"

TEAM_NAME="AmBank TUNTAS"
AGENT_NAME="Regulatory Response"
TASK_TITLE="BNM OR-TC 2026/1"
SKILL_NAME="cap-102-inforce-envelope"

if [[ ! -s "$ADMIN_KEY_FILE" ]]; then
  die "找不到 $ADMIN_KEY_FILE 。先跑 start-stack.sh。"
fi
if [[ ! -f "$SKILL_FILE" ]]; then
  die "找不到 $SKILL_FILE"
fi

USER_KEY="$(tr -d '[:space:]' < "$ADMIN_KEY_FILE")"
mkdir -p "$(dirname "$STATE_FILE")"

meta() {
  local action="$1"
  shift
  curl -sS -X POST "${PANEL_URL}/api/v1/meta/${action}" \
    -H "Content-Type: application/json" \
    -H "x-tdai-service-id: ${INSTANCE_ID}" \
    -H "x-tdai-user-key: ${USER_KEY}" \
    -d "$@"
}

skill_api() {
  local action="$1"
  shift
  curl -sS -X POST "${PANEL_URL}/api/v1/skill/${action}" \
    -H "Content-Type: application/json" \
    -H "x-tdai-service-id: ${INSTANCE_ID}" \
    -H "x-tdai-user-key: ${USER_KEY}" \
    -d "$@"
}

json_code() { python3 -c 'import json,sys; print(json.load(sys.stdin).get("code",""))'; }
json_get() { python3 -c 'import json,sys; d=json.load(sys.stdin); p=sys.argv[1].split("."); x=d
for k in p: x=x[k] if isinstance(x,dict) else None
print("" if x is None else x)' "$1"; }

info "校验 admin user_key …"
VERIFY="$(curl -sS -X POST "${PANEL_URL}/api/v1/meta/auth/verify" \
  -H "Content-Type: application/json" \
  -H "x-tdai-service-id: ${INSTANCE_ID}" \
  -d "{\"user_key\":\"${USER_KEY}\"}")"
if [[ "$(printf '%s' "$VERIFY" | json_code)" != "0" ]]; then
  die "auth/verify 失败: $VERIFY"
fi
USER_ID="$(printf '%s' "$VERIFY" | json_get data.user.user_id)"
if [[ -z "$USER_ID" ]]; then
  USER_ID="$(printf '%s' "$VERIFY" | json_get data.user_id)"
fi
if [[ -z "$USER_ID" ]]; then
  die "auth/verify 没有 user_id: $VERIFY"
fi
ok "user_id=$USER_ID"

find_named() {
  local action="$1" list_body="$2" field="$3" want="$4" id_field="$5"
  python3 - "$action" "$list_body" "$field" "$want" "$id_field" <<'PY'
import json, sys
action, raw, field, want, id_field = sys.argv[1:6]
env = json.loads(raw)
items = (env.get("data") or {}).get("items") or env.get("data") or []
if isinstance(items, dict):
    items = items.get("items") or []
for it in items:
    if str(it.get(field, "")) == want:
        print(it.get(id_field, ""))
        break
PY
}

info "Team: $TEAM_NAME"
TEAM_LIST="$(meta team/list "{\"user_key\":\"${USER_KEY}\"}")"
TEAM_ID="$(find_named team/list "$TEAM_LIST" name "$TEAM_NAME" team_id || true)"
if [[ -z "$TEAM_ID" ]]; then
  TEAM_CREATE="$(meta team/create "{\"name\":\"${TEAM_NAME}\",\"owner_user_id\":\"${USER_ID}\",\"description\":\"AmBank capability + circular response memory team\"}")"
  if [[ "$(printf '%s' "$TEAM_CREATE" | json_code)" != "0" ]]; then
    die "team/create 失败: $TEAM_CREATE"
  fi
  TEAM_ID="$(printf '%s' "$TEAM_CREATE" | json_get data.team_id)"
  ok "已创建 team $TEAM_ID"
else
  ok "已存在 team $TEAM_ID"
fi

info "Agent: $AGENT_NAME"
AGENT_LIST="$(meta agent/list "{\"team_id\":\"${TEAM_ID}\",\"user_key\":\"${USER_KEY}\",\"owner_user_id\":\"${USER_ID}\"}")"
AGENT_ID="$(find_named agent/list "$AGENT_LIST" name "$AGENT_NAME" agent_id || true)"
if [[ -z "$AGENT_ID" ]]; then
  AGENT_CREATE="$(meta agent/create "{\"team_id\":\"${TEAM_ID}\",\"owner_user_id\":\"${USER_ID}\",\"name\":\"${AGENT_NAME}\",\"description\":\"WorkBuddy conversation agent for TUNTAS regulatory response\",\"visibility\":\"team\"}")"
  if [[ "$(printf '%s' "$AGENT_CREATE" | json_code)" != "0" ]]; then
    die "agent/create 失败: $AGENT_CREATE"
  fi
  AGENT_ID="$(printf '%s' "$AGENT_CREATE" | json_get data.agent_id)"
  ok "已创建 agent $AGENT_ID"
else
  ok "已存在 agent $AGENT_ID"
fi

info "Task: $TASK_TITLE"
TASK_LIST="$(meta task/list "{\"team_id\":\"${TEAM_ID}\",\"user_key\":\"${USER_KEY}\"}")"
TASK_ID="$(find_named task/list "$TASK_LIST" title "$TASK_TITLE" task_id || true)"
if [[ -z "$TASK_ID" ]]; then
  TASK_CREATE="$(meta task/create "{\"team_id\":\"${TEAM_ID}\",\"creator_user_id\":\"${USER_ID}\",\"title\":\"${TASK_TITLE}\",\"description\":\"Overnight circular hitting in-force CAP-102 training\",\"source_type\":\"manual\",\"linked_agents\":[{\"agent_id\":\"${AGENT_ID}\",\"role_in_task\":\"response\"}]}")"
  if [[ "$(printf '%s' "$TASK_CREATE" | json_code)" != "0" ]]; then
    die "task/create 失败: $TASK_CREATE"
  fi
  TASK_ID="$(printf '%s' "$TASK_CREATE" | json_get data.task_id)"
  ok "已创建 task $TASK_ID"
else
  ok "已存在 task $TASK_ID"
fi

info "Skill: $SKILL_NAME"
SKILL_CONTENT="$(python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' < "$SKILL_FILE")"
SKILL_LIST="$(skill_api list "{\"user_id\":\"${USER_ID}\",\"team_id\":\"${TEAM_ID}\",\"agent_id\":\"${AGENT_ID}\",\"filters\":{\"status\":[\"active\"]},\"pagination\":{\"limit\":50,\"offset\":0}}")"
SKILL_ID="$(find_named skill/list "$SKILL_LIST" name "$SKILL_NAME" skill_id || true)"
if [[ -z "$SKILL_ID" ]]; then
  SKILL_CREATE="$(skill_api create "{\"user_id\":\"${USER_ID}\",\"team_id\":\"${TEAM_ID}\",\"agent_id\":\"${AGENT_ID}\",\"task_id\":\"${TASK_ID}\",\"name\":\"${SKILL_NAME}\",\"content\":${SKILL_CONTENT}}")"
  if [[ "$(printf '%s' "$SKILL_CREATE" | json_code)" != "0" ]]; then
    die "skill/create 失败: $SKILL_CREATE"
  fi
  SKILL_ID="$(printf '%s' "$SKILL_CREATE" | json_get data.skill_id)"
  ok "已创建 skill $SKILL_ID"
else
  ok "已存在 skill $SKILL_ID （未覆盖正文；改 SKILL.md 后请在 Panel 里手工更新）"
fi

python3 - "$STATE_FILE" "$USER_ID" "$TEAM_ID" "$AGENT_ID" "$TASK_ID" "$SKILL_ID" "$USER_KEY" <<'PY'
import json, sys
path, user_id, team_id, agent_id, task_id, skill_id, user_key = sys.argv[1:8]
json.dump({
  "user_id": user_id,
  "team_id": team_id,
  "agent_id": agent_id,
  "task_id": task_id,
  "skill_id": skill_id,
  "user_key_file": "deploy/global-images/.admin-key",
}, open(path, "w"), indent=2)
print(path)
PY

echo ""
ok "Hub 种子已就绪"
echo "  Panel:     $PANEL_URL"
echo "  Team:      $TEAM_NAME  ($TEAM_ID)"
echo "  Agent:     $AGENT_NAME  ($AGENT_ID)"
echo "  Task:      $TASK_TITLE  ($TASK_ID)"
echo "  Skill:     $SKILL_NAME  ($SKILL_ID)"
echo "  登录:      用户名 admin ，key 在 $ADMIN_KEY_FILE"
echo ""
echo "Playbook 1 跑完后，把真实 run_id 填进 $SKILL_FILE 的 <RUN_ID>，再到 Panel 更新这条 Skill。"
